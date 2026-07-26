import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeSelections,
  packPlanIntoWindows,
  rulesFallbackSelections,
  validateWorkWindows,
  type PlannerCandidate
} from "../lib/ai/daily-planner.ts";
import { redactSensitiveText } from "../lib/ai/redact.ts";

const candidates: PlannerCandidate[] = [
  {
    taskId: "00000000-0000-4000-8000-000000000001",
    title: "準備重要文件",
    nextAction: "先打開文件清單",
    minutes: 25,
    score: 100,
    reasons: ["期限接近"],
    energy: "medium"
  },
  {
    taskId: "00000000-0000-4000-8000-000000000002",
    title: "回覆訊息",
    nextAction: "只寫第一句",
    minutes: 10,
    score: 80,
    reasons: ["可快速完成"],
    energy: "low"
  }
];

test("work windows must be valid and non-overlapping", () => {
  assert.throws(
    () => validateWorkWindows("2026-07-26", [
      { start: "09:00", end: "11:00" },
      { start: "10:30", end: "12:00" }
    ]),
    /不可重疊/
  );
  assert.throws(
    () => validateWorkWindows("2026-07-26", [{ start: "11:00", end: "10:00" }]),
    /遲過開始/
  );
});

test("AI selections cannot inject unknown tasks, duplicates, or exceed the server limit", () => {
  const normalized = normalizeSelections([
    {
      taskId: candidates[0].taskId,
      suggestedMinutes: 30,
      reason: "先處理限期",
      firstStep: "打開清單",
      effortTip: null
    },
    {
      taskId: candidates[0].taskId,
      suggestedMinutes: 20,
      reason: "重複",
      firstStep: "重複",
      effortTip: null
    },
    {
      taskId: "00000000-0000-4000-8000-000000000099",
      suggestedMinutes: 20,
      reason: "模型自行新增",
      firstStep: "不應出現",
      effortTip: null
    },
    {
      taskId: candidates[1].taskId,
      suggestedMinutes: 10,
      reason: "短工作",
      firstStep: "只寫第一句",
      effortTip: null
    }
  ], candidates, 1);

  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].taskId, candidates[0].taskId);
});

test("rules fallback remains usable when the model is unavailable", () => {
  const fallback = rulesFallbackSelections(candidates, 1);
  assert.equal(fallback.length, 1);
  assert.equal(fallback[0].firstStep, "先打開文件清單");
});

test("packed plans stay inside work windows, avoid confirmed schedules, and preserve buffer", () => {
  const packed = packPlanIntoWindows({
    date: "2026-07-26",
    workWindows: [{ start: "09:00", end: "12:00" }],
    busyWindows: [{
      start: "2026-07-26T01:30:00.000Z",
      end: "2026-07-26T02:00:00.000Z"
    }],
    bufferMinutes: 30,
    selections: rulesFallbackSelections(candidates, 2)
  });

  assert.equal(packed.length, 2);
  assert.equal(packed[0].startsAt, "2026-07-26T01:00:00.000Z");
  assert.ok(new Date(packed[0].endsAt) <= new Date("2026-07-26T01:30:00.000Z"));
  assert.ok(packed.every((item) => item.startsAt < item.endsAt));
  assert.ok(new Date(packed[packed.length - 1].endsAt) <= new Date("2026-07-26T03:30:00.000Z"));
});

test("a longer task can continue in a later window without overstating either block", () => {
  const packed = packPlanIntoWindows({
    date: "2026-07-26",
    workWindows: [
      { start: "09:00", end: "09:20" },
      { start: "14:00", end: "14:20" }
    ],
    bufferMinutes: 0,
    selections: [{
      taskId: candidates[0].taskId,
      suggestedMinutes: 35,
      reason: "限期接近",
      firstStep: "先打開文件清單",
      effortTip: null
    }]
  });

  assert.equal(packed.length, 2);
  assert.deepEqual(packed.map((item) => item.suggestedMinutes), [20, 15]);
  assert.equal(
    packed.reduce((total, item) => total + item.suggestedMinutes, 0),
    35
  );
});

test("AI inputs redact labelled names, addresses, contact and account identifiers", () => {
  const redacted = redactSensitiveText(
    "病人姓名：陳大文，電話 9123 4567，HKID A123456(7)，地址：香港西貢清水灣道88號\n帳戶 123456789012"
  );

  assert.doesNotMatch(redacted, /陳大文|9123 4567|A123456\(7\)|清水灣道|123456789012/);
  assert.match(redacted, /\[NAME\]|\[PHONE\]|\[HKID\]|\[ADDRESS\]|\[ACCOUNT_NUMBER\]/);
});

test("AI plan roles stay compatible with the existing Today acceptance transaction", () => {
  const selections = Array.from({ length: 6 }, (_, index) => ({
    taskId: `00000000-0000-4000-8000-00000000000${index + 1}`,
    suggestedMinutes: index < 4 ? 25 : 10,
    reason: "測試排序",
    firstStep: "做第一步",
    effortTip: null
  }));
  const packed = packPlanIntoWindows({
    date: "2026-07-26",
    workWindows: [{ start: "09:00", end: "13:00" }],
    bufferMinutes: 0,
    selections
  });
  const rolesByTask = new Map(packed.map((item) => [item.taskId, item.role]));
  const roles = [...rolesByTask.values()];

  assert.ok(roles.filter((role) => role === "now").length <= 1);
  assert.ok(roles.filter((role) => role === "later").length <= 2);
  assert.ok(roles.filter((role) => role === "quick_win").length <= 3);
  assert.equal(rolesByTask.has(selections[3].taskId), false);
});
