import { NextRequest } from "next/server";
import { dailyPlanRequestSchema } from "@/lib/ai/schemas";
import {
  packPlanIntoWindows,
  rulesFallbackSelections,
  type PlannerCandidate
} from "@/lib/ai/daily-planner";
import { hashAIInput, redactSensitiveText } from "@/lib/ai/redact";
import { recommendTodayTasks } from "@/lib/planning";
import { authenticateRequest, privateJson } from "@/lib/server/request-context";
import type {
  Assignment,
  CapacityCheckin,
  PlanningMetadata,
  Task,
  TaskDependency,
  UserSettings
} from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const promptVersion = "daily-plan-v1";

export async function GET(request: NextRequest) {
  const context = await authenticateRequest(request);
  if (context instanceof Response) return context;
  const date = request.nextUrl.searchParams.get("date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return privateJson({ error: "日期格式不正確。" }, 400);
  }
  const plan = await context.client
    .from("ai_daily_plans")
    .select("*")
    .eq("user_id", context.user.id)
    .eq("plan_date", date)
    .in("status", ["draft", "accepted"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (plan.error) return privateJson({ error: plan.error.message }, 500);
  if (!plan.data) return privateJson({ plan: null });
  const items = await context.client
    .from("ai_daily_plan_items")
    .select("*")
    .eq("plan_id", plan.data.id)
    .order("sequence");
  if (items.error) return privateJson({ error: items.error.message }, 500);
  return privateJson({ plan: { ...plan.data, items: items.data ?? [] } });
}

export async function POST(request: NextRequest) {
  const context = await authenticateRequest(request);
  if (context instanceof Response) return context;
  const body = await request.json().catch(() => null);
  const parsed = dailyPlanRequestSchema.safeParse(body);
  if (!parsed.success) {
    return privateJson({ error: "請檢查可工作時段、能量及緩衝時間。" }, 422);
  }

  try {
    packPlanIntoWindows({
      date: parsed.data.date,
      workWindows: parsed.data.workWindows,
      bufferMinutes: 0,
      selections: []
    });
  } catch (error) {
    return privateJson({ error: error instanceof Error ? error.message : "工作時段不正確。" }, 422);
  }

  const [rateLimit, dailyLimit] = await Promise.all([
    context.client
      .from("ai_analysis_events")
      .select("id", { count: "exact", head: true })
      .eq("user_id", context.user.id)
      .gte("created_at", new Date(Date.now() - 60_000).toISOString()),
    context.client
      .from("ai_analysis_events")
      .select("id", { count: "exact", head: true })
      .eq("user_id", context.user.id)
      .gte("created_at", new Date(Date.now() - 24 * 60 * 60_000).toISOString())
  ]);
  if (!rateLimit.error && (rateLimit.count ?? 0) >= 5) {
    return privateJson({ error: "分析次數太密，請一分鐘後再試。" }, 429);
  }
  if (!dailyLimit.error && (dailyLimit.count ?? 0) >= 50) {
    return privateJson({ error: "今日分析次數已達安全上限，請稍後再試。" }, 429);
  }

  const windowStart = `${parsed.data.date}T00:00:00+08:00`;
  const windowEnd = `${parsed.data.date}T23:59:59+08:00`;
  const [settings, tasks, assignments, planning, dependencies, confirmedSchedules] = await Promise.all([
    context.client.from("user_settings").select("*").eq("user_id", context.user.id).single(),
    context.client.from("tasks").select("*").is("deleted_at", null).is("archived_at", null).limit(500),
    context.client.from("assignments").select("*").limit(500),
    context.client.from("user_planning_metadata").select("*").eq("user_id", context.user.id).limit(500),
    context.client.from("task_dependencies").select("*").limit(500),
    context.client.from("operating_items")
      .select("schedule_start_at,schedule_end_at")
      .or(`owner_id.eq.${context.user.id},area.eq.family`)
      .eq("item_type", "event")
      .eq("schedule_status", "confirmed")
      .lt("schedule_start_at", windowEnd)
      .gt("schedule_end_at", windowStart)
      .is("archived_at", null)
      .limit(100)
  ]);
  const firstError = [settings, tasks, assignments, planning, dependencies, confirmedSchedules]
    .find((result) => result.error)?.error;
  if (firstError) return privateJson({ error: firstError.message }, 500);

  const availableMinutes = parsed.data.workWindows.reduce((total, window) => {
    const [startHour, startMinute] = window.start.split(":").map(Number);
    const [endHour, endMinute] = window.end.split(":").map(Number);
    return total + Math.max(0, endHour * 60 + endMinute - startHour * 60 - startMinute);
  }, 0);
  const capacity: CapacityCheckin = {
    id: "",
    user_id: context.user.id,
    checkin_date: parsed.data.date,
    energy_level: parsed.data.energyLevel,
    available_minutes: availableMinutes,
    mode: parsed.data.mode,
    essential_only: parsed.data.mode === "minimum_step",
    rest_day: false,
    work_windows: parsed.data.workWindows,
    family_load: parsed.data.familyLoad,
    recovery_need: parsed.data.recoveryNeed,
    buffer_minutes: parsed.data.bufferMinutes,
    notes: null
  };
  const capacitySave = await context.client.from("daily_capacity_checkins").upsert({
    user_id: context.user.id,
    checkin_date: parsed.data.date,
    energy_level: parsed.data.energyLevel,
    available_minutes: availableMinutes,
    mode: parsed.data.mode,
    essential_only: parsed.data.mode === "minimum_step",
    rest_day: false,
    work_windows: parsed.data.workWindows,
    family_load: parsed.data.familyLoad,
    recovery_need: parsed.data.recoveryNeed,
    buffer_minutes: parsed.data.bufferMinutes,
    updated_at: new Date().toISOString()
  }, { onConflict: "user_id,checkin_date" });
  if (capacitySave.error) return privateJson({ error: capacitySave.error.message }, 500);

  const rulePlan = recommendTodayTasks({
    tasks: (tasks.data ?? []) as Task[],
    assignments: (assignments.data ?? []) as Assignment[],
    currentUserId: context.user.id,
    settings: settings.data as UserSettings,
    capacity,
    planning: (planning.data ?? []) as PlanningMetadata[],
    dependencies: (dependencies.data ?? []) as TaskDependency[],
    today: parsed.data.date,
    minimumDay: parsed.data.mode === "minimum_step",
    preference: parsed.data.preference
  });
  const candidates: PlannerCandidate[] = rulePlan.all.slice(0, 12).map((item) => ({
    taskId: item.task.id,
    title: item.task.title,
    nextAction: item.task.next_action,
    minutes: item.minutes,
    score: item.score,
    reasons: item.reasons,
    energy: item.task.energy_level ?? null
  }));
  if (!candidates.length) {
    return privateJson({
      error: "今日未有可執行任務。Blocked、Waiting 或未完成前置工作的項目不會被硬塞入計劃。"
    }, 409);
  }

  const model = "rules-engine";
  const supportProfile = settings.data.support_profile ?? "balanced";
  const maximumItems = parsed.data.mode === "minimum_step" || parsed.data.recoveryNeed === "high"
    ? 1
    : supportProfile === "depression"
      || parsed.data.mode === "gentle"
      || parsed.data.energyLevel === "low"
      || parsed.data.familyLoad === "high"
      ? 3
      : supportProfile === "adhd"
        ? 4
        : 5;
  const safeCandidates = candidates.map((candidate) => ({
    ...candidate,
    title: redactSensitiveText(candidate.title),
    nextAction: candidate.nextAction ? redactSensitiveText(candidate.nextAction) : null
  }));
  const inputForHash = JSON.stringify({
    date: parsed.data.date,
    energy: parsed.data.energyLevel,
    mode: parsed.data.mode,
    supportProfile,
    candidates: safeCandidates
  });

  const source = "rules_fallback" as const;
  const summary = supportProfile === "adhd"
    ? "已按期限、風險同容量收窄選擇，優先清楚第一步並減少轉題。"
    : supportProfile === "depression"
      ? "已按目前能量溫和減量，只保留今日真正有容量推進的工作。"
      : "已按期限、風險、能量同可工作時間，保留最少而可推進的工作。";
  const selections = rulesFallbackSelections(candidates, maximumItems);

  const packed = packPlanIntoWindows({
    date: parsed.data.date,
    workWindows: parsed.data.workWindows,
    busyWindows: (confirmedSchedules.data ?? []).flatMap((item) =>
      item.schedule_start_at && item.schedule_end_at
        ? [{ start: item.schedule_start_at, end: item.schedule_end_at }]
        : []
    ),
    bufferMinutes: parsed.data.bufferMinutes,
    selections
  });
  if (!packed.length) {
    return privateJson({ error: "扣除已確認行程同緩衝後，今日未有足夠五分鐘工作時段。" }, 409);
  }

  await context.client.from("ai_daily_plans")
    .update({ status: "superseded", superseded_at: new Date().toISOString() })
    .eq("user_id", context.user.id)
    .eq("plan_date", parsed.data.date)
    .eq("status", "draft");

  const plan = await context.client.from("ai_daily_plans").insert({
    user_id: context.user.id,
    plan_date: parsed.data.date,
    status: "draft",
    energy_level: parsed.data.energyLevel,
    mode: parsed.data.mode,
    work_windows: parsed.data.workWindows,
    buffer_minutes: parsed.data.bufferMinutes,
    support_profile: supportProfile,
    model,
    prompt_version: promptVersion,
    summary,
    source
  }).select("*").single();
  if (plan.error) return privateJson({ error: plan.error.message }, 500);

  const planItems = await context.client.from("ai_daily_plan_items").insert(packed.map((item) => ({
    plan_id: plan.data.id,
    user_id: context.user.id,
    task_id: item.taskId,
    starts_at: item.startsAt,
    ends_at: item.endsAt,
    sequence: item.sequence,
    role: item.role,
    reason: item.reason,
    first_step: item.firstStep,
    effort_tip: item.effortTip
  }))).select("*").order("sequence");
  if (planItems.error) {
    await context.client.from("ai_daily_plans").delete().eq("id", plan.data.id);
    return privateJson({ error: planItems.error.message }, 500);
  }
  await context.client.from("ai_analysis_events").insert({
    user_id: context.user.id,
    source_type: "daily_plan",
    source_id: plan.data.id,
    model,
    prompt_version: promptVersion,
    input_hash: hashAIInput(inputForHash),
    output_json: { summary, items: packed.map(({ taskId, reason, firstStep }) => ({ taskId, reason, firstStep })) },
    source
  });

  return privateJson({ plan: { ...plan.data, items: planItems.data ?? [] } }, 201);
}

export async function PATCH(request: NextRequest) {
  const context = await authenticateRequest(request);
  if (context instanceof Response) return context;
  const body = await request.json().catch(() => null) as { planId?: unknown } | null;
  const planId = typeof body?.planId === "string" ? body.planId : "";
  if (!/^[0-9a-f-]{36}$/i.test(planId)) return privateJson({ error: "計劃識別碼不正確。" }, 422);
  const plan = await context.client.from("ai_daily_plans")
    .select("*")
    .eq("id", planId)
    .eq("user_id", context.user.id)
    .eq("status", "draft")
    .maybeSingle();
  if (plan.error) return privateJson({ error: plan.error.message }, 500);
  if (!plan.data) return privateJson({ error: "計劃已處理或不存在。" }, 409);

  const items = await context.client.from("ai_daily_plan_items")
    .select("task_id,role,sequence")
    .eq("plan_id", planId)
    .eq("user_id", context.user.id)
    .order("sequence");
  if (items.error) return privateJson({ error: items.error.message }, 500);

  const acceptedTasks = new Map<string, string>();
  for (const item of items.data ?? []) {
    if (!acceptedTasks.has(item.task_id)) acceptedTasks.set(item.task_id, item.role);
  }
  if (!acceptedTasks.size) return privateJson({ error: "計劃內沒有可接受任務。" }, 409);

  const acceptance = await context.client.rpc("accept_today_auto_plan", {
    p_task_ids: [...acceptedTasks.keys()],
    p_plan_roles: [...acceptedTasks.values()],
    p_plan_date: plan.data.plan_date,
    p_idempotency_key: planId
  });
  if (acceptance.error) return privateJson({ error: acceptance.error.message }, 500);

  const result = await context.client.from("ai_daily_plans")
    .update({ status: "accepted", accepted_at: new Date().toISOString() })
    .eq("id", planId)
    .eq("user_id", context.user.id)
    .eq("status", "draft")
    .select("*")
    .maybeSingle();
  if (result.error) return privateJson({ error: result.error.message }, 500);
  if (!result.data) return privateJson({ error: "Today 已加入，但 AI 計劃狀態未能同步；重新載入即可繼續。" }, 409);
  return privateJson({
    plan: result.data,
    todayAcceptanceId: acceptance.data,
    calendarSync: false,
    message: "已沿用現有 Today 安排確認；不會寫入 Google Calendar。"
  });
}
