import { generateText, Output } from "ai";
import { NextRequest } from "next/server";
import { taskAnalysisRequestSchema, taskAnalysisSchema } from "@/lib/ai/schemas";
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
  const model = process.env.AI_MODEL || "openai/gpt-5.4";
  try {
    const result = await generateText({
      model,
      output: Output.object({
        schema: taskAnalysisSchema,
        name: "derek_control_panel_task_analysis",
        description: "A short, actionable path that reduces activation energy for one task."
      }),
      system: `你係香港繁體中文任務拆解助手，只提供建議，不修改資料。
用最少步驟同最低 effort 達成任務，不製造額外行政工作。
ADHD 模式：第一步必須係眼前可見動作，減少轉題，設定清楚 stop condition。
Depression 模式：只保留必要步驟、語氣中性、避免責備或把休息描述成失敗。
不得提供醫療、法律、臨床或財務結論；相關內容只可整理並加警告。
不得推斷輸入沒有提供的個人資料。`,
      prompt: JSON.stringify({
        supportProfile: settings.data?.support_profile ?? "balanced",
        task: safeTask
      })
    });
    await context.client.from("ai_analysis_events").insert({
      user_id: context.user.id,
      source_type: "task_analysis",
      source_id: task.data.id,
      model,
      prompt_version: promptVersion,
      input_hash: hashAIInput(JSON.stringify(safeTask)),
      output_json: result.output,
      source: "ai"
    });
    return privateJson({ analysis: result.output });
  } catch {
    const firstStep = task.data.next_action?.trim()
      || `先打開「${task.data.title}」需要嘅頁面或文件`;
    const fallback = {
      clarifiedOutcome: task.data.definition_of_done?.trim() || `完成：${task.data.title}`,
      fastestPath: [{
        action: firstStep,
        minutes: Math.min(10, task.data.estimated_minutes || 10),
        energy: task.data.energy_level || "medium"
      }],
      firstTenMinutes: firstStep,
      stopCondition: "完成第一個可見動作後停一停，決定繼續或保存 Checkpoint。",
      estimatedMinutes: task.data.estimated_minutes || 10,
      canDelegate: false,
      missingInformation: [],
      effortReductionTips: ["只開需要嘅一個頁面；暫時唔整理其他 backlog。"],
      warnings: ["AI 暫時未連接，現時顯示安全規則式建議。"]
    };
    await context.client.from("ai_analysis_events").insert({
      user_id: context.user.id,
      source_type: "task_analysis",
      source_id: task.data.id,
      model,
      prompt_version: promptVersion,
      input_hash: hashAIInput(JSON.stringify(safeTask)),
      output_json: fallback,
      source: "rules_fallback"
    });
    return privateJson({ analysis: fallback, source: "rules_fallback" });
  }
}
