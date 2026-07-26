import test from "node:test";
import assert from "node:assert/strict";
import {
  buildManualChatGPTTaskPrompt,
  createRuleTaskAnalysis,
  maximumChatGPTResponseLength,
  parseManualChatGPTTaskResponse
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
