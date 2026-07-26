import { NextRequest } from "next/server";
import { createRuleTaskAnalysis } from "@/lib/ai/manual-chatgpt";
import { taskAnalysisRequestSchema } from "@/lib/ai/schemas";
import { hashAIInput, redactSensitiveText } from "@/lib/ai/redact";
import { authenticateRequest, privateJson } from "@/lib/server/request-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const promptVersion = "task-analysis-v1";

export async function POST(request: NextRequest) {
  const context = await authenticateRequest(request);
  if (context instanceof Response) return context;
  const parsed = taskAnalysisRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return privateJson({ error: "任務識別碼不正確。" }, 422);

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

  const [task, settings] = await Promise.all([
    context.client.from("tasks")
      .select("id,title,description,next_action,definition_of_done,estimated_minutes,energy_level,context,due_date,risk,area,status")
      .eq("id", parsed.data.taskId)
      .maybeSingle(),
    context.client.from("user_settings")
      .select("support_profile")
      .eq("user_id", context.user.id)
      .maybeSingle()
  ]);
  if (task.error ?? settings.error) return privateJson({ error: (task.error ?? settings.error)!.message }, 500);
  if (!task.data) return privateJson({ error: "找不到任務或你沒有權限。" }, 404);

  const safeTask = {
    title: redactSensitiveText(task.data.title),
    description: redactSensitiveText(task.data.description ?? ""),
    nextAction: redactSensitiveText(task.data.next_action ?? ""),
    definitionOfDone: redactSensitiveText(task.data.definition_of_done ?? ""),
    estimatedMinutes: task.data.estimated_minutes,
    energyLevel: task.data.energy_level,
    context: task.data.context,
    dueDate: task.data.due_date,
    risk: task.data.risk,
    area: task.data.area,
    status: task.data.status
  };
  const suggestionOnlyPolicy = "只提供建議，不修改資料";
  const fallback = createRuleTaskAnalysis({
    title: task.data.title,
    nextAction: task.data.next_action,
    definitionOfDone: task.data.definition_of_done,
    estimatedMinutes: task.data.estimated_minutes,
    energyLevel: task.data.energy_level
  });
  await context.client.from("ai_analysis_events").insert({
    user_id: context.user.id,
    source_type: "task_analysis",
    source_id: task.data.id,
    model: "rules-engine",
    prompt_version: promptVersion,
    input_hash: hashAIInput(JSON.stringify({
      supportProfile: settings.data?.support_profile ?? "balanced",
      task: safeTask
    })),
    output_json: { ...fallback, policy: suggestionOnlyPolicy },
    source: "rules_fallback"
  });
  return privateJson({
    analysis: fallback,
    source: "rules_fallback",
    message: "已用免費規則引擎提供即時第一步；需要深度分析可使用 ChatGPT 貼回流程。"
  });
}
