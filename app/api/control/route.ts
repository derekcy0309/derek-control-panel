import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { addCalendarDays, normalizeWeeklyOutcomes, weekStartForDate } from "@/lib/weekly-review";

export const dynamic = "force-dynamic";

type RequestContext = { client: SupabaseClient; user: User; origin: string };

export async function GET(request: NextRequest) {
  const context = await authenticate(request);
  if (context instanceof Response) return context;

  const view = request.nextUrl.searchParams.get("view") ?? "bootstrap";
  if (view === "search") return search(context, request.nextUrl.searchParams.get("q") ?? "");
  if (view === "task_checkpoints") return taskCheckpoints(context, request.nextUrl.searchParams.get("taskId") ?? "");
  if (view === "task_resources") return taskResources(context, request.nextUrl.searchParams.get("taskId") ?? "");
  if (view === "inbox_capture_files") return inboxCaptureFiles(context, request.nextUrl.searchParams.get("inboxItemId") ?? "");
  if (view === "time_estimate_suggestion") return timeEstimateSuggestion(context, request.nextUrl.searchParams);
  if (view === "focus_sessions") return focusSessions(context, request.nextUrl.searchParams.get("taskId") ?? "");
  if (view === "inbox_processing") return inboxProcessing(context, request.nextUrl.searchParams);
  if (view === "today") return todayDashboard(context);
  if (view === "weekly_review") return weeklyReview(context, request.nextUrl.searchParams);
  if (view === "body_double") return bodyDouble(context, request.nextUrl.searchParams.get("sessionId"));
  if (view !== "bootstrap") return jsonError("不支援的資料檢視。", 400);

  const { client, user } = context;
  const displayName = inferDisplayName(user);
  const today = hkDateString();
  const [profile, settings, tasks, transactions, meetings, balances, items, shares, assignments, handoffNotes, planning, capacity, participants, taskDependencies, projectMilestones, taskRecurrenceRules, notificationPreferences, notificationDeliveries, pushSubscriptions] =
    await Promise.all([
      client.from("user_profiles").select("*").eq("user_id", user.id).maybeSingle(),
      client.from("user_settings").select("*").eq("user_id", user.id).maybeSingle(),
      client.from("tasks").select("*").is("deleted_at", null).is("archived_at", null).order("due_date", { ascending: true, nullsFirst: false }),
      client.from("transactions").select("*").is("archived_at", null).order("expected_date", { ascending: true, nullsFirst: false }),
      client.from("meetings").select("*").is("archived_at", null).order("meeting_date", { ascending: false }),
      client.from("balances").select("*").is("archived_at", null).order("month", { ascending: false }),
      client.from("operating_items").select("*").is("archived_at", null).order("due_date", { ascending: true, nullsFirst: false }),
      client.from("share_records").select("*").order("created_at", { ascending: false }),
      client.from("assignments").select("*").order("created_at", { ascending: false }),
      client.from("task_handoff_notes").select("*").order("created_at", { ascending: false }),
      client.from("user_planning_metadata").select("*").eq("user_id", user.id),
      client.from("daily_capacity_checkins").select("*").eq("user_id", user.id).eq("checkin_date", today).maybeSingle(),
      client.rpc("participant_profiles"),
      client.from("task_dependencies").select("*").order("created_at", { ascending: false }),
      client.from("project_milestones").select("*").order("deadline", { ascending: true, nullsFirst: false }),
      client.from("task_recurrence_rules").select("*").order("updated_at", { ascending: false }).limit(100),
      client.from("notification_preferences").select("*").eq("user_id", user.id).maybeSingle(),
      client.from("notification_deliveries")
        .select("id,kind,deliver_at,status,generic_title,generic_body,target_path,sent_at,opened_at,failed_at,last_error_code,created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(20),
      client.from("push_subscriptions")
        .select("id")
        .eq("user_id", user.id)
        .is("revoked_at", null)
        .limit(20)
    ]);

  const firstError = [profile, settings, tasks, transactions, meetings, balances, items, shares, assignments, handoffNotes, planning, capacity, participants, taskDependencies, projectMilestones, taskRecurrenceRules, notificationPreferences, notificationDeliveries, pushSubscriptions]
    .find((result) => result.error)?.error;
  if (firstError) return databaseError(firstError);

  if (!profile.data) {
    const created = await client.from("user_profiles").insert({ user_id: user.id, display_name: displayName }).select("*").single();
    if (created.error) return databaseError(created.error);
    profile.data = created.data;
  }
  if (!settings.data) {
    const gentle = displayName.toLowerCase() === "suki";
    const created = await client.from("user_settings").insert({
      user_id: user.id,
      email: user.email ?? null,
      gentle_mode: gentle,
      dashboard_density: gentle ? "calm" : "comfortable"
    }).select("*").single();
    if (created.error) return databaseError(created.error);
    settings.data = created.data;
  }

  return Response.json({
    currentUser: { id: user.id, email: user.email ?? "", displayName: profile.data.display_name },
    profile: profile.data,
    settings: settings.data,
    tasks: tasks.data ?? [],
    transactions: transactions.data ?? [],
    meetings: meetings.data ?? [],
    balances: balances.data ?? [],
    operatingItems: items.data ?? [],
    shares: shares.data ?? [],
    assignments: assignments.data ?? [],
    handoffNotes: handoffNotes.data ?? [],
    planning: planning.data ?? [],
    capacity: capacity.data ?? null,
    participants: participants.data ?? [],
    taskDependencies: taskDependencies.data ?? [],
    projectMilestones: projectMilestones.data ?? [],
    taskRecurrenceRules: taskRecurrenceRules.data ?? [],
    notificationPreferences: notificationPreferences.data ?? null,
    notificationDeliveries: notificationDeliveries.data ?? [],
    activePushSubscriptionCount: pushSubscriptions.data?.length ?? 0
  }, { headers: privateHeaders() });
}

async function todayDashboard({ client, user }: RequestContext) {
  const displayName = inferDisplayName(user);
  const today = hkDateString();
  const [profile, settings, assignments, plannedToday, capacity, participants, shares] =
    await Promise.all([
      client.from("user_profiles").select("*").eq("user_id", user.id).maybeSingle(),
      client.from("user_settings").select("*").eq("user_id", user.id).maybeSingle(),
      client.from("assignments")
        .select("*")
        .in("status", ["pending_acceptance", "accepted", "in_progress"])
        .order("created_at", { ascending: false })
        .limit(200),
      client.from("user_planning_metadata")
        .select("*")
        .eq("user_id", user.id)
        .eq("resource_type", "task")
        .eq("planned_date", today)
        .limit(20),
      client.from("daily_capacity_checkins")
        .select("*")
        .eq("user_id", user.id)
        .eq("checkin_date", today)
        .maybeSingle(),
      client.rpc("participant_profiles"),
      client.from("share_records")
        .select("*")
        .is("revoked_at", null)
        .order("created_at", { ascending: false })
        .limit(200)
    ]);

  const firstError = [profile, settings, assignments, plannedToday, capacity, participants, shares]
    .find((result) => result.error)?.error;
  if (firstError) return databaseError(firstError);

  if (!profile.data) {
    const created = await client.from("user_profiles")
      .insert({ user_id: user.id, display_name: displayName })
      .select("*")
      .single();
    if (created.error) return databaseError(created.error);
    profile.data = created.data;
  }
  if (!settings.data) {
    const gentle = displayName.toLowerCase() === "suki";
    const created = await client.from("user_settings").insert({
      user_id: user.id,
      email: user.email ?? null,
      gentle_mode: gentle,
      dashboard_density: gentle ? "calm" : "comfortable"
    }).select("*").single();
    if (created.error) return databaseError(created.error);
    settings.data = created.data;
  }

  const activeTasks = await client.from("tasks")
    .select("*")
    .is("deleted_at", null)
    .is("archived_at", null)
    .not("status", "in", "(done,cancelled,blocked,waiting)")
    .order("critical_path", { ascending: false })
    .order("due_date", { ascending: true, nullsFirst: false })
    .limit(200);
  if (activeTasks.error) return databaseError(activeTasks.error);

  const plannedIds = (plannedToday.data ?? []).map((item) => item.resource_id);
  const plannedTasks = plannedIds.length
    ? await client.from("tasks")
        .select("*")
        .in("id", plannedIds)
        .is("deleted_at", null)
        .is("archived_at", null)
        .limit(20)
    : { data: [] as Array<Record<string, unknown>>, error: null };
  if (plannedTasks.error) return databaseError(plannedTasks.error);

  const activeIds = (activeTasks.data ?? []).map((task) => task.id);
  const activePlanning = activeIds.length
    ? await client.from("user_planning_metadata")
        .select("*")
        .eq("user_id", user.id)
        .eq("resource_type", "task")
        .in("resource_id", activeIds)
        .limit(200)
    : { data: [] as Array<Record<string, unknown>>, error: null };
  if (activePlanning.error) return databaseError(activePlanning.error);

  const taskMap = new Map<string, Record<string, unknown>>();
  for (const task of [...(activeTasks.data ?? []), ...(plannedTasks.data ?? [])]) {
    taskMap.set(String(task.id), task);
  }
  const visibleTaskIds = [...taskMap.keys()];
  const dependencies = visibleTaskIds.length
    ? await client.from("task_dependencies").select("*").in("task_id", visibleTaskIds).limit(400)
    : { data: [] as Array<Record<string, unknown>>, error: null };
  if (dependencies.error) return databaseError(dependencies.error);
  const prerequisiteIds = [...new Set((dependencies.data ?? []).map((dependency) => String(dependency.depends_on_task_id)))];
  const prerequisiteTasks = prerequisiteIds.length
    ? await client.from("tasks").select("*").in("id", prerequisiteIds).is("deleted_at", null).is("archived_at", null).limit(400)
    : { data: [] as Array<Record<string, unknown>>, error: null };
  if (prerequisiteTasks.error) return databaseError(prerequisiteTasks.error);
  for (const task of prerequisiteTasks.data ?? []) {
    taskMap.set(String(task.id), task);
  }
  const planningMap = new Map<string, Record<string, unknown>>();
  for (const item of [...(activePlanning.data ?? []), ...(plannedToday.data ?? [])]) {
    planningMap.set(String(item.resource_id), item);
  }

  return Response.json({
    currentUser: {
      id: user.id,
      email: user.email ?? "",
      displayName: profile.data.display_name
    },
    profile: profile.data,
    settings: settings.data,
    tasks: [...taskMap.values()],
    shares: shares.data ?? [],
    assignments: assignments.data ?? [],
    planning: [...planningMap.values()],
    capacity: capacity.data ?? null,
    participants: participants.data ?? [],
    taskDependencies: dependencies.data ?? []
  }, { headers: privateHeaders() });
}

const weeklyReviewTaskFields = "id,title,next_action,due_date,follow_up_date,estimated_minutes,risk";

async function weeklyReview(
  { client, user }: RequestContext,
  searchParams: URLSearchParams
) {
  const requested = searchParams.get("weekStart");
  const suppliedDate = requested ? dateValue(requested) : hkDateString();
  const weekStart = suppliedDate ? weekStartForDate(suppliedDate) : null;
  const weekEnd = weekStart ? addCalendarDays(weekStart, 6) : null;
  const nextWeekStart = weekStart ? addCalendarDays(weekStart, 7) : null;
  const nextWeekEnd = weekStart ? addCalendarDays(weekStart, 13) : null;
  if (!weekStart || !weekEnd || !nextWeekStart || !nextWeekEnd) {
    return jsonError("週檢視日期不正確。", 400);
  }

  const completedStart = `${weekStart}T00:00:00+08:00`;
  const completedEnd = `${nextWeekStart}T00:00:00+08:00`;
  const ownedTasks = () => client.from("tasks")
    .select(weeklyReviewTaskFields, { count: "exact" })
    .is("deleted_at", null)
    .is("archived_at", null)
    .eq("owner_id", user.id);

  const [completed, active, blocked, waiting, upcoming, review, history] = await Promise.all([
    ownedTasks()
      .eq("status", "done")
      .gte("completed_at", completedStart)
      .lt("completed_at", completedEnd)
      .order("completed_at", { ascending: false })
      .limit(12),
    ownedTasks()
      .in("status", ["not_started", "in_progress"])
      .order("due_date", { ascending: true, nullsFirst: false })
      .limit(12),
    ownedTasks()
      .eq("status", "blocked")
      .order("updated_at", { ascending: false })
      .limit(12),
    ownedTasks()
      .eq("status", "waiting")
      .or(`follow_up_date.is.null,follow_up_date.lte.${weekEnd}`)
      .order("follow_up_date", { ascending: true, nullsFirst: true })
      .limit(12),
    ownedTasks()
      .in("status", ["not_started", "in_progress", "waiting"])
      .gte("due_date", nextWeekStart)
      .lte("due_date", nextWeekEnd)
      .order("due_date", { ascending: true })
      .limit(30),
    client.from("weekly_reviews")
      .select("*")
      .eq("user_id", user.id)
      .eq("week_start", weekStart)
      .maybeSingle(),
    client.from("weekly_reviews")
      .select("*")
      .eq("user_id", user.id)
      .order("week_start", { ascending: false })
      .limit(8)
  ]);
  const firstError = [completed, active, blocked, waiting, upcoming, review, history]
    .find((result) => result.error)?.error;
  if (firstError) return databaseError(firstError);

  const upcomingItems = weeklyReviewItems(upcoming.data ?? []);
  const knownEstimatedMinutes = upcomingItems.reduce((total, task) => total + (task.estimated_minutes ?? 0), 0);
  return Response.json({
    week_start: weekStart,
    week_end: weekEnd,
    next_week_start: nextWeekStart,
    next_week_end: nextWeekEnd,
    completed: weeklyReviewItems(completed.data ?? []),
    active: weeklyReviewItems(active.data ?? []),
    blocked: weeklyReviewItems(blocked.data ?? []),
    waiting: weeklyReviewItems(waiting.data ?? []),
    upcoming: upcomingItems,
    counts: {
      completed: completed.count ?? 0,
      active: active.count ?? 0,
      blocked: blocked.count ?? 0,
      waiting: waiting.count ?? 0,
      upcoming: upcoming.count ?? 0
    },
    known_estimated_minutes: knownEstimatedMinutes,
    review: review.data ?? null,
    history: history.data ?? []
  }, { headers: privateHeaders() });
}

async function bodyDouble({ client, user }: RequestContext, requestedSessionId: string | null) {
  const sessionId = requestedSessionId ? uuidValue(requestedSessionId) : null;
  if (requestedSessionId && !sessionId) return jsonError("共用專注時段不正確。", 400);

  const ownTasks = client.rpc("body_double_available_tasks");
  const sessionQuery = client.from("body_double_sessions")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1);
  const selectedSession = sessionId ? sessionQuery.eq("id", sessionId).maybeSingle() : sessionQuery.in("status", ["waiting", "running"]).maybeSingle();
  const [tasks, profiles, sessionResult] = await Promise.all([
    ownTasks,
    client.rpc("participant_profiles"),
    selectedSession
  ]);
  const firstError = [tasks, profiles, sessionResult].find((result) => result.error)?.error;
  if (firstError) return databaseError(firstError);

  const session = sessionResult.data as Record<string, unknown> | null;
  if (!session) {
    return Response.json({
      currentUser: { id: user.id, email: user.email ?? "", displayName: inferDisplayName(user) },
      participants: (profiles.data ?? []).filter((profile: { user_id: string; display_name: string }) => profile.user_id !== user.id),
      availableTasks: tasks.data ?? [],
      session: null
    }, { headers: privateHeaders() });
  }

  const sessionParticipants = await client.from("body_double_participants")
    .select("user_id,task_id,task_label,share_task_title,status,ready_at,paused_at,completed_at,checkpoint_saved_at,last_seen_at")
    .eq("session_id", session.id)
    .order("created_at", { ascending: true });
  if (sessionParticipants.error) return databaseError(sessionParticipants.error);
  const nameById = new Map((profiles.data ?? []).map((profile: { user_id: string; display_name: string }) => [profile.user_id, profile.display_name]));
  const visibleParticipants = (sessionParticipants.data ?? []).map((participant) => {
    const own = participant.user_id === user.id;
    const showTitle = own || participant.share_task_title;
    return {
      user_id: participant.user_id,
      display_name: nameById.get(participant.user_id) ?? "專注夥伴",
      status: participant.status,
      task_id: own ? participant.task_id : null,
      task_label: showTitle ? participant.task_label : null,
      share_task_title: own ? participant.share_task_title : false,
      ready_at: participant.ready_at,
      paused_at: participant.paused_at,
      completed_at: participant.completed_at,
      checkpoint_saved_at: participant.checkpoint_saved_at,
      last_seen_at: participant.last_seen_at,
      is_current_user: own
    };
  });

  return Response.json({
    currentUser: { id: user.id, email: user.email ?? "", displayName: inferDisplayName(user) },
    participants: (profiles.data ?? []).filter((profile: { user_id: string; display_name: string }) => profile.user_id !== user.id),
    availableTasks: tasks.data ?? [],
    session: {
      ...session,
      participants: visibleParticipants
    }
  }, { headers: privateHeaders() });
}

async function saveWeeklyReview(
  { client, user }: RequestContext,
  body: Record<string, unknown>
) {
  const requestedDate = dateValue(body.weekStart);
  const weekStart = requestedDate ? weekStartForDate(requestedDate) : null;
  if (!weekStart) return jsonError("週檢視日期不正確。", 422);

  if (!Array.isArray(body.nextWeekOutcomes) || body.nextWeekOutcomes.length > 3) {
    return jsonError("下星期成果最多可填寫三項。", 422);
  }
  const nextWeekOutcomes = normalizeWeeklyOutcomes(body.nextWeekOutcomes);
  const nextWeekAvailableMinutes = body.nextWeekAvailableMinutes === null || body.nextWeekAvailableMinutes === ""
    ? null
    : integerValue(body.nextWeekAvailableMinutes, 0, 10080);
  if (body.nextWeekAvailableMinutes !== null && body.nextWeekAvailableMinutes !== "" && nextWeekAvailableMinutes === null) {
    return jsonError("下星期可用時間必須是 0 至 10080 分鐘。", 422);
  }
  const rebalancingNote = weeklyReviewText(body.rebalancingNote, 2000, "重新分工備註");
  if (rebalancingNote instanceof Response) return rebalancingNote;
  const nextMinimumAction = weeklyReviewText(body.nextMinimumAction, 500, "下星期第一步");
  if (nextMinimumAction instanceof Response) return nextMinimumAction;
  const reflection = weeklyReviewText(body.reflection, 4000, "週檢視備註");
  if (reflection instanceof Response) return reflection;
  const complete = body.complete === true;
  if (complete && !nextMinimumAction) return jsonError("完成檢視前，請寫下下星期第一個最小行動。", 422);

  const snapshot = await weeklyReviewSnapshot(client, user.id, weekStart);
  if (snapshot instanceof Response) return snapshot;
  const result = await client.from("weekly_reviews").upsert({
    user_id: user.id,
    week_start: weekStart,
    status: complete ? "completed" : "draft",
    next_week_outcomes: nextWeekOutcomes,
    next_week_available_minutes: nextWeekAvailableMinutes,
    rebalancing_note: rebalancingNote,
    next_minimum_action: nextMinimumAction,
    reflection,
    review_snapshot: snapshot,
    completed_at: complete ? new Date().toISOString() : null
  }, { onConflict: "user_id,week_start" }).select("*").single();
  if (result.error) return databaseError(result.error);
  if (complete) {
    await recordActivity(client, user.id, "weekly_review", result.data.id, "weekly_review_completed", "已完成低壓力週檢視");
  }
  return Response.json({ review: result.data }, { headers: privateHeaders() });
}

async function createBodyDouble({ client, user }: RequestContext, body: Record<string, unknown>) {
  const partnerUserId = uuidValue(body.partnerUserId);
  const taskId = uuidValue(body.taskId);
  const durationMinutes = integerValue(body.durationMinutes, 15, 45);
  if (!partnerUserId || !taskId || !durationMinutes || ![15, 20, 25, 45].includes(durationMinutes)) {
    return jsonError("請選擇夥伴、任務和 15、20、25 或 45 分鐘。", 422);
  }
  const result = await client.rpc("create_body_double_session", {
    p_partner_user_id: partnerUserId,
    p_task_id: taskId,
    p_duration_minutes: durationMinutes,
    p_share_task_title: body.shareTaskTitle === true
  });
  if (result.error) return databaseError(result.error);
  const sessionId = String(result.data ?? "");
  if (!uuidValue(sessionId)) return jsonError("未能建立共用專注時段。", 500);
  await recordActivity(client, user.id, "body_double", sessionId, "created", "建立雙人共用專注時段");
  return Response.json({ sessionId }, { headers: privateHeaders() });
}

async function prepareBodyDouble({ client, user }: RequestContext, body: Record<string, unknown>) {
  const sessionId = uuidValue(body.sessionId);
  const taskId = uuidValue(body.taskId);
  if (!sessionId || !taskId) return jsonError("共用專注任務不正確。", 422);
  const result = await client.rpc("prepare_body_double_participant", {
    p_session_id: sessionId,
    p_task_id: taskId,
    p_share_task_title: body.shareTaskTitle === true
  });
  if (result.error) return databaseError(result.error);
  await recordActivity(client, user.id, "body_double", sessionId, "ready", "已準備自己的專注任務");
  return Response.json({ sessionId: result.data }, { headers: privateHeaders() });
}

async function startBodyDouble({ client, user }: RequestContext, body: Record<string, unknown>) {
  const sessionId = uuidValue(body.sessionId);
  if (!sessionId) return jsonError("共用專注時段不正確。", 422);
  const result = await client.rpc("start_body_double_session", { p_session_id: sessionId });
  if (result.error) return databaseError(result.error);
  const startedAt = timestampValue(result.data);
  if (!startedAt) return jsonError("未能同步開始共用專注時段。", 500);
  await recordActivity(client, user.id, "body_double", sessionId, "started", "同步開始雙人共用專注時段");
  return Response.json({ startedAt }, { headers: privateHeaders() });
}

async function updateBodyDoublePresence({ client, user }: RequestContext, body: Record<string, unknown>) {
  const sessionId = uuidValue(body.sessionId);
  const status = enumValue(body.status, ["running", "paused", "left"] as const, null);
  if (!sessionId || !status) return jsonError("共用專注狀態不正確。", 422);
  const result = await client.rpc("update_body_double_presence", { p_session_id: sessionId, p_status: status });
  if (result.error) return databaseError(result.error);
  await recordActivity(client, user.id, "body_double", sessionId, status, status === "paused" ? "暫停共用專注" : status === "left" ? "離開共用專注" : "繼續共用專注");
  return Response.json({ sessionId: result.data }, { headers: privateHeaders() });
}

async function heartbeatBodyDouble({ client }: RequestContext, body: Record<string, unknown>) {
  const sessionId = uuidValue(body.sessionId);
  if (!sessionId) return jsonError("共用專注時段不正確。", 422);
  const result = await client.rpc("heartbeat_body_double_session", { p_session_id: sessionId });
  if (result.error) return databaseError(result.error);
  return Response.json({ seenAt: result.data }, { headers: privateHeaders() });
}

async function completeBodyDouble({ client, user }: RequestContext, body: Record<string, unknown>) {
  const sessionId = uuidValue(body.sessionId);
  if (!sessionId) return jsonError("共用專注時段不正確。", 422);
  const result = await client.rpc("complete_body_double_participant", { p_session_id: sessionId });
  if (result.error) return databaseError(result.error);
  await recordActivity(client, user.id, "body_double", sessionId, "completed", "已完成自己的共用專注時段並儲存 checkpoint");
  return Response.json({ sessionId: result.data }, { headers: privateHeaders() });
}

async function cancelBodyDouble({ client, user }: RequestContext, body: Record<string, unknown>) {
  const sessionId = uuidValue(body.sessionId);
  if (!sessionId) return jsonError("共用專注時段不正確。", 422);
  const result = await client.rpc("cancel_body_double_session", { p_session_id: sessionId });
  if (result.error) return databaseError(result.error);
  await recordActivity(client, user.id, "body_double", sessionId, "cancelled", "取消尚未開始的共用專注時段");
  return Response.json({ sessionId: result.data }, { headers: privateHeaders() });
}

function weeklyReviewItems(rows: Array<Record<string, unknown>>) {
  return rows.map((row) => ({
    id: String(row.id),
    title: stringValue(row.title),
    next_action: nullableText(row.next_action),
    due_date: dateValue(row.due_date),
    follow_up_date: dateValue(row.follow_up_date),
    estimated_minutes: integerValue(row.estimated_minutes, 0, 14400),
    risk: enumValue(row.risk, ["low", "medium", "high"] as const, "low")!
  }));
}

async function weeklyReviewSnapshot(client: SupabaseClient, userId: string, weekStart: string) {
  const weekEnd = addCalendarDays(weekStart, 6);
  const nextWeekStart = addCalendarDays(weekStart, 7);
  if (!weekEnd || !nextWeekStart) return jsonError("週檢視日期不正確。", 422);
  const completedStart = `${weekStart}T00:00:00+08:00`;
  const completedEnd = `${nextWeekStart}T00:00:00+08:00`;
  const ownedTasks = () => client.from("tasks")
    .select("id", { count: "exact", head: true })
    .is("deleted_at", null)
    .is("archived_at", null)
    .eq("owner_id", userId);
  const [completed, active, blocked, waiting] = await Promise.all([
    ownedTasks().eq("status", "done").gte("completed_at", completedStart).lt("completed_at", completedEnd),
    ownedTasks().in("status", ["not_started", "in_progress"]),
    ownedTasks().eq("status", "blocked"),
    ownedTasks().eq("status", "waiting").or(`follow_up_date.is.null,follow_up_date.lte.${weekEnd}`)
  ]);
  const firstError = [completed, active, blocked, waiting].find((result) => result.error)?.error;
  if (firstError) return databaseError(firstError);
  return {
    completed: completed.count ?? 0,
    active: active.count ?? 0,
    blocked: blocked.count ?? 0,
    waiting: waiting.count ?? 0,
    generated_at: new Date().toISOString()
  };
}

function weeklyReviewText(value: unknown, maxLength: number, label: string) {
  const text = stringValue(value).trim();
  if (text.length > maxLength) return jsonError(`${label}太長，請縮短後再儲存。`, 422);
  return text || null;
}

export async function POST(request: NextRequest) {
  const context = await authenticate(request);
  if (context instanceof Response) return context;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonError("請求格式不正確。", 400);
  }
  const action = stringValue(body.action);
  switch (action) {
    case "create_task": return createTask(context, body);
    case "update_task": return updateTask(context, body);
    case "create_task_dependency": return createTaskDependency(context, body);
    case "remove_task_dependency": return removeTaskDependency(context, body);
    case "save_project_milestone": return saveProjectMilestone(context, body);
    case "delete_project_milestone": return deleteProjectMilestone(context, body);
    case "save_task_recurrence": return saveTaskRecurrence(context, body);
    case "set_task_recurrence_active": return setTaskRecurrenceActive(context, body);
    case "save_transaction": return saveTransaction(context, body);
    case "save_meeting": return saveMeeting(context, body);
    case "save_balance": return saveBalance(context, body);
    case "create_item": return createOperatingItem(context, body);
    case "update_item": return updateOperatingItem(context, body);
    case "share": return shareResource(context, body);
    case "handoff_task": return startTaskHandoff(context, body);
    case "handoff_reclaim": return reclaimTaskHandoff(context, body);
    case "handoff_progress": return recordTaskHandoffProgress(context, body);
    case "handoff_resolve": return resolveTaskHandoff(context, body);
    case "assignment_response": return respondToAssignment(context, body);
    case "joint_response": return respondToJoint(context, body);
    case "revoke_share": return revokeShare(context, body);
    case "save_settings": return saveSettings(context, body);
    case "admin_reset_password": return adminResetPassword(context, body);
    case "capacity_checkin": return saveCapacity(context, body);
    case "accept_today_plan": return acceptTodayPlan(context, body);
    case "snooze_today_task": return snoozeTodayTask(context, body);
    case "save_checkpoint_draft": return saveTaskCheckpoint(context, body, "draft");
    case "save_checkpoint": return saveTaskCheckpoint(context, body, "saved");
    case "create_task_resource": return createTaskResource(context, body);
    case "set_task_resource_sharing": return setTaskResourceSharing(context, body);
    case "delete_task_resource": return deleteTaskResource(context, body);
    case "open_task_storage_resource": return openTaskStorageResource(context, body);
    case "open_inbox_capture_file": return openInboxCaptureFile(context, body);
    case "process_inbox_item": return processInboxItem(context, body);
    case "undo_inbox_processing": return undoInboxProcessing(context, body);
    case "save_notification_preferences": return saveNotificationPreferences(context, body);
    case "save_push_subscription": return savePushSubscription(context, body);
    case "remove_push_subscription": return removePushSubscription(context, body);
    case "schedule_focus_notification": return scheduleFocusNotification(context, body);
    case "cancel_focus_notification": return cancelFocusNotification(context, body);
    case "complete_local_notification": return completeLocalNotification(context, body);
    case "start_focus_session": return startFocusSession(context, body);
    case "pause_focus_session": return pauseFocusSession(context, body);
    case "resume_focus_session": return resumeFocusSession(context, body);
    case "finish_focus_session": return finishFocusSession(context, body);
    case "notification_opened": return markNotificationOpened(context, body);
    case "test_notification": return enqueueTestNotification(context);
    case "save_weekly_review": return saveWeeklyReview(context, body);
    case "create_body_double": return createBodyDouble(context, body);
    case "prepare_body_double": return prepareBodyDouble(context, body);
    case "start_body_double": return startBodyDouble(context, body);
    case "body_double_presence": return updateBodyDoublePresence(context, body);
    case "body_double_heartbeat": return heartbeatBodyDouble(context, body);
    case "complete_body_double": return completeBodyDouble(context, body);
    case "cancel_body_double": return cancelBodyDouble(context, body);
    default: return jsonError("不支援的操作。", 400);
  }
}

async function authenticate(request: NextRequest): Promise<RequestContext | Response> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const authorization = request.headers.get("authorization") ?? "";
  const token = request.cookies.get("dcp_access")?.value ?? (authorization.startsWith("Bearer ") ? authorization.slice(7) : "");
  if (!url || !key) return jsonError("伺服器尚未設定資料庫。", 503);
  if (!token) return jsonError("登入已失效，請重新登入。", 401);

  const client = createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return jsonError("登入已失效，請重新登入。", 401);
  return { client, user: data.user, origin: request.nextUrl.origin };
}

async function inboxProcessing(
  { client, user }: RequestContext,
  searchParams: URLSearchParams
) {
  const sessionId = uuidValue(searchParams.get("sessionId"));
  const page = integerValue(searchParams.get("page") ?? "1", 1, 10000) ?? 1;
  if (!sessionId) return jsonError("收集箱處理 session 不正確。", 400);

  const pageSize = 20;
  const offset = (page - 1) * pageSize;
  const availableBefore = new Date().toISOString();
  const queueFilter = `inbox_available_after.is.null,inbox_available_after.lte.${availableBefore}`;
  const queue = client.from("operating_items")
    .select("*", { count: "exact" })
    .eq("owner_id", user.id)
    .eq("item_type", "inbox")
    .eq("status", "inbox")
    .is("archived_at", null)
    .is("inbox_processed_at", null)
    .or(queueFilter)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .range(offset, offset + pageSize - 1);
  const current = client.from("operating_items")
    .select("*")
    .eq("owner_id", user.id)
    .eq("item_type", "inbox")
    .eq("status", "inbox")
    .is("archived_at", null)
    .is("inbox_processed_at", null)
    .or(queueFilter)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();
  const processed = client.from("inbox_processing_events")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("session_id", sessionId)
    .is("undone_at", null);
  const lastUndoable = client.from("inbox_processing_events")
    .select("id,inbox_item_id,action,target_type,target_id,processed_at,undone_at")
    .eq("user_id", user.id)
    .is("undone_at", null)
    .gte("processed_at", new Date(Date.now() - 15 * 60_000).toISOString())
    .order("processed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const participants = client.rpc("participant_profiles");

  const [queueResult, currentResult, processedResult, undoResult, participantResult] =
    await Promise.all([queue, current, processed, lastUndoable, participants]);
  const firstError = [queueResult, currentResult, processedResult, undoResult, participantResult]
    .find((result) => result.error)?.error;
  if (firstError) return databaseError(firstError);

  const totalRemaining = queueResult.count ?? 0;
  const sessionProcessed = processedResult.count ?? 0;
  const sessionTotal = totalRemaining + sessionProcessed;

  return Response.json({
    currentUser: {
      id: user.id,
      email: user.email ?? "",
      displayName: inferDisplayName(user)
    },
    currentItem: currentResult.data ?? null,
    items: queueResult.data ?? [],
    totalRemaining,
    sessionProcessed,
    sessionTotal,
    position: totalRemaining > 0 ? sessionProcessed + 1 : sessionProcessed,
    participants: participantResult.data ?? [],
    lastUndoable: undoResult.data ?? null,
    page,
    pageSize
  }, { headers: privateHeaders() });
}

async function processInboxItem(
  { client }: RequestContext,
  body: Record<string, unknown>
) {
  const inboxItemId = uuidValue(body.inboxItemId);
  const sessionId = uuidValue(body.sessionId);
  const idempotencyKey = uuidValue(body.idempotencyKey);
  const action = enumValue(body.processingAction, [
    "do_now",
    "create_task",
    "add_project",
    "add_waiting",
    "assign",
    "schedule",
    "keep_note",
    "skip"
  ], null);
  if (!inboxItemId || !sessionId || !idempotencyKey || !action) {
    return jsonError("收集箱處理資料不正確。", 400);
  }

  const options = inboxProcessingOptions(body.options);
  if (options instanceof Response) return options;
  if (action === "do_now" && !options.nextAction) {
    return jsonError("請輸入立即開始的下一個最小步驟。", 422);
  }
  if (action === "schedule" && !options.plannedDate) {
    return jsonError("請選擇安排日期。", 422);
  }
  if (action === "assign" && (!options.handoffToUserId || !options.handoffNote)) {
    return jsonError("請選擇跟進者並輸入交接 notes。", 422);
  }

  const result = await client.rpc("process_inbox_item", {
    p_inbox_item_id: inboxItemId,
    p_action: action,
    p_session_id: sessionId,
    p_idempotency_key: idempotencyKey,
    p_options: options
  });
  if (result.error) return databaseError(result.error);
  const event = Array.isArray(result.data) ? result.data[0] : result.data;
  if (!event) return jsonError("未能讀取收集箱處理結果。", 500);

  return Response.json({
    event: {
      id: event.event_id,
      inbox_item_id: inboxItemId,
      action: event.processed_action,
      target_type: event.target_type,
      target_id: event.target_id,
      processed_at: event.processed_at,
      undone_at: null
    }
  }, { headers: privateHeaders() });
}

async function undoInboxProcessing(
  { client }: RequestContext,
  body: Record<string, unknown>
) {
  const eventId = uuidValue(body.eventId);
  if (!eventId) return jsonError("找不到可撤銷的收集箱處理。", 400);

  const result = await client.rpc("undo_last_inbox_processing", {
    p_event_id: eventId
  });
  if (result.error) return databaseError(result.error);
  const restored = Array.isArray(result.data) ? result.data[0] : result.data;
  if (!restored) return jsonError("未能讀取撤銷結果。", 500);
  return Response.json({
    eventId: restored.event_id,
    restoredInboxItemId: restored.restored_inbox_item_id
  }, { headers: privateHeaders() });
}

async function createTask({ client, user }: RequestContext, body: Record<string, unknown>) {
  const title = requiredText(body.title, "請輸入任務標題。");
  if (title instanceof Response) return title;
  const requestedHandoffTarget = nullableText(body.handoffToUserId);
  const handoffTarget = requestedHandoffTarget ? uuidValue(requestedHandoffTarget) : null;
  const handoffNote = nullableText(body.handoffNote);
  const requestedProjectId = nullableText(body.projectId);
  const projectId = requestedProjectId ? uuidValue(requestedProjectId) : null;
  if (requestedHandoffTarget && !handoffTarget) return jsonError("交接對象不正確。", 400);
  if (requestedProjectId && !projectId) return jsonError("項目識別碼不正確。", 400);
  if (handoffTarget === user.id) return jsonError("請選擇另一位跟進者。", 422);
  if (handoffTarget && !handoffNote) return jsonError("請輸入交接 notes，讓對方知道第一步。", 422);
  const status = enumValue(body.status, ["not_started", "in_progress", "waiting", "done", "blocked", "cancelled"], "not_started");
  const nextAction = nullableText(body.nextAction);
  if (status === "in_progress" && !nextAction) return jsonError("開始任務前必須設定清晰的下一步。", 422);
  const payload = {
    user_id: user.id,
    owner_id: user.id,
    created_by_id: user.id,
    visibility: "private",
    scope: enumValue(body.area, ["work", "family", "personal"], "personal") === "work" ? "company" : "home",
    area: enumValue(body.area, ["work", "family", "personal"], "personal"),
    source_type: enumValue(body.sourceType, ["meeting_action", "deadline", "follow_up"], "follow_up"),
    title,
    description: nullableText(body.description),
    due_date: dateValue(body.dueDate),
    follow_up_date: dateValue(body.followUpDate),
    planned_date: dateValue(body.plannedDate),
    status,
    next_action: nextAction,
    definition_of_done: nullableText(body.definitionOfDone),
    estimated_minutes: integerValue(body.estimatedMinutes, 0, 14400),
    energy_level: enumValue(body.energyLevel, ["low", "medium", "high"], null),
    context: nullableText(body.context),
    risk: enumValue(body.risk, ["low", "medium", "high"], "low"),
    requested_priority: integerValue(body.requestedPriority, 1, 5) ?? 3,
    critical_path: Boolean(body.criticalPath),
    safety_impact: Boolean(body.safetyImpact),
    child_impact: Boolean(body.childImpact),
    legal_impact: Boolean(body.legalImpact),
    estimated_duration_days: integerValue(body.estimatedDurationDays, 0, 3650),
    buffer_days: integerValue(body.bufferDays, 0, 365) ?? 0,
    project_id: projectId,
    notes: nullableText(body.notes)
  };
  const result = await client.from("tasks").insert(payload).select("*").single();
  if (result.error) return databaseError(result.error);
  let assignmentId: string | null = null;
  if (handoffTarget && handoffNote) {
    const handoff = await client.rpc("start_task_handoff", {
      p_task_id: result.data.id,
      p_target_user_id: handoffTarget,
      p_note: handoffNote,
      p_due_date: payload.due_date
    });
    if (handoff.error) {
      await client.from("tasks").delete().eq("id", result.data.id);
      return databaseError(handoff.error);
    }
    assignmentId = handoff.data;
  }
  await recordActivity(client, user.id, "task", result.data.id, "create", "建立任務");
  if (assignmentId) await recordActivity(client, user.id, "task", result.data.id, "handoff", "建立後直接交俾對方跟進");
  return Response.json({ task: result.data, assignmentId }, { status: 201, headers: privateHeaders() });
}

async function updateTask({ client, user }: RequestContext, body: Record<string, unknown>) {
  const id = uuidValue(body.id);
  if (!id) return jsonError("任務識別碼不正確。", 400);
  const existing = await client.from("tasks").select("*").eq("id", id).maybeSingle();
  if (existing.error) return databaseError(existing.error);
  if (!existing.data) return jsonError("找不到任務或你沒有權限。", 404);

  const changes = objectValue(body.changes);
  const allowed = existing.data.owner_id === user.id
    ? ["title","description","status","next_action","definition_of_done","due_date","follow_up_date","planned_date","estimated_minutes","energy_level","context","risk","requested_priority","critical_path","safety_impact","child_impact","legal_impact","blocked_reason","progress","actual_minutes","notes","archived_at","deleted_at","snoozed_until","last_progress_at","completed_at","project_id"]
    : ["status","blocked_reason","progress","actual_minutes","last_progress_at","completed_at"];
  const payload = pick(changes, allowed);
  if (payload.status === "in_progress" && !stringValue(payload.next_action ?? existing.data.next_action)) {
    return jsonError("開始任務前必須設定清晰的下一步。", 422);
  }
  if (payload.status === "done") payload.completed_at = new Date().toISOString();
  payload.last_progress_at = new Date().toISOString();
  const result = await client.from("tasks").update(payload).eq("id", id).select("*").maybeSingle();
  if (result.error) return databaseError(result.error);
  if (!result.data) return jsonError("更新被拒絕。", 403);
  await recordActivity(client, user.id, "task", id, payload.status === "done" ? "complete" : "update", "更新任務");
  return Response.json({ task: result.data }, { headers: privateHeaders() });
}

async function createTaskDependency({ client, user }: RequestContext, body: Record<string, unknown>) {
  const taskId = uuidValue(body.taskId);
  const dependsOnTaskId = uuidValue(body.dependsOnTaskId);
  if (!taskId || !dependsOnTaskId) return jsonError("請選擇兩項有效任務。", 400);
  if (taskId === dependsOnTaskId) return jsonError("任務不能依賴自己。", 422);

  const [task, prerequisite] = await Promise.all([
    client.from("tasks").select("id").eq("id", taskId).maybeSingle(),
    client.from("tasks").select("id").eq("id", dependsOnTaskId).maybeSingle()
  ]);
  const lookupError = task.error ?? prerequisite.error;
  if (lookupError) return databaseError(lookupError);
  if (!task.data || !prerequisite.data) return jsonError("找不到任務或你沒有查看權限。", 404);

  const result = await client.from("task_dependencies")
    .insert({ task_id: taskId, depends_on_task_id: dependsOnTaskId, created_by_id: user.id })
    .select("*")
    .single();
  if (result.error) {
    if (result.error.message.includes("TASK_DEPENDENCY_CYCLE")) {
      return jsonError("這個關係會造成循環依賴，請改用不會互相卡住的次序。", 422);
    }
    if (result.error.code === "23505") return jsonError("這個依賴關係已存在。", 409);
    return databaseError(result.error);
  }
  await recordActivity(client, user.id, "task", taskId, "dependency_add", "新增任務依賴");
  return Response.json({ dependency: result.data }, { status: 201, headers: privateHeaders() });
}

async function removeTaskDependency({ client, user }: RequestContext, body: Record<string, unknown>) {
  const id = uuidValue(body.id);
  if (!id) return jsonError("依賴關係識別碼不正確。", 400);
  const existing = await client.from("task_dependencies").select("id,task_id").eq("id", id).maybeSingle();
  if (existing.error) return databaseError(existing.error);
  if (!existing.data) return jsonError("找不到依賴關係或你沒有權限。", 404);
  const result = await client.from("task_dependencies").delete().eq("id", id).select("id").maybeSingle();
  if (result.error) return databaseError(result.error);
  if (!result.data) return jsonError("移除依賴關係被拒絕。", 403);
  await recordActivity(client, user.id, "task", existing.data.task_id, "dependency_remove", "移除任務依賴");
  return Response.json({ id: result.data.id }, { headers: privateHeaders() });
}

async function saveTaskRecurrence({ client, user }: RequestContext, body: Record<string, unknown>) {
  const taskId = uuidValue(body.taskId);
  if (!taskId) return jsonError("任務識別碼不正確。", 400);
  const recurrence = recurrenceOptions(body);
  if (recurrence instanceof Response) return recurrence;

  const task = await client.from("tasks").select("*").eq("id", taskId).maybeSingle();
  if (task.error) return databaseError(task.error);
  if (!task.data) return jsonError("找不到任務或你沒有權限。", 404);
  if (task.data.owner_id !== user.id) return jsonError("只有任務擁有者可以設定重複工作。", 403);
  if (["done", "cancelled"].includes(task.data.status)) {
    return jsonError("請在未完成的任務上設定重複工作。", 422);
  }

  const payload = {
    seed_task_id: taskId,
    owner_id: user.id,
    created_by_id: user.id,
    frequency: recurrence.frequency,
    weekdays: recurrence.weekdays,
    custom_interval_days: recurrence.customIntervalDays,
    business_days_only: recurrence.businessDaysOnly,
    night_shift_pattern: recurrence.nightShiftPattern,
    night_shift_on_days: recurrence.nightShiftOnDays,
    night_shift_off_days: recurrence.nightShiftOffDays,
    cycle_anchor_date: recurrence.cycleAnchorDate,
    template: recurrenceTemplate(task.data)
  };
  const rule = await client.from("task_recurrence_rules")
    .upsert(payload, { onConflict: "seed_task_id" })
    .select("*")
    .single();
  if (rule.error) return databaseError(rule.error);

  const linked = await client.from("tasks")
    .update({ recurrence_rule_id: rule.data.id })
    .eq("id", taskId)
    .select("id")
    .maybeSingle();
  if (linked.error) return databaseError(linked.error);
  if (!linked.data) return jsonError("重複規則已儲存，但未能連結任務；請重新整理後重試。", 409);

  await recordActivity(client, user.id, "task", taskId, "recurrence_save", "設定重複工作");
  return Response.json({ rule: rule.data }, { headers: privateHeaders() });
}

async function setTaskRecurrenceActive({ client, user }: RequestContext, body: Record<string, unknown>) {
  const id = uuidValue(body.id);
  if (!id || typeof body.isActive !== "boolean") return jsonError("重複工作設定不正確。", 400);
  const existing = await client.from("task_recurrence_rules")
    .select("id,seed_task_id,is_active")
    .eq("id", id)
    .maybeSingle();
  if (existing.error) return databaseError(existing.error);
  if (!existing.data) return jsonError("找不到重複工作或你沒有權限。", 404);
  const result = await client.from("task_recurrence_rules")
    .update({ is_active: body.isActive })
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (result.error) return databaseError(result.error);
  if (!result.data) return jsonError("更新重複工作被拒絕。", 403);
  await recordActivity(client, user.id, "task", existing.data.seed_task_id, body.isActive ? "recurrence_resume" : "recurrence_pause", body.isActive ? "恢復重複工作" : "暫停重複工作");
  return Response.json({ rule: result.data }, { headers: privateHeaders() });
}

async function saveProjectMilestone({ client, user }: RequestContext, body: Record<string, unknown>) {
  const id = uuidValue(body.id);
  const existing = id
    ? await client.from("project_milestones").select("*").eq("id", id).maybeSingle()
    : null;
  if (existing?.error) return databaseError(existing.error);
  if (id && !existing?.data) return jsonError("找不到里程碑或你沒有權限。", 404);

  const projectId = id ? String(existing?.data.project_id) : uuidValue(body.projectId);
  if (!projectId) return jsonError("請選擇有效項目。", 400);
  const title = requiredText(body.title ?? existing?.data.title, "請輸入里程碑名稱。");
  if (title instanceof Response) return title;
  const status = enumValue(body.status ?? existing?.data.status, ["active", "blocked", "completed", "cancelled"], "active")!;
  const payload = {
    project_id: projectId,
    created_by_id: user.id,
    title,
    description: nullableText(body.description ?? existing?.data.description),
    deadline: dateValue(body.deadline ?? existing?.data.deadline),
    status,
    critical: typeof body.critical === "boolean" ? body.critical : Boolean(existing?.data.critical)
  };
  const result = id
    ? await client.from("project_milestones").update({
        title: payload.title,
        description: payload.description,
        deadline: payload.deadline,
        status: payload.status,
        critical: payload.critical
      }).eq("id", id).select("*").single()
    : await client.from("project_milestones").insert(payload).select("*").single();
  if (result.error) return databaseError(result.error);
  await recordActivity(client, user.id, "operating_item", projectId, id ? "milestone_update" : "milestone_create", id ? "更新項目里程碑" : "新增項目里程碑");
  return Response.json({ milestone: result.data }, { status: id ? 200 : 201, headers: privateHeaders() });
}

async function deleteProjectMilestone({ client, user }: RequestContext, body: Record<string, unknown>) {
  const id = uuidValue(body.id);
  if (!id) return jsonError("里程碑識別碼不正確。", 400);
  const existing = await client.from("project_milestones").select("id,project_id").eq("id", id).maybeSingle();
  if (existing.error) return databaseError(existing.error);
  if (!existing.data) return jsonError("找不到里程碑或你沒有權限。", 404);
  const result = await client.from("project_milestones").delete().eq("id", id).select("id").maybeSingle();
  if (result.error) return databaseError(result.error);
  if (!result.data) return jsonError("刪除里程碑被拒絕。", 403);
  await recordActivity(client, user.id, "operating_item", existing.data.project_id, "milestone_delete", "刪除項目里程碑");
  return Response.json({ id: result.data.id }, { headers: privateHeaders() });
}

async function saveTransaction({ client, user }: RequestContext, body: Record<string, unknown>) {
  const id = uuidValue(body.id);
  if (id) {
    const existing = await client.from("transactions").select("user_id").eq("id", id).maybeSingle();
    if (existing.error) return databaseError(existing.error);
    if (!existing.data || existing.data.user_id !== user.id) return jsonError("只有擁有者可以修改此財務項目。", 403);
  }
  const item = requiredText(body.item, "請輸入項目名稱。");
  if (item instanceof Response) return item;
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 9999999999) return jsonError("金額必須大於 0。", 422);
  const type = enumValue(body.type, ["income","expense"], "expense")!;
  const status = type === "income"
    ? enumValue(body.status, ["expected","received","delayed","problem","cancelled"], "expected")
    : enumValue(body.status, ["unpaid","paid","problem","skipped","cancelled"], "unpaid");
  const payload = {
    user_id: user.id, scope: enumValue(body.scope, ["home","company"], "home"), type, item,
    category: nullableText(body.category), amount, expected_date: dateValue(body.expected_date), actual_date: dateValue(body.actual_date),
    frequency: enumValue(body.frequency, ["monthly","one_time","irregular"], "one_time"), status,
    payment_method: nullableText(body.payment_method), owner: nullableText(body.owner), proof_url: safeUrl(body.proof_url), notes: nullableText(body.notes)
  };
  const result = id
    ? await client.from("transactions").update(payload).eq("id", id).select("*").single()
    : await client.from("transactions").insert(payload).select("*").single();
  if (result.error) return databaseError(result.error);
  return Response.json({ transaction: result.data }, { status: id ? 200 : 201, headers: privateHeaders() });
}

async function saveMeeting({ client, user }: RequestContext, body: Record<string, unknown>) {
  const id = uuidValue(body.id);
  if (id) {
    const existing = await client.from("meetings").select("user_id").eq("id", id).maybeSingle();
    if (existing.error) return databaseError(existing.error);
    if (!existing.data || existing.data.user_id !== user.id) return jsonError("只有擁有者可以修改此會議。", 403);
  }
  const name = requiredText(body.meeting_name, "請輸入會議名稱。");
  if (name instanceof Response) return name;
  const payload: Record<string, unknown> = {
    user_id: user.id, scope: enumValue(body.scope, ["home","company"], "company"), meeting_name: name,
    meeting_date: dateValue(body.meeting_date), raw_notes: nullableText(body.raw_notes), summary: nullableText(body.summary)
  };
  if (body.archived_at) payload.archived_at = stringValue(body.archived_at);
  const result = id
    ? await client.from("meetings").update(payload).eq("id", id).select("*").single()
    : await client.from("meetings").insert(payload).select("*").single();
  if (result.error) return databaseError(result.error);
  return Response.json({ meeting: result.data }, { status: id ? 200 : 201, headers: privateHeaders() });
}

async function saveBalance({ client, user }: RequestContext, body: Record<string, unknown>) {
  const scope = enumValue(body.scope, ["home","company"], null);
  const month = dateValue(body.month);
  const openingBalance = Number(body.opening_balance);
  if (!scope || !month || !Number.isFinite(openingBalance)) return jsonError("期初結餘資料不正確。", 422);
  const result = await client.from("balances").upsert({ user_id: user.id, scope, month, opening_balance: openingBalance }, { onConflict: "user_id,scope,month" }).select("*").single();
  if (result.error) return databaseError(result.error);
  return Response.json({ balance: result.data }, { headers: privateHeaders() });
}

async function createOperatingItem({ client, user }: RequestContext, body: Record<string, unknown>) {
  const title = requiredText(body.title, "請輸入項目名稱。");
  if (title instanceof Response) return title;
  const payload = {
    item_type: enumValue(body.itemType, itemTypes, "note"),
    title,
    description: nullableText(body.description),
    status: enumValue(body.status, ["inbox","active","waiting","blocked","review","completed","cancelled"], "active"),
    area: enumValue(body.area, ["work","family","personal"], "personal"),
    owner_id: user.id,
    created_by_id: user.id,
    visibility: "private",
    due_date: dateValue(body.dueDate),
    next_action: nullableText(body.nextAction),
    sensitive: Boolean(body.sensitive),
    metadata: objectValue(body.metadata),
    last_progress_at: new Date().toISOString()
  };
  const result = await client.from("operating_items").insert(payload).select("*").single();
  if (result.error) return databaseError(result.error);
  await recordActivity(client, user.id, "operating_item", result.data.id, "create", "建立項目");
  return Response.json({ item: result.data }, { status: 201, headers: privateHeaders() });
}

async function updateOperatingItem({ client, user }: RequestContext, body: Record<string, unknown>) {
  const id = uuidValue(body.id);
  if (!id) return jsonError("項目識別碼不正確。", 400);
  const existing = await client.from("operating_items").select("owner_id").eq("id", id).maybeSingle();
  if (existing.error) return databaseError(existing.error);
  if (!existing.data) return jsonError("找不到項目或你沒有權限。", 404);
  const owner = existing.data.owner_id === user.id;
  const changes = objectValue(body.changes);
  const payload = pick(changes, owner ? ["title","description","status","due_date","next_action","metadata","archived_at","last_progress_at"] : ["status","last_progress_at"]);
  payload.last_progress_at = new Date().toISOString();
  const result = await client.from("operating_items").update(payload).eq("id", id).select("*").single();
  if (result.error) return databaseError(result.error);
  await recordActivity(client, user.id, "operating_item", id, payload.status === "completed" ? "complete" : "update", "更新項目");
  return Response.json({ item: result.data }, { headers: privateHeaders() });
}

async function shareResource({ client, user }: RequestContext, body: Record<string, unknown>) {
  const resourceType = enumValue(body.resourceType, ["task","operating_item"], null);
  const resourceId = uuidValue(body.resourceId);
  const email = stringValue(body.targetEmail).trim();
  if (!resourceType || !resourceId || !email) return jsonError("請選擇項目並輸入對方的完整電郵。", 400);
  const resource = resourceType === "task"
    ? await client.from("tasks").select("id,owner_id").eq("id", resourceId).maybeSingle()
    : await client.from("operating_items").select("id,owner_id,sensitive").eq("id", resourceId).maybeSingle();
  if (resource.error) return databaseError(resource.error);
  if (!resource.data || resource.data.owner_id !== user.id) return jsonError("只有擁有者可以分享。", 403);
  const isSensitive = "sensitive" in resource.data && Boolean(resource.data.sensitive);

  const target = await client.rpc("resolve_share_target", { target_email: email });
  if (target.error) return databaseError(target.error);
  const recipient = target.data?.[0];
  if (!recipient) return jsonError("找不到這個已啟用帳戶。請確認完整電郵。", 404);
  const shareType = enumValue(body.shareType, ["reference","assignment","joint"], "reference");
  const permission = shareType === "assignment" ? "update_status" : shareType === "joint" ? "co_owner" : enumValue(body.permission, ["view","comment","update_status","edit"], "view");
  const includeAttachments = Boolean(body.includeAttachments) && !isSensitive;
  const share = await client.from("share_records").insert({
    resource_type: resourceType,
    resource_id: resourceId,
    owner_id: user.id,
    shared_with_user_id: recipient.user_id,
    permission,
    share_type: shareType,
    include_attachments: includeAttachments,
    include_comments: Boolean(body.includeComments),
    include_linked_documents: Boolean(body.includeLinkedDocuments) && !isSensitive,
    include_subtasks: Boolean(body.includeSubtasks)
  }).select("*").single();
  if (share.error) return databaseError(share.error);

  if (shareType === "assignment") {
    const assignment = await client.from("assignments").insert({
      resource_type: resourceType,
      resource_id: resourceId,
      assigned_by_id: user.id,
      assigned_to_id: recipient.user_id,
      due_date: dateValue(body.dueDate),
      requested_priority: integerValue(body.requestedPriority, 1, 5) ?? 3,
      definition_of_done: nullableText(body.definitionOfDone),
      instructions: nullableText(body.instructions)
    });
    if (assignment.error) return databaseError(assignment.error);
  }
  if (shareType === "joint") {
    const joint = await client.from("joint_memberships").insert({
      resource_type: resourceType,
      resource_id: resourceId,
      user_id: recipient.user_id,
      invited_by_id: user.id,
      role: "co_owner"
    });
    if (joint.error) return databaseError(joint.error);
  }
  const visibility = shareType === "reference" ? "shared" : shareType === "assignment" ? "assigned" : "joint";
  if (resourceType === "task") await client.from("tasks").update({ visibility }).eq("id", resourceId);
  else await client.from("operating_items").update({ visibility }).eq("id", resourceId);
  await client.from("share_audit_logs").insert({
    resource_type: resourceType, resource_id: resourceId, actor_id: user.id,
    target_user_id: recipient.user_id, action: shareType === "assignment" ? "assign" : shareType === "joint" ? "joint_invite" : "share",
    new_permission: permission, metadata: { includeAttachments, includeComments: Boolean(body.includeComments) }
  });
  return Response.json({ share: share.data, recipient: { id: recipient.user_id, displayName: recipient.display_name } }, { status: 201, headers: privateHeaders() });
}

async function startTaskHandoff({ client, user }: RequestContext, body: Record<string, unknown>) {
  const taskId = uuidValue(body.taskId);
  const targetUserId = uuidValue(body.targetUserId);
  const note = requiredText(body.note, "請輸入交接 notes，讓對方知道下一步。");
  if (!taskId || !targetUserId) return jsonError("交接對象或任務識別碼不正確。", 400);
  if (targetUserId === user.id) return jsonError("請選擇另一位跟進者。", 422);
  if (note instanceof Response) return note;

  const result = await client.rpc("start_task_handoff", {
    p_task_id: taskId,
    p_target_user_id: targetUserId,
    p_note: note,
    p_due_date: dateValue(body.dueDate)
  });
  if (result.error) return databaseError(result.error);
  await recordActivity(client, user.id, "task", taskId, "handoff", "交俾對方跟進");
  return Response.json({ assignmentId: result.data }, { status: 201, headers: privateHeaders() });
}

async function reclaimTaskHandoff({ client, user }: RequestContext, body: Record<string, unknown>) {
  const assignmentId = uuidValue(body.assignmentId);
  const note = requiredText(body.note, "請輸入轉交 notes，讓雙方知道今次為何更改跟進者。");
  if (!assignmentId) return jsonError("交接識別碼不正確。", 400);
  if (note instanceof Response) return note;

  const found = await client
    .from("assignments")
    .select("resource_id,assigned_by_id")
    .eq("id", assignmentId)
    .maybeSingle();
  if (found.error) return databaseError(found.error);
  if (!found.data || found.data.assigned_by_id !== user.id) {
    return jsonError("只有目前交出任務的人可以直接收回跟進。", 403);
  }

  const result = await client.rpc("reclaim_task_handoff", {
    p_assignment_id: assignmentId,
    p_note: note
  });
  if (result.error) return databaseError(result.error);
  await recordActivity(client, user.id, "task", found.data.resource_id, "reclaim", "收回任務繼續跟進");
  return Response.json({ assignmentId: result.data }, { headers: privateHeaders() });
}

async function recordTaskHandoffProgress({ client, user }: RequestContext, body: Record<string, unknown>) {
  const assignmentId = uuidValue(body.assignmentId);
  const status = enumValue(body.status, ["in_progress","waiting","blocked"], null);
  const progress = integerValue(body.progress, 0, 100);
  const note = requiredText(body.note, "請輸入今次進度 notes。");
  if (!assignmentId || !status || progress === null) return jsonError("交接進度資料不正確。", 400);
  if (note instanceof Response) return note;

  const found = await client.from("assignments").select("resource_id,assigned_to_id").eq("id", assignmentId).maybeSingle();
  if (found.error) return databaseError(found.error);
  if (!found.data || found.data.assigned_to_id !== user.id) return jsonError("只有目前跟進者可以更新進度。", 403);
  const result = await client.rpc("record_task_handoff_progress", {
    p_assignment_id: assignmentId,
    p_status: status,
    p_progress: progress,
    p_note: note,
    p_next_step: nullableText(body.nextStep),
    p_waiting_until: timestampValue(body.waitingUntil)
  });
  if (result.error) return databaseError(result.error);
  await recordActivity(client, user.id, "task", found.data.resource_id, status, "更新交接進度");
  return Response.json({ assignmentId: result.data }, { headers: privateHeaders() });
}

async function resolveTaskHandoff({ client, user }: RequestContext, body: Record<string, unknown>) {
  const assignmentId = uuidValue(body.assignmentId);
  const resolution = enumValue(body.resolution, ["continue","return","close"], null);
  const note = requiredText(body.note, "請輸入今次完成了甚麼，讓下一手知道。");
  if (!assignmentId || !resolution) return jsonError("交接處理方式不正確。", 400);
  if (note instanceof Response) return note;

  const found = await client.from("assignments").select("resource_id,assigned_to_id").eq("id", assignmentId).maybeSingle();
  if (found.error) return databaseError(found.error);
  if (!found.data || found.data.assigned_to_id !== user.id) return jsonError("只有目前跟進者可以完成這一步。", 403);
  const result = await client.rpc("resolve_task_handoff_step", {
    p_assignment_id: assignmentId,
    p_resolution: resolution,
    p_note: note,
    p_next_step: nullableText(body.nextStep),
    p_waiting_until: timestampValue(body.waitingUntil)
  });
  if (result.error) return databaseError(result.error);
  await recordActivity(
    client,
    user.id,
    "task",
    found.data.resource_id,
    resolution === "close" ? "close" : resolution === "return" ? "return" : "step_complete",
    resolution === "close" ? "完全結案" : resolution === "return" ? "完成一步並交回上一手" : "完成一步並繼續跟進"
  );
  return Response.json({ assignmentId: result.data }, { headers: privateHeaders() });
}

async function respondToAssignment({ client, user }: RequestContext, body: Record<string, unknown>) {
  const id = uuidValue(body.id);
  const response = enumValue(body.response, ["accept","decline","clarification","alternative_date"], null);
  if (!id || !response) return jsonError("指派回應不正確。", 400);
  const found = await client.from("assignments").select("*").eq("id", id).maybeSingle();
  if (found.error) return databaseError(found.error);
  if (!found.data || found.data.assigned_to_id !== user.id || found.data.status !== "pending_acceptance") return jsonError("這項指派已處理或你沒有權限。", 403);
  const now = new Date().toISOString();
  const changes: Record<string, unknown> = response === "accept"
    ? { status: "accepted", accepted_at: now }
    : response === "decline"
      ? { status: "declined", declined_at: now, decline_reason: nullableText(body.reason) }
      : response === "clarification"
        ? { status: "clarification_requested", clarification_request: nullableText(body.reason) }
        : { status: "alternative_date_proposed", proposed_date: dateValue(body.proposedDate) };
  const result = await client.from("assignments").update(changes).eq("id", id).select("*").single();
  if (result.error) return databaseError(result.error);
  if (response === "accept") {
    const table = found.data.resource_type === "task" ? "tasks" : "operating_items";
    await client.from(table).update({ assignee_id: user.id }).eq("id", found.data.resource_id);
  }
  if (found.data.resource_type === "task") {
    const noteBody = response === "accept"
      ? "接受交接"
      : response === "decline"
        ? nullableText(body.reason) ?? "婉拒交接"
        : response === "clarification"
          ? nullableText(body.reason) ?? "要求補充資料"
          : `建議改期至 ${dateValue(body.proposedDate) ?? "未指定日期"}`;
    const noteResult = await client.from("task_handoff_notes").insert({
      assignment_id: id,
      task_id: found.data.resource_id,
      author_id: user.id,
      event_type: response === "accept" ? "accepted" : response === "decline" ? "declined" : "clarification",
      body: noteBody,
      progress: found.data.progress ?? 0
    });
    if (noteResult.error) return databaseError(noteResult.error);
  }
  await recordActivity(client, user.id, found.data.resource_type, found.data.resource_id, response, "回應指派");
  return Response.json({ assignment: result.data }, { headers: privateHeaders() });
}

async function respondToJoint({ client, user }: RequestContext, body: Record<string, unknown>) {
  const id = uuidValue(body.id);
  const accept = Boolean(body.accept);
  if (!id) return jsonError("共同項目邀請不正確。", 400);
  const found = await client.from("joint_memberships").select("*").eq("id", id).maybeSingle();
  if (found.error) return databaseError(found.error);
  if (!found.data || found.data.user_id !== user.id || found.data.accepted_at || found.data.removed_at) return jsonError("邀請已處理或你沒有權限。", 403);
  const result = await client.from("joint_memberships").update(accept ? { accepted_at: new Date().toISOString() } : { removed_at: new Date().toISOString() }).eq("id", id);
  if (result.error) return databaseError(result.error);
  return Response.json({ ok: true }, { headers: privateHeaders() });
}

async function revokeShare({ client, user }: RequestContext, body: Record<string, unknown>) {
  const id = uuidValue(body.id);
  if (!id) return jsonError("分享識別碼不正確。", 400);
  const found = await client.from("share_records").select("*").eq("id", id).maybeSingle();
  if (found.error) return databaseError(found.error);
  if (!found.data || found.data.owner_id !== user.id || found.data.revoked_at) return jsonError("找不到分享或你沒有權限。", 404);
  const now = new Date().toISOString();
  const result = await client.from("share_records").update({ revoked_at: now }).eq("id", id);
  if (result.error) return databaseError(result.error);
  await client.from("assignments").update({ status: "cancelled", cancelled_at: now })
    .eq("resource_type", found.data.resource_type).eq("resource_id", found.data.resource_id).eq("assigned_to_id", found.data.shared_with_user_id)
    .not("status", "in", "(completed,declined,cancelled)");
  await client.from("joint_memberships").update({ removed_at: now })
    .eq("resource_type", found.data.resource_type).eq("resource_id", found.data.resource_id).eq("user_id", found.data.shared_with_user_id).is("removed_at", null);
  await client.from("share_audit_logs").insert({
    resource_type: found.data.resource_type, resource_id: found.data.resource_id, actor_id: user.id,
    target_user_id: found.data.shared_with_user_id, action: "revoke", previous_permission: found.data.permission
  });
  return Response.json({ ok: true }, { headers: privateHeaders() });
}

async function saveSettings({ client, user }: RequestContext, body: Record<string, unknown>) {
  const settings = objectValue(body.settings);
  const payload = pick(settings, ["theme","language","accent_colour","gentle_mode","low_capacity_mode","dashboard_density","wip_limit","quiet_hours_start","quiet_hours_end","notification_mode","default_area","focus_minutes","monthly_profit_target","pinned_pages"]);
  const result = await client.from("user_settings").update(payload).eq("user_id", user.id).select("*").single();
  if (result.error) return databaseError(result.error);
  const displayName = stringValue(body.displayName).trim();
  if (displayName) {
    const profile = await client.from("user_profiles").update({ display_name: displayName }).eq("user_id", user.id);
    if (profile.error) return databaseError(profile.error);
  }
  return Response.json({ settings: result.data }, { headers: privateHeaders() });
}

async function saveNotificationPreferences(
  { client, user }: RequestContext,
  body: Record<string, unknown>
) {
  const source = objectValue(body.preferences);
  const timezone = stringValue(source.timezone).trim() || "Asia/Hong_Kong";
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
  } catch {
    return jsonError("通知時區不正確。", 422);
  }
  const timeFields = ["quietHoursStart", "quietHoursEnd", "todayReminderTime", "shutdownReminderTime"] as const;
  for (const field of timeFields) {
    if (!timeValue(source[field])) return jsonError("通知時間格式不正確。", 422);
  }
  const deadlineLeadMinutes = integerValue(source.deadlineLeadMinutes, 0, 10080);
  if (deadlineLeadMinutes === null) return jsonError("限期提前時間不正確。", 422);

  const payload = {
    user_id: user.id,
    browser_enabled: Boolean(source.browserEnabled),
    today_first_enabled: Boolean(source.todayFirstEnabled),
    deadline_enabled: Boolean(source.deadlineEnabled),
    waiting_enabled: Boolean(source.waitingEnabled),
    handover_enabled: Boolean(source.handoverEnabled),
    focus_enabled: Boolean(source.focusEnabled),
    shutdown_enabled: Boolean(source.shutdownEnabled),
    quiet_hours_enabled: Boolean(source.quietHoursEnabled),
    quiet_hours_start: timeValue(source.quietHoursStart),
    quiet_hours_end: timeValue(source.quietHoursEnd),
    night_shift_mode: Boolean(source.nightShiftMode),
    timezone,
    today_reminder_time: timeValue(source.todayReminderTime),
    shutdown_reminder_time: timeValue(source.shutdownReminderTime),
    deadline_lead_minutes: deadlineLeadMinutes,
    private_on_lock_screen: true,
    updated_at: new Date().toISOString()
  };
  const result = await client.from("notification_preferences")
    .upsert(payload, { onConflict: "user_id" })
    .select("*")
    .single();
  if (result.error) return databaseError(result.error);
  return Response.json({ preferences: result.data }, { headers: privateHeaders() });
}

async function savePushSubscription({ client }: RequestContext, body: Record<string, unknown>) {
  const subscription = objectValue(body.subscription);
  const keys = objectValue(subscription.keys);
  const endpoint = stringValue(subscription.endpoint).trim();
  const p256dh = stringValue(keys.p256dh).trim();
  const authKey = stringValue(keys.auth).trim();
  if (!isHttpsUrl(endpoint, 4000) || p256dh.length < 40 || p256dh.length > 500 || authKey.length < 10 || authKey.length > 500) {
    return jsonError("瀏覽器通知訂閱格式不正確。", 422);
  }
  const result = await client.rpc("save_push_subscription", {
    p_endpoint: endpoint,
    p_p256dh: p256dh,
    p_auth_key: authKey,
    p_user_agent: stringValue(body.userAgent).slice(0, 500) || null
  });
  if (result.error) return databaseError(result.error);
  return Response.json({ subscriptionId: result.data }, { headers: privateHeaders() });
}

async function removePushSubscription({ client }: RequestContext, body: Record<string, unknown>) {
  const endpoint = stringValue(body.endpoint).trim();
  if (!isHttpsUrl(endpoint, 4000)) return jsonError("瀏覽器通知訂閱格式不正確。", 422);
  const result = await client.rpc("remove_push_subscription", { p_endpoint: endpoint });
  if (result.error) return databaseError(result.error);
  return Response.json({ removed: Boolean(result.data) }, { headers: privateHeaders() });
}

async function scheduleFocusNotification({ client }: RequestContext, body: Record<string, unknown>) {
  const taskId = uuidValue(body.taskId);
  const sessionKey = uuidValue(body.sessionKey);
  const deliverAt = timestampValue(body.deliverAt);
  if (!taskId || !sessionKey || !deliverAt) return jsonError("Focus 提醒資料不正確。", 422);
  const result = await client.rpc("schedule_focus_notification", {
    p_task_id: taskId,
    p_deliver_at: deliverAt,
    p_session_key: sessionKey
  });
  if (result.error) return databaseError(result.error);
  return Response.json({ deliveryId: result.data ?? null }, { headers: privateHeaders() });
}

async function notificationDeliveryAction(
  { client }: RequestContext,
  body: Record<string, unknown>,
  rpc: "cancel_focus_notification" | "complete_local_notification" | "mark_notification_opened"
) {
  const deliveryId = uuidValue(body.deliveryId);
  if (!deliveryId) return jsonError("通知識別碼不正確。", 422);
  const result = await client.rpc(rpc, { p_delivery_id: deliveryId });
  if (result.error) return databaseError(result.error);
  return Response.json({ changed: Boolean(result.data) }, { headers: privateHeaders() });
}

function cancelFocusNotification(context: RequestContext, body: Record<string, unknown>) {
  return notificationDeliveryAction(context, body, "cancel_focus_notification");
}

function completeLocalNotification(context: RequestContext, body: Record<string, unknown>) {
  return notificationDeliveryAction(context, body, "complete_local_notification");
}

function markNotificationOpened(context: RequestContext, body: Record<string, unknown>) {
  return notificationDeliveryAction(context, body, "mark_notification_opened");
}

async function enqueueTestNotification({ client }: RequestContext) {
  const result = await client.rpc("enqueue_test_notification");
  if (result.error) return databaseError(result.error);
  if (!result.data) return jsonError("請先啟用瀏覽器通知。", 409);
  return Response.json({ deliveryId: result.data }, { headers: privateHeaders() });
}

async function saveCapacity({ client, user }: RequestContext, body: Record<string, unknown>) {
  const energyLevel = enumValue(body.energyLevel, ["low","medium","high"], null);
  if (!energyLevel) return jsonError("請選擇今日能量。", 400);
  const payload = {
    user_id: user.id,
    checkin_date: dateValue(body.date) ?? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong" }).format(new Date()),
    energy_level: energyLevel,
    available_minutes: integerValue(body.availableMinutes, 0, 1440),
    mode: enumValue(body.mode, ["normal","gentle","minimum_step","shift"], "normal"),
    essential_only: Boolean(body.essentialOnly),
    rest_day: Boolean(body.restDay),
    notes: nullableText(body.notes)
  };
  const result = await client.from("daily_capacity_checkins").upsert(payload, { onConflict: "user_id,checkin_date" }).select("*").single();
  if (result.error) return databaseError(result.error);
  return Response.json({ capacity: result.data }, { headers: privateHeaders() });
}

async function acceptTodayPlan({ client, user }: RequestContext, body: Record<string, unknown>) {
  const rawTaskIds = Array.isArray(body.taskIds) ? body.taskIds : [];
  const rawRoles = Array.isArray(body.roles) ? body.roles : [];
  if (rawTaskIds.length < 1 || rawTaskIds.length > 6 || rawTaskIds.length !== rawRoles.length) {
    return jsonError("今日建議內容不正確。", 422);
  }
  const taskIds = rawTaskIds.map(uuidValue);
  if (taskIds.some((id) => !id)) return jsonError("今日建議包含無效任務。", 422);
  const roles = rawRoles.map((role) => enumValue(role, ["now", "later", "quick_win"] as const, null));
  if (roles.some((role) => !role)) return jsonError("今日建議分類不正確。", 422);
  const planDate = dateValue(body.planDate);
  const idempotencyKey = uuidValue(body.idempotencyKey);
  if (!planDate || !idempotencyKey) return jsonError("今日建議日期或確認識別碼不正確。", 422);

  const result = await client.rpc("accept_today_auto_plan", {
    p_task_ids: taskIds as string[],
    p_plan_roles: roles as string[],
    p_plan_date: planDate,
    p_idempotency_key: idempotencyKey
  });
  if (result.error) return databaseError(result.error);
  for (const taskId of taskIds as string[]) {
    await recordActivity(client, user.id, "task", taskId, "today_plan_accept", "確認加入今日建議");
  }
  return Response.json({ acceptanceId: result.data }, { headers: privateHeaders() });
}

async function snoozeTodayTask({ client, user }: RequestContext, body: Record<string, unknown>) {
  const taskId = uuidValue(body.taskId);
  const untilDate = dateValue(body.untilDate);
  if (!taskId || !untilDate) return jsonError("請選擇有效的任務及日期。", 422);
  const visible = await client.from("tasks").select("id").eq("id", taskId).maybeSingle();
  if (visible.error) return databaseError(visible.error);
  if (!visible.data) return jsonError("找不到任務或你沒有權限。", 404);
  const result = await client.from("user_planning_metadata").upsert({
    user_id: user.id,
    resource_type: "task",
    resource_id: taskId,
    planned_date: null,
    snoozed_until: `${untilDate}T00:00:00+08:00`,
    plan_role: null,
    plan_source: null,
    accepted_at: null,
    plan_token: null,
    updated_at: new Date().toISOString()
  }, { onConflict: "user_id,resource_type,resource_id" });
  if (result.error) return databaseError(result.error);
  await recordActivity(client, user.id, "task", taskId, "today_plan_snooze", "延至指定日期再建議");
  return Response.json({ ok: true }, { headers: privateHeaders() });
}

async function adminResetPassword({ client, origin }: RequestContext, body: Record<string, unknown>) {
  const email = stringValue(body.email).trim().toLowerCase();
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) return jsonError("請輸入完整電郵地址。", 422);
  const prepared = await client.rpc("admin_prepare_password_reset", { target_email: email });
  if (prepared.error) {
    if (prepared.error.message.includes("ADMIN_REQUIRED")) return jsonError("只有管理員可以發送密碼重設郵件。", 403);
    if (prepared.error.message.includes("TARGET_NOT_FOUND")) return jsonError("找不到這個已啟用帳戶。", 404);
    return databaseError(prepared.error);
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return jsonError("伺服器尚未設定資料庫。", 503);
  const resetClient = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const reset = await resetClient.auth.resetPasswordForEmail(email, { redirectTo: `${origin}/` });
  if (reset.error) return jsonError("未能發送重設郵件，請稍後再試。", 429);
  return Response.json({ ok: true }, { headers: privateHeaders() });
}

async function search({ client }: RequestContext, query: string) {
  const q = query.trim().slice(0, 100);
  if (q.length < 2) return Response.json({ results: [] }, { headers: privateHeaders() });
  const pattern = `%${q.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
  const [tasks, items] = await Promise.all([
    client.from("tasks").select("id,title,area,status,due_date,visibility,owner_id").ilike("title", pattern).limit(20),
    client.from("operating_items").select("id,title,item_type,area,status,due_date,visibility,owner_id").ilike("title", pattern).limit(20)
  ]);
  if (tasks.error) return databaseError(tasks.error);
  if (items.error) return databaseError(items.error);
  const results = [
    ...(tasks.data ?? []).map((item) => ({ ...item, resourceType: "task", itemType: "task" })),
    ...(items.data ?? []).map((item) => ({ ...item, resourceType: "operating_item", itemType: item.item_type }))
  ].slice(0, 30);
  return Response.json({ results }, { headers: privateHeaders() });
}

async function taskCheckpoints({ client, user }: RequestContext, requestedTaskId: string) {
  const taskId = uuidValue(requestedTaskId);
  if (!taskId) return jsonError("任務識別碼不正確。", 400);
  const task = await client.from("tasks").select("id").eq("id", taskId).maybeSingle();
  if (task.error) return databaseError(task.error);
  if (!task.data) return jsonError("找不到任務或你沒有權限查看。", 404);

  const result = await client.from("task_checkpoints")
    .select("*")
    .eq("task_id", taskId)
    .order("last_worked_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(21);
  if (result.error) return databaseError(result.error);
  const rows = result.data ?? [];
  const checkpointIds = rows.map((item) => item.id);
  const resources = checkpointIds.length
    ? await client.from("task_checkpoint_resources")
      .select("checkpoint_id,label,url,position")
      .in("checkpoint_id", checkpointIds)
      .order("position", { ascending: true })
    : { data: [], error: null };
  if (resources.error) return databaseError(resources.error);
  const rowsWithPrivateResources = rows.map((item) => ({
    ...item,
    resource_links: (resources.data ?? [])
      .filter((resource) => resource.checkpoint_id === item.id)
      .map((resource) => ({ label: resource.label, url: resource.url }))
  }));
  const history = rowsWithPrivateResources.filter((item) => item.state === "saved").slice(0, 20);
  return Response.json({
    latest: history[0] ?? null,
    draft: rowsWithPrivateResources.find((item) => item.state === "draft" && item.author_id === user.id) ?? null,
    history
  }, { headers: privateHeaders() });
}

async function taskResources({ client }: RequestContext, requestedTaskId: string) {
  const taskId = uuidValue(requestedTaskId);
  if (!taskId) return jsonError("任務識別碼不正確。", 400);
  const task = await client.from("tasks").select("id").eq("id", taskId).maybeSingle();
  if (task.error) return databaseError(task.error);
  if (!task.data) return jsonError("找不到任務或你沒有權限查看。", 404);

  const result = await client.from("task_resources")
    .select("id,task_id,owner_id,resource_type,label,url,storage_bucket,storage_path,linked_item_id,contact_name,contact_phone,contact_email,share_with_task,created_at,updated_at")
    .eq("task_id", taskId)
    .order("updated_at", { ascending: false })
    .limit(50);
  if (result.error) return databaseError(result.error);
  return Response.json({ resources: result.data ?? [] }, { headers: privateHeaders() });
}

const taskResourceTypes = ["url", "document", "storage_file", "contact", "note", "sop", "decision", "project", "waiting"] as const;

type TaskResourceInput = {
  taskId: string;
  resourceType: (typeof taskResourceTypes)[number];
  label: string;
  url: string | null;
  storageBucket: string | null;
  storagePath: string | null;
  linkedItemId: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  shareWithTask: boolean;
};

function taskResourceInput(body: Record<string, unknown>): TaskResourceInput | Response {
  const taskId = uuidValue(body.taskId);
  const resourceType = enumValue(body.resourceType, taskResourceTypes, null);
  const label = resourceText(body.label, 200);
  if (!taskId || !resourceType || !label) return jsonError("請選擇有效任務、資源類型並輸入名稱。", 422);
  const url = safeUrl(body.url);
  const storageBucket = resourceText(body.storageBucket, 100);
  const storagePath = resourceText(body.storagePath, 1000);
  const linkedItemId = uuidValue(body.linkedItemId);
  const contactName = resourceText(body.contactName, 200);
  const contactPhone = resourceText(body.contactPhone, 80);
  const contactEmail = resourceText(body.contactEmail, 320)?.toLowerCase() ?? null;
  const shareWithTask = body.shareWithTask === true;

  if ((resourceType === "url" || resourceType === "document") && !url && !linkedItemId) {
    return jsonError("網址或文件請輸入有效的 HTTPS 連結，或選擇已有文件。", 422);
  }
  if (resourceType === "url" && linkedItemId) return jsonError("網址不可同時連結系統內項目。", 422);
  if (resourceType === "document" && Boolean(url) === Boolean(linkedItemId)) return jsonError("文件請只選擇一個網址或一份已有文件。", 422);
  if (resourceType === "storage_file") {
    if (!storageBucket || !storagePath || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(storageBucket) || storagePath.startsWith("/") || storagePath.split("/").some((part) => part === ".." || !part)) {
      return jsonError("請輸入有效的 Supabase Storage bucket 及 object path。", 422);
    }
  }
  if (resourceType === "contact") {
    if (!contactName || (!contactPhone && !contactEmail) || (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail))) {
      return jsonError("聯絡人請輸入姓名，以及電話或電郵。", 422);
    }
  }
  if (["note", "sop", "decision", "project", "waiting"].includes(resourceType) && !linkedItemId) {
    return jsonError("請選擇要連結的現有項目。", 422);
  }

  return {
    taskId,
    resourceType,
    label,
    url: resourceType === "url" || resourceType === "document" ? url : null,
    storageBucket: resourceType === "storage_file" ? storageBucket : null,
    storagePath: resourceType === "storage_file" ? storagePath : null,
    linkedItemId: resourceType === "document" || ["note", "sop", "decision", "project", "waiting"].includes(resourceType) ? linkedItemId : null,
    contactName: resourceType === "contact" ? contactName : null,
    contactPhone: resourceType === "contact" ? contactPhone : null,
    contactEmail: resourceType === "contact" ? contactEmail : null,
    shareWithTask
  };
}

async function createTaskResource({ client, user }: RequestContext, body: Record<string, unknown>) {
  const input = taskResourceInput(body);
  if (input instanceof Response) return input;
  const result = await client.from("task_resources").insert({
    task_id: input.taskId,
    owner_id: user.id,
    resource_type: input.resourceType,
    label: input.label,
    url: input.url,
    storage_bucket: input.storageBucket,
    storage_path: input.storagePath,
    linked_item_id: input.linkedItemId,
    contact_name: input.contactName,
    contact_phone: input.contactPhone,
    contact_email: input.contactEmail,
    share_with_task: input.shareWithTask
  }).select("*").single();
  if (result.error) return databaseError(result.error);
  await recordActivity(client, user.id, "task", input.taskId, "resource_added", "加入任務資源");
  return Response.json({ resource: result.data }, { headers: privateHeaders() });
}

async function setTaskResourceSharing({ client, user }: RequestContext, body: Record<string, unknown>) {
  const id = uuidValue(body.id);
  if (!id) return jsonError("資源識別碼不正確。", 422);
  const result = await client.from("task_resources")
    .update({ share_with_task: body.shareWithTask === true })
    .eq("id", id)
    .eq("owner_id", user.id)
    .select("id,task_id,share_with_task")
    .maybeSingle();
  if (result.error) return databaseError(result.error);
  if (!result.data) return jsonError("找不到這項私人資源，或你不能變更它。", 404);
  await recordActivity(client, user.id, "task", result.data.task_id, result.data.share_with_task ? "resource_shared" : "resource_made_private", result.data.share_with_task ? "明確分享任務資源" : "將任務資源改回私人");
  return Response.json({ resource: result.data }, { headers: privateHeaders() });
}

async function deleteTaskResource({ client, user }: RequestContext, body: Record<string, unknown>) {
  const id = uuidValue(body.id);
  if (!id) return jsonError("資源識別碼不正確。", 422);
  const existing = await client.from("task_resources").select("id,task_id").eq("id", id).eq("owner_id", user.id).maybeSingle();
  if (existing.error) return databaseError(existing.error);
  if (!existing.data) return jsonError("找不到這項私人資源，或你不能刪除它。", 404);
  const result = await client.from("task_resources").delete().eq("id", id).eq("owner_id", user.id);
  if (result.error) return databaseError(result.error);
  await recordActivity(client, user.id, "task", existing.data.task_id, "resource_removed", "移除任務資源");
  return Response.json({ id }, { headers: privateHeaders() });
}

async function openTaskStorageResource({ client }: RequestContext, body: Record<string, unknown>) {
  const id = uuidValue(body.id);
  if (!id) return jsonError("資源識別碼不正確。", 422);
  const resource = await client.from("task_resources")
    .select("resource_type,storage_bucket,storage_path")
    .eq("id", id)
    .maybeSingle();
  if (resource.error) return databaseError(resource.error);
  if (!resource.data || resource.data.resource_type !== "storage_file" || !resource.data.storage_bucket || !resource.data.storage_path) {
    return jsonError("找不到這個 Storage 檔案或你沒有權限。", 404);
  }
  const signed = await client.storage.from(resource.data.storage_bucket).createSignedUrl(resource.data.storage_path, 300);
  if (signed.error || !signed.data?.signedUrl) return jsonError("未能開啟這個 Storage 檔案。請確認檔案仍存在，並且你的 Storage 權限容許讀取。", 403);
  return Response.json({ url: signed.data.signedUrl }, { headers: privateHeaders() });
}

async function timeEstimateSuggestion({ client }: RequestContext, params: URLSearchParams) {
  const sourceType = enumValue(params.get("sourceType"), ["meeting_action", "deadline", "follow_up"] as const, null);
  const context = enumValue(params.get("context"), ["mobile", "computer", "home", "office", "phone", "night_shift"] as const, null);
  const energyLevel = enumValue(params.get("energyLevel"), ["low", "medium", "high"] as const, null);
  const estimatedMinutes = integerValue(params.get("estimatedMinutes"), 1, 14400);
  if (!sourceType || !context || !energyLevel || !estimatedMinutes) {
    return jsonError("估時建議的任務資料不正確。", 400);
  }
  const result = await client.rpc("time_estimate_suggestion", {
    p_task_type: sourceType,
    p_context: context,
    p_energy_level: energyLevel,
    p_estimated_minutes: estimatedMinutes
  });
  if (result.error) return databaseError(result.error);
  const suggestion = Array.isArray(result.data) ? result.data[0] ?? null : result.data ?? null;
  return Response.json({ suggestion }, { headers: privateHeaders() });
}

async function focusSessions({ client }: RequestContext, requestedTaskId: string) {
  const taskId = uuidValue(requestedTaskId);
  if (!taskId) return jsonError("任務識別碼不正確。", 400);
  const result = await client.from("focus_sessions")
    .select("id,task_id,user_id,client_session_id,planned_minutes,status,started_at,ended_at,paused_at,paused_seconds,actual_minutes,interruption_count,checkpoint_id,block_reason,created_at,updated_at")
    .eq("task_id", taskId)
    .order("started_at", { ascending: false })
    .limit(20);
  if (result.error) return databaseError(result.error);
  return Response.json({ sessions: result.data ?? [] }, { headers: privateHeaders() });
}

async function startFocusSession({ client }: RequestContext, body: Record<string, unknown>) {
  const clientSessionId = uuidValue(body.clientSessionId);
  const taskId = uuidValue(body.taskId);
  const plannedMinutes = integerValue(body.plannedMinutes, 15, 45);
  if (!clientSessionId || !taskId || !plannedMinutes || ![15, 25, 45].includes(plannedMinutes)) {
    return jsonError("專注時段資料不正確。", 400);
  }
  const result = await client.rpc("start_focus_session", {
    p_client_session_id: clientSessionId,
    p_task_id: taskId,
    p_planned_minutes: plannedMinutes
  });
  if (result.error) return databaseError(result.error);
  const session = Array.isArray(result.data) ? result.data[0] : result.data;
  if (!session) return jsonError("未能開始專注時段記錄。", 500);
  return Response.json({ session }, { status: 201, headers: privateHeaders() });
}

async function pauseFocusSession({ client }: RequestContext, body: Record<string, unknown>) {
  const sessionId = uuidValue(body.sessionId);
  if (!sessionId) return jsonError("專注時段識別碼不正確。", 400);
  const result = await client.rpc("pause_focus_session", { p_session_id: sessionId });
  if (result.error) return databaseError(result.error);
  const session = Array.isArray(result.data) ? result.data[0] : result.data;
  if (!session) return jsonError("未能暫停專注時段記錄。", 500);
  return Response.json({ session }, { headers: privateHeaders() });
}

async function resumeFocusSession({ client }: RequestContext, body: Record<string, unknown>) {
  const sessionId = uuidValue(body.sessionId);
  if (!sessionId) return jsonError("專注時段識別碼不正確。", 400);
  const result = await client.rpc("resume_focus_session", { p_session_id: sessionId });
  if (result.error) return databaseError(result.error);
  const session = Array.isArray(result.data) ? result.data[0] : result.data;
  if (!session) return jsonError("未能繼續專注時段記錄。", 500);
  return Response.json({ session }, { headers: privateHeaders() });
}

async function finishFocusSession({ client }: RequestContext, body: Record<string, unknown>) {
  const sessionId = uuidValue(body.sessionId);
  const status = enumValue(body.status, ["completed", "partial", "interrupted"] as const, null);
  const checkpointId = body.checkpointId ? uuidValue(body.checkpointId) : null;
  const blockReason = resourceText(body.blockReason, 2000);
  if (!sessionId || !status || (body.checkpointId && !checkpointId)) {
    return jsonError("專注時段完成資料不正確。", 400);
  }
  const result = await client.rpc("finish_focus_session", {
    p_session_id: sessionId,
    p_status: status,
    p_checkpoint_id: checkpointId,
    p_block_reason: blockReason
  });
  if (result.error) return databaseError(result.error);
  const session = Array.isArray(result.data) ? result.data[0] : result.data;
  if (!session) return jsonError("未能完成專注時段記錄。", 500);
  return Response.json({ session }, { headers: privateHeaders() });
}

async function inboxCaptureFiles({ client }: RequestContext, requestedInboxItemId: string) {
  const inboxItemId = uuidValue(requestedInboxItemId);
  if (!inboxItemId) return jsonError("收集箱識別碼不正確。", 400);
  const item = await client.from("operating_items").select("id,item_type").eq("id", inboxItemId).maybeSingle();
  if (item.error) return databaseError(item.error);
  if (!item.data || item.data.item_type !== "inbox") return jsonError("找不到收集箱內容或你沒有權限。", 404);
  const files = await client.from("inbox_capture_files")
    .select("id,inbox_item_id,object_path,file_name,content_type,byte_size,file_kind,raw_audio_retained,created_at")
    .eq("inbox_item_id", inboxItemId)
    .order("created_at", { ascending: true })
    .limit(10);
  if (files.error) return databaseError(files.error);
  return Response.json({ files: files.data ?? [] }, { headers: privateHeaders() });
}

async function openInboxCaptureFile({ client }: RequestContext, body: Record<string, unknown>) {
  const id = uuidValue(body.id);
  if (!id) return jsonError("附件識別碼不正確。", 422);
  const file = await client.from("inbox_capture_files")
    .select("bucket_id,object_path")
    .eq("id", id)
    .maybeSingle();
  if (file.error) return databaseError(file.error);
  if (!file.data) return jsonError("找不到這個私人附件或你沒有權限。", 404);
  const signed = await client.storage.from(file.data.bucket_id).createSignedUrl(file.data.object_path, 300);
  if (signed.error || !signed.data?.signedUrl) return jsonError("未能開啟附件。請確認檔案仍存在。", 403);
  return Response.json({ url: signed.data.signedUrl }, { headers: privateHeaders() });
}

async function saveTaskCheckpoint(
  { client, user }: RequestContext,
  body: Record<string, unknown>,
  state: "draft" | "saved"
) {
  const taskId = uuidValue(body.taskId);
  if (!taskId) return jsonError("任務識別碼不正確。", 400);
  const completedSummary = checkpointText(body.completedSummary, 4000, "剛完成的內容");
  if (completedSummary instanceof Response) return completedSummary;
  const currentPosition = checkpointText(body.currentPosition, 4000, "目前進度");
  if (currentPosition instanceof Response) return currentPosition;
  const nextMinimumStep = checkpointText(body.nextMinimumStep, 2000, "下一個最小步驟");
  if (nextMinimumStep instanceof Response) return nextMinimumStep;
  const blockedReason = checkpointText(body.blockedReason, 2000, "阻塞原因");
  if (blockedReason instanceof Response) return blockedReason;
  const resourceLinks = checkpointResources(body.resourceLinks);
  if (resourceLinks instanceof Response) return resourceLinks;

  const result = await client.rpc("save_task_checkpoint", {
    p_task_id: taskId,
    p_state: state,
    p_completed_summary: completedSummary,
    p_current_position: currentPosition,
    p_next_minimum_step: nextMinimumStep,
    p_resource_links: resourceLinks,
    p_blocked_reason: blockedReason
  });
  if (result.error) return databaseError(result.error);
  const checkpoint = Array.isArray(result.data) ? result.data[0] : result.data;
  if (!checkpoint) return jsonError("未能讀取已儲存的 checkpoint。", 500);
  if (state === "saved") {
    await recordActivity(client, user.id, "task", taskId, "checkpoint_saved", "已儲存工作重啟記錄");
  }
  return Response.json({
    checkpoint: { ...checkpoint, resource_links: resourceLinks }
  }, { headers: privateHeaders() });
}

async function recordActivity(client: SupabaseClient, actorId: string, resourceType: string, resourceId: string, action: string, summary: string) {
  await client.from("activity_logs").insert({ resource_type: resourceType, resource_id: resourceId, actor_id: actorId, action, summary });
}

const itemTypes = [
  "inbox","project","waiting","decision","client","sop","family_member","school","event","important_date","pet","household","shopping",
  "personal_admin","health","vehicle","document","note","goal","routine","finance"
] as const;

function inferDisplayName(user: User) {
  const metadata = user.user_metadata ?? {};
  const value = stringValue(metadata.display_name) || stringValue(metadata.full_name) || stringValue(metadata.name) || user.email?.split("@")[0] || "User";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function hkDateString() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

type RecurrenceOptions = {
  frequency: "daily" | "weekly" | "monthly" | "custom";
  weekdays: number[];
  customIntervalDays: number | null;
  businessDaysOnly: boolean;
  nightShiftPattern: boolean;
  nightShiftOnDays: number | null;
  nightShiftOffDays: number | null;
  cycleAnchorDate: string | null;
};

function recurrenceOptions(body: Record<string, unknown>): RecurrenceOptions | Response {
  const frequency = enumValue(body.frequency, ["daily", "weekly", "monthly", "custom"] as const, null);
  if (!frequency) return jsonError("請選擇有效的重複方式。", 422);
  const rawWeekdays = body.weekdays === undefined ? [] : body.weekdays;
  if (!Array.isArray(rawWeekdays) || rawWeekdays.length > 7) return jsonError("重複日子不正確。", 422);
  const weekdays = [...new Set(rawWeekdays.map((value) => integerValue(value, 0, 6)))];
  if (weekdays.some((value) => value === null)) return jsonError("重複日子不正確。", 422);
  const validWeekdays = weekdays as number[];
  if (frequency === "weekly" && validWeekdays.length === 0) return jsonError("每星期重複請至少選擇一天。", 422);

  const customIntervalDays = frequency === "custom"
    ? integerValue(body.customIntervalDays, 1, 3650)
    : null;
  if (frequency === "custom" && customIntervalDays === null) {
    return jsonError("自訂週期請填寫 1 至 3650 日。", 422);
  }
  const nightShiftPattern = typeof body.nightShiftPattern === "boolean" ? body.nightShiftPattern : false;
  const businessDaysOnly = typeof body.businessDaysOnly === "boolean" ? body.businessDaysOnly : false;
  const nightShiftOnDays = nightShiftPattern ? integerValue(body.nightShiftOnDays, 1, 365) : null;
  const nightShiftOffDays = nightShiftPattern ? integerValue(body.nightShiftOffDays, 0, 365) : null;
  if (nightShiftPattern && (nightShiftOnDays === null || nightShiftOffDays === null)) {
    return jsonError("夜更週期請填寫工作日和休息日數目。", 422);
  }
  const rawAnchor = stringValue(body.cycleAnchorDate);
  const cycleAnchorDate = rawAnchor ? dateValue(rawAnchor) : null;
  if (rawAnchor && !cycleAnchorDate) return jsonError("夜更週期開始日期不正確。", 422);

  return {
    frequency,
    weekdays: frequency === "weekly" ? validWeekdays : [],
    customIntervalDays,
    businessDaysOnly,
    nightShiftPattern,
    nightShiftOnDays,
    nightShiftOffDays,
    cycleAnchorDate
  };
}

function recurrenceTemplate(task: Record<string, unknown>) {
  const dueDate = dateValue(task.due_date);
  const followUpDate = dateValue(task.follow_up_date);
  const followUpOffsetDays = dueDate && followUpDate ? calendarDayDifference(followUpDate, dueDate) : null;
  const area = enumValue(task.area, ["work", "family", "personal"] as const, "personal")!;
  return {
    scope: area === "work" ? "company" : "home",
    area,
    sourceType: enumValue(task.source_type, ["meeting_action", "deadline", "follow_up"] as const, "follow_up"),
    title: stringValue(task.title).trim().slice(0, 500),
    description: nullableText(task.description),
    nextAction: nullableText(task.next_action),
    definitionOfDone: nullableText(task.definition_of_done),
    estimatedMinutes: integerValue(task.estimated_minutes, 0, 14400),
    energyLevel: enumValue(task.energy_level, ["low", "medium", "high"] as const, null),
    context: nullableText(task.context),
    risk: enumValue(task.risk, ["low", "medium", "high"] as const, "low"),
    criticalPath: Boolean(task.critical_path),
    safetyImpact: Boolean(task.safety_impact),
    childImpact: Boolean(task.child_impact),
    legalImpact: Boolean(task.legal_impact),
    estimatedDurationDays: integerValue(task.estimated_duration_days, 0, 3650),
    bufferDays: integerValue(task.buffer_days, 0, 365) ?? 0,
    projectId: uuidValue(task.project_id),
    followUpOffsetDays
  };
}

function calendarDayDifference(laterDate: string, earlierDate: string) {
  const later = Date.parse(`${laterDate}T00:00:00Z`);
  const earlier = Date.parse(`${earlierDate}T00:00:00Z`);
  const difference = Math.round((later - earlier) / 86_400_000);
  return Number.isFinite(difference) && difference >= 0 && difference <= 3650 ? difference : null;
}

function stringValue(value: unknown) { return typeof value === "string" ? value : ""; }
function nullableText(value: unknown) { const text = stringValue(value).trim(); return text ? text.slice(0, 10000) : null; }
function requiredText(value: unknown, message: string) { const text = stringValue(value).trim(); return text ? text.slice(0, 500) : jsonError(message, 422); }
function resourceText(value: unknown, maxLength: number) { const text = stringValue(value).trim(); return text ? text.slice(0, maxLength) : null; }
function dateValue(value: unknown) { const text = stringValue(value); return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null; }
function timeValue(value: unknown) { const text = stringValue(value); return /^([01]\d|2[0-3]):[0-5]\d$/.test(text) ? text : null; }
function timestampValue(value: unknown) { const text = stringValue(value).trim(); if (!text) return null; const date = new Date(text); return Number.isNaN(date.getTime()) ? null : date.toISOString(); }
function integerValue(value: unknown, min: number, max: number) { const number = Number(value); return Number.isInteger(number) && number >= min && number <= max ? number : null; }
function uuidValue(value: unknown) { const text = stringValue(value); return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text) ? text : null; }
function objectValue(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function enumValue<T extends readonly string[]>(value: unknown, allowed: T, fallback: T[number] | null): T[number] | null { const text = stringValue(value); return allowed.includes(text) ? text as T[number] : fallback; }
function pick(source: Record<string, unknown>, keys: readonly string[]) { return Object.fromEntries(Object.entries(source).filter(([key]) => keys.includes(key))); }
function safeUrl(value: unknown) { const text = stringValue(value).trim(); if (!text) return null; try { const url = new URL(text); return url.protocol === "https:" ? text.slice(0, 2000) : null; } catch { return null; } }
function isHttpsUrl(value: string, maxLength: number) { if (!value || value.length > maxLength) return false; try { return new URL(value).protocol === "https:"; } catch { return false; } }
function checkpointText(value: unknown, maxLength: number, label: string) {
  const text = stringValue(value).trim();
  if (text.length > maxLength) return jsonError(`${label}太長，請縮短後再儲存。`, 422);
  return text || null;
}
function checkpointResources(value: unknown) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 10) return jsonError("相關資源格式不正確；最多可加入 10 個連結。", 422);
  const resources: Array<{ label: string; url: string }> = [];
  for (const item of value) {
    const resource = objectValue(item);
    const url = safeUrl(resource.url);
    const label = stringValue(resource.label).trim();
    if (!url || label.length > 200) return jsonError("相關資源必須是有效的 HTTPS 網址。", 422);
    resources.push({ label: label || new URL(url).hostname, url });
  }
  return resources;
}
function inboxProcessingOptions(value: unknown): Record<string, string | number | null> | Response {
  const source = objectValue(value);
  const textLimits: Record<string, number> = {
    title: 500,
    description: 10000,
    nextAction: 5000,
    context: 500,
    notes: 10000,
    handoffNote: 5000
  };
  const result: Record<string, string | number | null> = {};
  for (const [key, maxLength] of Object.entries(textLimits)) {
    const raw = stringValue(source[key]).trim();
    if (raw.length > maxLength) return jsonError("收集箱處理內容太長，請縮短後再試。", 422);
    result[key] = raw || null;
  }

  const area = stringValue(source.area);
  if (area && !["work", "family", "personal"].includes(area)) {
    return jsonError("工作範圍不正確。", 422);
  }
  result.area = area || null;

  const energyLevel = stringValue(source.energyLevel);
  if (energyLevel && !["low", "medium", "high"].includes(energyLevel)) {
    return jsonError("能量需求不正確。", 422);
  }
  result.energyLevel = energyLevel || null;

  for (const key of ["dueDate", "plannedDate"] as const) {
    const raw = stringValue(source[key]);
    if (raw && !dateValue(raw)) return jsonError("日期格式不正確。", 422);
    result[key] = raw || null;
  }

  const estimatedRaw = source.estimatedMinutes;
  if (estimatedRaw === "" || estimatedRaw === null || estimatedRaw === undefined) {
    result.estimatedMinutes = null;
  } else {
    const estimated = integerValue(estimatedRaw, 0, 14400);
    if (estimated === null) return jsonError("預計時間必須是 0 至 14400 分鐘。", 422);
    result.estimatedMinutes = estimated;
  }

  const targetRaw = stringValue(source.handoffToUserId);
  const target = targetRaw ? uuidValue(targetRaw) : null;
  if (targetRaw && !target) return jsonError("交接對象不正確。", 422);
  result.handoffToUserId = target;
  return result;
}
function privateHeaders() { return { "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff" }; }
function jsonError(message: string, status: number) { return Response.json({ error: message }, { status, headers: privateHeaders() }); }
function databaseError(error: { code?: string; message?: string }) {
  if (error.code === "PGRST205" || error.message?.includes("Could not find the table")) return jsonError("資料庫尚未套用最新 privacy migration。", 503);
  if (error.message?.includes("NEXT_ACTION_REQUIRED")) return jsonError("開始任務前必須設定清晰的下一步。", 422);
  if (error.message?.includes("HANDOFF_NOTE_REQUIRED")) return jsonError("請輸入交接 notes。", 422);
  if (error.message?.includes("TASK_ALREADY_HANDED_OFF")) return jsonError("此任務已經有人跟進，請先完成目前交接。", 409);
  if (error.message?.includes("HANDOFF_TARGET_NOT_CONNECTED")) return jsonError("這位使用者尚未加入你的交接名單。", 422);
  if (error.message?.includes("INVALID_HANDOFF")) return jsonError("交接資料不正確，請重新檢查。", 422);
  if (error.message?.includes("CHECKPOINT_FORBIDDEN")) return jsonError("你沒有權限更新這項任務的工作記錄。", 403);
  if (error.message?.includes("CHECKPOINT_CONTENT_REQUIRED")) return jsonError("請至少填寫目前進度或下一個最小步驟。", 422);
  if (error.message?.includes("CHECKPOINT_RESOURCE_INVALID")) return jsonError("相關資源必須是有效的 HTTPS 網址。", 422);
  if (error.message?.includes("CHECKPOINT_IMMUTABLE")) return jsonError("已儲存的歷史記錄不可覆寫；請新增一筆。", 409);
  if (error.message?.includes("INBOX_PROCESSING_ACTION_INVALID") || error.message?.includes("INBOX_PROCESSING_INVALID")) return jsonError("收集箱處理資料不正確。", 422);
  if (error.message?.includes("INBOX_ITEM_NOT_AVAILABLE")) return jsonError("這項收集箱內容已處理或暫時不可用。", 409);
  if (error.message?.includes("INBOX_NEXT_ACTION_REQUIRED")) return jsonError("請輸入立即開始的下一個最小步驟。", 422);
  if (error.message?.includes("INBOX_DATE_REQUIRED")) return jsonError("請選擇安排日期。", 422);
  if (error.message?.includes("INBOX_HANDOFF_REQUIRED")) return jsonError("請選擇跟進者並輸入交接 notes。", 422);
  if (error.message?.includes("INBOX_UNDO_NOT_AVAILABLE") || error.message?.includes("INBOX_UNDO_EXPIRED")) return jsonError("最近一次處理已超過可安全撤銷的時間。", 409);
  if (error.message?.includes("INBOX_UNDO_NOT_LATEST")) return jsonError("只可撤銷最近一次處理。", 409);
  if (error.message?.includes("INBOX_UNDO_TARGET_CHANGED")) return jsonError("新項目已有進度，為保障資料不會自動撤銷。", 409);
  if (error.message?.includes("INBOX_UNDO_SOURCE_MISSING")) return jsonError("原始收集箱內容已不存在，未有改動其他資料。", 409);
  if (error.message?.includes("INVALID_PLAN_") || error.message?.includes("DUPLICATE_TASK") || error.message?.includes("PLAN_DATE_REQUIRED") || error.message?.includes("IDEMPOTENCY_KEY_REQUIRED")) return jsonError("今日建議內容不正確，未有加入任何任務。", 422);
  if (error.message?.includes("TASK_NOT_ELIGIBLE")) return jsonError("其中一項任務已完成、被阻塞或權限有變，請重新安排。", 409);
  if (error.message?.includes("RECURRENCE_SEED_TASK_OWNER_INVALID") || error.message?.includes("TASK_RECURRENCE_ACCESS_DENIED")) return jsonError("重複工作必須由任務擁有者設定。", 403);
  if (error.message?.includes("RECURRENCE_OWNER_REQUIRED") || error.message?.includes("RECURRENCE_CREATOR_REQUIRED") || error.message?.includes("RECURRENCE_IDENTITY_IMMUTABLE")) return jsonError("重複工作身份資料不可更改。", 403);
  if (error.message?.includes("RECURRENCE_TEMPLATE_INVALID") || error.message?.includes("RECURRENCE_DATE_NOT_FOUND")) return jsonError("重複工作設定不正確，未有建立下一項任務。", 422);
  if (error.message?.includes("BODY_DOUBLE_TARGET_NOT_CONNECTED")) return jsonError("這位夥伴未加入你的 Derek／Suki 信任連線。", 422);
  if (error.message?.includes("BODY_DOUBLE_TARGET_INVALID")) return jsonError("請選擇另一位已連線的專注夥伴。", 422);
  if (error.message?.includes("BODY_DOUBLE_DURATION_INVALID")) return jsonError("共用專注只支援 15、20、25 或 45 分鐘。", 422);
  if (error.message?.includes("BODY_DOUBLE_TASK_FORBIDDEN")) return jsonError("這項任務不可用於共用專注，可能已完成、封存或沒有權限。", 403);
  if (error.message?.includes("BODY_DOUBLE_ACTIVE_SESSION_EXISTS")) return jsonError("你和這位夥伴已有一個未結束的共用專注時段。", 409);
  if (error.message?.includes("BODY_DOUBLE_SESSION_FORBIDDEN") || error.message?.includes("BODY_DOUBLE_CANCEL_FORBIDDEN")) return jsonError("你沒有權限處理這個共用專注時段。", 403);
  if (error.message?.includes("BODY_DOUBLE_PARTICIPANTS_NOT_READY")) return jsonError("雙方先各自選好任務並按「準備好」，才可同步開始。", 409);
  if (error.message?.includes("BODY_DOUBLE_SESSION_NOT_READY")) return jsonError("這個共用專注時段已開始、結束或取消。", 409);
  if (error.message?.includes("BODY_DOUBLE_SESSION_NOT_RUNNING")) return jsonError("共用專注尚未開始或已結束。", 409);
  if (error.message?.includes("BODY_DOUBLE_PRESENCE_INVALID")) return jsonError("共用專注狀態不正確。", 422);
  if (error.message?.includes("BODY_DOUBLE_CHECKPOINT_REQUIRED")) return jsonError("請先儲存今節的 checkpoint，再完成自己的時段。", 409);
  if (error.message?.includes("BODY_DOUBLE_PARTICIPANT_FINISHED")) return jsonError("你已完成或離開這個共用專注時段。", 409);
  if (error.message?.includes("TASK_RESOURCE_OWNER_REQUIRED") || error.message?.includes("TASK_RESOURCE_FORBIDDEN")) return jsonError("你沒有權限管理這項任務的資源。", 403);
  if (error.message?.includes("TASK_RESOURCE_LINK_INVALID")) return jsonError("這個系統內項目不存在、類型不正確，或你沒有權限連結它。", 422);
  if (error.message?.includes("TASK_RESOURCE_IDENTITY_IMMUTABLE")) return jsonError("資源所屬任務及建立者不可直接修改；請移除後重新加入。", 409);
  if (error.message?.includes("TIME_ESTIMATE_INPUT_INVALID")) return jsonError("估時建議的任務資料不正確。", 422);
  if (error.message?.includes("FOCUS_SESSION_FORBIDDEN")) return jsonError("你沒有權限為這項任務記錄專注時段。", 403);
  if (error.message?.includes("FOCUS_SESSION_CHECKPOINT_INVALID")) return jsonError("這筆 checkpoint 不屬於這個任務或尚未安全儲存。", 422);
  if (error.message?.includes("FOCUS_SESSION_INPUT_INVALID")) return jsonError("專注時段資料不正確。", 422);
  if (error.message?.includes("AUTH_REQUIRED")) return jsonError("登入已失效，請重新登入。", 401);
  if (error.message?.includes("FORBIDDEN") || error.message?.includes("permission")) return jsonError("操作被權限規則拒絕。", 403);
  return jsonError("資料操作失敗，請稍後再試。", 500);
}
