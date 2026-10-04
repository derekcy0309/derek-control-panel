import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildManualChatGPTBreakdownPrompt,
  buildManualChatGPTTaskPrompt,
  createRuleTaskAnalysis,
  maximumChatGPTResponseLength,
  parseManualChatGPTBreakdownResponse,
  parseManualChatGPTTaskResponse,
  redactManualTaskForChatGPT
} from "../lib/ai/manual-chatgpt.ts";

const taskId = "00000000-0000-4000-8000-000000000001";
const analysis = {
  clarifiedOutcome: "完成申請文件清單",
  fastestPath: [{
    action: "打開申請頁並列出三份尚欠文件",
    minutes: 10,
    energy: "low"
  }],
  firstTenMinutes: "打開申請頁並列出三份尚欠文件",
  stopCondition: "列出尚欠文件後保存 checkpoint。",
  estimatedMinutes: 30,
  canDelegate: false,
  missingInformation: [],
  effortReductionTips: ["只開申請頁，不整理其他文件。"],
  warnings: []
};

test("manual ChatGPT prompt binds one redacted task to a strict paste-back shape", () => {
  const prompt = buildManualChatGPTTaskPrompt({
    taskId,
    supportProfile: "adhd",
    task: {
      title: "完成申請",
      description: "[NAME] 的資料",
      nextAction: "打開申請頁",
      definitionOfDone: "",
      estimatedMinutes: 30,
      energyLevel: "medium",
      context: "computer",
      dueDate: "2026-07-30",
      risk: "medium",
      area: "personal",
      status: "not_started"
    }
  });

  assert.match(prompt, new RegExp(taskId));
  assert.match(prompt, /ADHD/);
  assert.match(prompt, /只輸出一個 JSON object/);
  assert.match(prompt, /"analysis"/);
  assert.doesNotMatch(prompt, /API key|Vercel AI Gateway/);
});

test("manual ChatGPT redacts every free-text task field before copy-out", () => {
  const safeTask = redactManualTaskForChatGPT({
    title: "name: Suki",
    description: "請聯絡 derek_msc@hotmail.com",
    nextAction: "致電 9123 4567",
    definitionOfDone: "完成 address: 1 Privacy Road",
    estimatedMinutes: 20,
    energyLevel: "low",
    context: "address: Flat 9, Private House",
    dueDate: "2026-07-30",
    risk: "客戶 email: client@example.com",
    area: "name: Derek",
    status: "not_started"
  });

  assert.equal(safeTask.title, "[NAME]");
  assert.equal(safeTask.description, "請聯絡 [EMAIL]");
  assert.equal(safeTask.nextAction, "致電 [PHONE]");
  assert.equal(safeTask.definitionOfDone, "完成 [ADDRESS]");
  assert.equal(safeTask.context, "[ADDRESS]");
  assert.equal(safeTask.risk, "客戶 email: [EMAIL]");
  assert.equal(safeTask.area, "[NAME]");
});

test("manual ChatGPT paste-back accepts exact JSON and fenced JSON", () => {
  const exact = parseManualChatGPTTaskResponse(JSON.stringify({ taskId, analysis }), taskId);
  assert.equal(exact.firstTenMinutes, analysis.firstTenMinutes);

  const fenced = parseManualChatGPTTaskResponse(
    `完成，以下是結果：\n\`\`\`json\n${JSON.stringify({ taskId, analysis })}\n\`\`\``,
    taskId
  );
  assert.equal(fenced.estimatedMinutes, 30);
});

test("manual ChatGPT paste-back rejects another task and invalid fields", () => {
  assert.throws(
    () => parseManualChatGPTTaskResponse(JSON.stringify({
      taskId: "00000000-0000-4000-8000-000000000002",
      analysis
    }), taskId),
    /另一項任務/
  );
  assert.throws(
    () => parseManualChatGPTTaskResponse(JSON.stringify({ analysis }), taskId),
    /欠缺任務識別碼/
  );
  assert.throws(
    () => parseManualChatGPTTaskResponse(JSON.stringify({
      taskId,
      analysis: { ...analysis, estimatedMinutes: 9999 }
    }), taskId),
    /未能讀取/
  );
});

test("manual ChatGPT paste-back is bounded and rules still provide an immediate first step", () => {
  assert.throws(
    () => parseManualChatGPTTaskResponse("x".repeat(maximumChatGPTResponseLength + 1), taskId),
    /太長/
  );
  const fallback = createRuleTaskAnalysis({
    title: "整理文件",
    nextAction: "先打開文件清單",
    estimatedMinutes: 25,
    energyLevel: "low"
  });
  assert.equal(fallback.firstTenMinutes, "先打開文件清單");
  assert.equal(fallback.fastestPath[0].minutes, 10);

  const bounded = createRuleTaskAnalysis({
    title: "極短任務",
    estimatedMinutes: 1
  });
  assert.equal(bounded.estimatedMinutes, 5);
  assert.equal(bounded.fastestPath[0].minutes, 5);
});

test("AI breakdown prompt binds one redacted task and only proposes child steps", () => {
  const safe = redactManualTaskForChatGPT({
    title: "name: Suki", description: "致電 9123 4567", nextAction: "", definitionOfDone: "",
    estimatedMinutes: null, energyLevel: null, context: null, dueDate: null,
    risk: null, area: null, status: "not_started"
  });
  const prompt = buildManualChatGPTBreakdownPrompt({
    taskId, task: { title: safe.title, description: safe.description, dueDate: safe.dueDate }
  });
  assert.match(prompt, /可獨立完成的小步驟/);
  assert.match(prompt, new RegExp(taskId));
  assert.match(prompt, /只係提出建議/);
  assert.doesNotMatch(prompt, /9123 4567|Suki/);
});

test("AI breakdown paste-back validates task ID, shape, limits and duplicates", () => {
  const valid = { taskId, breakdown: { steps: [{ title: "打開文件", minutes: 5 }, { title: "列出欠缺資料", minutes: 10 }] } };
  assert.equal(parseManualChatGPTBreakdownResponse(JSON.stringify(valid), taskId).steps.length, 2);
  assert.equal(parseManualChatGPTBreakdownResponse(`\`\`\`json\n${JSON.stringify(valid)}\n\`\`\``, taskId).steps[0].title, "打開文件");
  assert.throws(() => parseManualChatGPTBreakdownResponse(JSON.stringify({ ...valid, taskId: "other" }), taskId), /另一項任務/);
  assert.throws(() => parseManualChatGPTBreakdownResponse(JSON.stringify({ breakdown: valid.breakdown }), taskId), /欠缺任務識別碼/);
  assert.throws(() => parseManualChatGPTBreakdownResponse(JSON.stringify({ taskId, breakdown: { steps: [] } }), taskId), /未能讀取/);
  assert.throws(() => parseManualChatGPTBreakdownResponse(JSON.stringify({ taskId, breakdown: { steps: Array(7).fill({ title: "一步", minutes: 5 }) } }), taskId), /未能讀取/);
  assert.throws(() => parseManualChatGPTBreakdownResponse(JSON.stringify({ taskId, breakdown: { steps: [{ title: "重複", minutes: 5 }, { title: "重複", minutes: 10 }] } }), taskId), /未能讀取/);
});

test("AI breakdown stays user-confirmed, idempotent and limited to the parent task", () => {
  const route = readFileSync("app/api/chatgpt/task-assistant/route.ts", "utf8");
  const panel = readFileSync("components/tasks/AIBreakdownPanel.tsx", "utf8");
  assert.match(route, /task\.data\.owner_id !== context\.user\.id/);
  assert.match(route, /output_json: \{ stepCount: breakdown\.steps\.length \}/);
  assert.match(panel, /確認建立已勾選子任務/);
  assert.match(panel, /clientRequestId: step\.id/);
  assert.match(panel, /parentTaskId: parent\.id/);
  assert.match(panel, /createdTaskId/);
  assert.doesNotMatch(panel, /OPENAI_API_KEY|AI_GATEWAY_API_KEY/);
});
