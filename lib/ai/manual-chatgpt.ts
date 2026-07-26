import { taskAnalysisSchema, type TaskAnalysis } from "./schemas.ts";

export const chatGPTWebUrl = "https://chatgpt.com/";
export const manualChatGPTPromptVersion = "manual-chatgpt-task-v1";
export const maximumChatGPTResponseLength = 30_000;

export type ManualTaskPromptInput = {
  taskId: string;
  supportProfile: "adhd" | "depression" | "balanced";
  task: {
    title: string;
    description: string;
    nextAction: string;
    definitionOfDone: string;
    estimatedMinutes: number | null;
    energyLevel: "low" | "medium" | "high" | null;
    context: string | null;
    dueDate: string | null;
    risk: string | null;
    area: string | null;
    status: string;
  };
};

export function buildManualChatGPTTaskPrompt(input: ManualTaskPromptInput) {
  const supportInstruction = input.supportProfile === "adhd"
    ? "使用者有 ADHD：減少轉題、第一步必須係眼前可見動作、每步要細而明確，避免建立額外整理工作。"
    : input.supportProfile === "depression"
      ? "使用者受抑鬱及低能量影響：只保留必要步驟、使用中性無責備語氣、容許休息，優先提供可完成的小步。"
      : "使用平衡模式：以最少步驟、最低 effort 同清楚停止條件完成任務。";

  return `你係 Derek Control Panel 的任務拆解助手。請用香港繁體中文分析以下一項任務。

目標：
- 用最短時間及最低精神負擔推進任務。
- 不要新增不必要的行政、分類、文件或會議。
- 不要聲稱已修改任何任務、行事曆或資料庫。
- 不要提供醫療、法律、臨床或財務結論；相關內容只可整理，並在 warnings 提醒需要專業判斷。
- 資料不足時不要停止分析，把真正需要補充的內容放入 missingInformation。
- ${supportInstruction}

任務識別碼：
${input.taskId}

已遮罩的任務資料：
${JSON.stringify(input.task, null, 2)}

請只輸出一個 JSON object，不要加 Markdown、解釋或 code fence。必須完全使用以下結構：
{
  "taskId": "${input.taskId}",
  "analysis": {
    "clarifiedOutcome": "一句清楚、可完成的結果",
    "fastestPath": [
      {
        "action": "一個可以立即執行的動作",
        "minutes": 10,
        "energy": "low"
      }
    ],
    "firstTenMinutes": "現在開始後頭十分鐘只做甚麼",
    "stopCondition": "做到甚麼位置就可以安全停止或保存 checkpoint",
    "estimatedMinutes": 30,
    "canDelegate": false,
    "missingInformation": [],
    "effortReductionTips": [
      "一個真正減少時間或精神負擔的方法"
    ],
    "warnings": []
  }
}

限制：
- fastestPath 只可有 1 至 5 步。
- 每步 minutes 必須是 2 至 120 的整數。
- energy 只可是 low、medium 或 high。
- estimatedMinutes 必須是 5 至 480 的整數。
- missingInformation 最多 4 項。
- effortReductionTips 最多 4 項。
- warnings 最多 3 項。
- firstTenMinutes 必須可以不經再規劃就立即開始。`;
}

export function parseManualChatGPTTaskResponse(
  value: string,
  expectedTaskId?: string
): TaskAnalysis {
  const text = value.trim();
  if (!text) throw new Error("請先貼上 ChatGPT 回覆。");
  if (text.length > maximumChatGPTResponseLength) {
    throw new Error("ChatGPT 回覆太長；請只貼上最後的 JSON 分析結果。");
  }

  let sawTaskMismatch = false;
  let sawMissingTaskId = false;
  for (const candidate of jsonCandidates(text)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }
    if (!isRecord(parsed)) continue;

    const claimedTaskId = typeof parsed.taskId === "string" ? parsed.taskId : null;
    if (expectedTaskId) {
      if (!claimedTaskId) {
        sawMissingTaskId = true;
        continue;
      }
      if (claimedTaskId !== expectedTaskId) {
        sawTaskMismatch = true;
        continue;
      }
    }

    const analysisInput = isRecord(parsed.analysis)
      ? parsed.analysis
      : Object.fromEntries(Object.entries(parsed).filter(([key]) => key !== "taskId"));
    const analysis = taskAnalysisSchema.safeParse(analysisInput);
    if (analysis.success) return analysis.data;
  }

  if (sawTaskMismatch) {
    throw new Error("呢段回覆屬於另一項任務，請返回正確任務重新開啟 ChatGPT。");
  }
  if (sawMissingTaskId) {
    throw new Error("ChatGPT 回覆欠缺任務識別碼，請要求佢只重新輸出完整指定 JSON。");
  }
  throw new Error("未能讀取 ChatGPT 回覆。請在 ChatGPT 要求「只重新輸出指定 JSON」，再貼一次。");
}

export function createRuleTaskAnalysis(input: {
  title: string;
  nextAction?: string | null;
  definitionOfDone?: string | null;
  estimatedMinutes?: number | null;
  energyLevel?: "low" | "medium" | "high" | null;
}): TaskAnalysis {
  const estimatedMinutes = clampInteger(input.estimatedMinutes ?? 10, 5, 480);
  const firstStep = input.nextAction?.trim()
    || `先打開「${input.title}」需要嘅頁面或文件`;
  return {
    clarifiedOutcome: input.definitionOfDone?.trim() || `完成：${input.title}`,
    fastestPath: [{
      action: firstStep,
      minutes: clampInteger(estimatedMinutes, 2, 10),
      energy: input.energyLevel || "medium"
    }],
    firstTenMinutes: firstStep,
    stopCondition: "完成第一個可見動作後停一停，決定繼續或保存 Checkpoint。",
    estimatedMinutes,
    canDelegate: false,
    missingInformation: [],
    effortReductionTips: ["只開需要嘅一個頁面；暫時唔整理其他 backlog。"],
    warnings: []
  };
}

function jsonCandidates(value: string) {
  const candidates: string[] = [value];
  const marker = value.match(/DCP_TASK_ANALYSIS_START\s*([\s\S]*?)\s*DCP_TASK_ANALYSIS_END/i);
  if (marker?.[1]) candidates.unshift(marker[1].trim());
  for (const match of value.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    if (match[1]) candidates.unshift(match[1].trim());
  }
  const firstBrace = value.indexOf("{");
  const lastBrace = value.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(value.slice(firstBrace, lastBrace + 1));
  }
  return [...new Set(candidates.filter(Boolean))];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clampInteger(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}
