import { NextRequest } from "next/server";
import {
  buildManualChatGPTTaskPrompt,
  chatGPTWebUrl,
  createRuleTaskAnalysis,
  manualChatGPTPromptVersion,
  maximumChatGPTResponseLength,
  parseManualChatGPTTaskResponse,
  redactManualTaskForChatGPT
} from "@/lib/ai/manual-chatgpt";
import { hashAIInput } from "@/lib/ai/redact";
import { taskAnalysisRequestSchema } from "@/lib/ai/schemas";
import { authenticateRequest, privateJson } from "@/lib/server/request-context";
import type { EnergyLevel, SupportProfile } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const context = await authenticateRequest(request);
  if (context instanceof Response) return context;

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const action = body?.action === "import" ? "import" : "prepare";
  const parsed = taskAnalysisRequestSchema.safeParse({ taskId: body?.taskId });
  if (!parsed.success) return privateJson({ error: "任務識別碼不正確。" }, 422);

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
  if (task.error ?? settings.error) {
    return privateJson({ error: (task.error ?? settings.error)!.message }, 500);
  }
  if (!task.data) return privateJson({ error: "找不到任務或你沒有權限。" }, 404);

  const supportProfile = normalizeSupportProfile(settings.data?.support_profile);
  const safeTask = redactManualTaskForChatGPT({
    title: task.data.title,
    description: task.data.description ?? "",
    nextAction: task.data.next_action ?? "",
    definitionOfDone: task.data.definition_of_done ?? "",
    estimatedMinutes: task.data.estimated_minutes,
    energyLevel: normalizeEnergy(task.data.energy_level),
    context: task.data.context,
    dueDate: task.data.due_date,
    risk: task.data.risk,
    area: task.data.area,
    status: task.data.status
  });

  if (action === "prepare") {
    return privateJson({
      chatGPTUrl: chatGPTWebUrl,
      prompt: buildManualChatGPTTaskPrompt({
        taskId: task.data.id,
        supportProfile,
        task: safeTask
      }),
      quickSuggestion: createRuleTaskAnalysis({
        title: safeTask.title,
        nextAction: safeTask.nextAction,
        definitionOfDone: safeTask.definitionOfDone,
        estimatedMinutes: safeTask.estimatedMinutes,
        energyLevel: safeTask.energyLevel
      }),
      privacyMessage: "系統已遮罩常見姓名、電話、地址、電郵、HKID、帳戶及 reference；仍請在送出前快速檢查一次。"
    });
  }

  const responseText = typeof body?.responseText === "string" ? body.responseText : "";
  if (!responseText.trim()) return privateJson({ error: "請先貼上 ChatGPT 回覆。" }, 422);
  if (responseText.length > maximumChatGPTResponseLength) {
    return privateJson({ error: "ChatGPT 回覆太長；請只貼上最後的 JSON 分析結果。" }, 413);
  }

  const recent = await context.client
    .from("ai_analysis_events")
    .select("id", { count: "exact", head: true })
    .eq("user_id", context.user.id)
    .eq("model", "chatgpt-manual")
    .gte("created_at", new Date(Date.now() - 24 * 60 * 60_000).toISOString());
  if (!recent.error && (recent.count ?? 0) >= 50) {
    return privateJson({ error: "今日已匯入很多分析，請稍後再試，避免重複建立建議。" }, 429);
  }

  let analysis;
  try {
    analysis = parseManualChatGPTTaskResponse(responseText, task.data.id);
  } catch (error) {
    return privateJson({
      error: error instanceof Error ? error.message : "未能讀取 ChatGPT 回覆。"
    }, 422);
  }

  const event = await context.client.from("ai_analysis_events").insert({
    user_id: context.user.id,
    source_type: "task_analysis",
    source_id: task.data.id,
    model: "chatgpt-manual",
    prompt_version: manualChatGPTPromptVersion,
    input_hash: hashAIInput(responseText),
    output_json: analysis,
    source: "ai"
  }).select("id").single();
  if (event.error) return privateJson({ error: event.error.message }, 500);

  return privateJson({
    analysis,
    eventId: event.data.id,
    source: "manual_chatgpt",
    message: "已讀取 ChatGPT 建議；尚未修改任務。"
  });
}

export async function PATCH(request: NextRequest) {
  const context = await authenticateRequest(request);
  if (context instanceof Response) return context;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const eventId = typeof body?.eventId === "string" ? body.eventId : "";
  if (!/^[0-9a-f-]{36}$/i.test(eventId)) {
    return privateJson({ error: "分析記錄識別碼不正確。" }, 422);
  }

  const event = await context.client.from("ai_analysis_events")
    .update({ accepted_at: new Date().toISOString() })
    .eq("id", eventId)
    .eq("user_id", context.user.id)
    .eq("model", "chatgpt-manual")
    .is("accepted_at", null)
    .select("id")
    .maybeSingle();
  if (event.error) return privateJson({ error: event.error.message }, 500);
  return privateJson({ accepted: Boolean(event.data) });
}

function normalizeSupportProfile(value: unknown): SupportProfile {
  return value === "adhd" || value === "depression" ? value : "balanced";
}

function normalizeEnergy(value: unknown): EnergyLevel | null {
  return value === "low" || value === "medium" || value === "high" ? value : null;
}
