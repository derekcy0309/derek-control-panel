import test from "node:test";
import assert from "node:assert/strict";
import { activeWipCount, calculateLatestSafeStart, classifyDeadlineRisk, isStaleTask, notificationPreview, profitTargetGap, recommendTodayTasks, suggestSmallerStep, validateNextAction, waitingAge, weightedPipelineRevenue } from "../lib/planning.ts";
import type { Assignment, Task, UserSettings } from "../lib/types.ts";

const baseTask: Task = { id: "t1", user_id: "derek", scope: "company", source_type: "deadline", title: "測試", owner: null, due_date: "2026-07-30", follow_up_date: null, status: "not_started", next_action: "開啟文件", risk: "low", notes: null, completed_at: null, deleted_at: null, archived_at: null, created_at: "2026-07-01T00:00:00Z", updated_at: "2026-07-20T00:00:00Z", owner_id: "derek", created_by_id: "derek", area: "work", visibility: "private" };
const settings = { id: "s", user_id: "derek", email: null, daily_reminder_time: "09:00", default_reminder_days: 3, created_at: "", updated_at: "", gentle_mode: false, wip_limit: 3 } satisfies UserSettings;

test("latest safe start subtracts duration and buffer", () => assert.equal(calculateLatestSafeStart("2026-07-30", 5, 2), "2026-07-23"));
test("latest safe start handles missing date", () => assert.equal(calculateLatestSafeStart(null, 5, 2), null));
test("deadline overdue", () => assert.equal(classifyDeadlineRisk({ dueDate: "2026-07-21" }, "2026-07-22"), "overdue"));
test("missed safe start is high risk", () => assert.equal(classifyDeadlineRisk({ dueDate: "2026-07-30", latestSafeStartDate: "2026-07-21" }, "2026-07-22"), "high_risk"));
test("waiting external remains explicit", () => assert.equal(classifyDeadlineRisk({ dueDate: "2026-08-30", waitingExternal: true }, "2026-07-22"), "waiting_external"));
test("completed task is normal", () => assert.equal(classifyDeadlineRisk({ dueDate: "2026-07-01", status: "done" }, "2026-07-22"), "normal"));
test("next action required for in progress", () => assert.equal(validateNextAction("in_progress", ""), false));
test("next action not required for inbox", () => assert.equal(validateNextAction("not_started", ""), true));
test("stale task detection uses fixed date", () => assert.equal(isStaleTask({ ...baseTask, last_progress_at: "2026-07-10T00:00:00Z" }, "2026-07-22"), true));
test("completed task is not stale", () => assert.equal(isStaleTask({ ...baseTask, status: "done" }, "2026-07-22"), false));
test("waiting aging bands", () => assert.deepEqual(waitingAge("2026-07-08", "2026-07-22"), { days: 14, band: "14日以上" }));
test("weighted pipeline revenue", () => assert.equal(weightedPipelineRevenue([{ monthlyRevenue: 10000, conversionProbability: .5 }, { monthlyRevenue: 20000, conversionProbability: .25 }]), 10000));
test("profit target gap never negative", () => { assert.equal(profitTargetGap(50000, 42000), 8000); assert.equal(profitTargetGap(50000, 60000), 0); });
test("today recommendation prioritizes safety impact", () => { const result = recommendTodayTasks({ tasks: [baseTask, { ...baseTask, id: "t2", title: "安全", safety_impact: true, due_date: "2026-08-30" }], assignments: [], currentUserId: "derek", settings, capacity: null, today: "2026-07-22" }); assert.equal(result.primary?.task.id, "t2"); });
test("accepted assignment enters recipient recommendation", () => { const task = { ...baseTask, owner_id: "suki", user_id: "suki" }; const assignment = { id: "a", resource_type: "task", resource_id: task.id, assigned_by_id: "suki", assigned_to_id: "derek", status: "accepted", due_date: null, requested_priority: 3, definition_of_done: null, instructions: null, decline_reason: null, proposed_date: null, accepted_at: "", created_at: "" } satisfies Assignment; assert.equal(recommendTodayTasks({ tasks: [task], assignments: [assignment], currentUserId: "derek", settings, capacity: null, today: "2026-07-22" }).primary?.task.id, task.id); });
test("view-only shared task does not count as WIP", () => assert.equal(activeWipCount([{ ...baseTask, owner_id: "suki", user_id: "suki", status: "in_progress" }], [], "derek"), 0));
test("accepted assignment counts as WIP", () => { const assignment = { id: "a", resource_type: "task", resource_id: "t1", assigned_by_id: "suki", assigned_to_id: "derek", status: "accepted", due_date: null, requested_priority: 3, definition_of_done: null, instructions: null, decline_reason: null, proposed_date: null, accepted_at: "", created_at: "" } satisfies Assignment; assert.equal(activeWipCount([{ ...baseTask, owner_id: "suki", user_id: "suki", status: "in_progress" }], [assignment], "derek"), 1); });
test("notification preview never includes task content", () => assert.equal(notificationPreview("health", "diagnosis"), "你今日有一項健康行政事項"));
test("blocked and waiting tasks never become Now", () => {
  const result = recommendTodayTasks({
    tasks: [
      { ...baseTask, id: "blocked", status: "blocked", safety_impact: true },
      { ...baseTask, id: "waiting", status: "waiting", legal_impact: true },
      { ...baseTask, id: "ready", estimated_minutes: 20 }
    ],
    assignments: [],
    currentUserId: "derek",
    settings,
    capacity: { id: "c", user_id: "derek", checkin_date: "2026-07-22", energy_level: "medium", available_minutes: 60, mode: "normal", essential_only: false, notes: null },
    today: "2026-07-22"
  });
  assert.equal(result.now?.task.id, "ready");
  assert.equal(result.excludedBlocked, 2);
});
test("a task awaiting an unfinished prerequisite never becomes Now", () => {
  const result = recommendTodayTasks({
    tasks: [
      { ...baseTask, id: "prerequisite", title: "先完成這一步", estimated_minutes: 10 },
      { ...baseTask, id: "dependent", title: "不能提早開始", safety_impact: true, estimated_minutes: 10 }
    ],
    dependencies: [{ id: "dependency", task_id: "dependent", depends_on_task_id: "prerequisite", created_by_id: "derek", created_at: "2026-07-22T00:00:00Z" }],
    assignments: [],
    currentUserId: "derek",
    settings,
    capacity: { id: "c", user_id: "derek", checkin_date: "2026-07-22", energy_level: "medium", available_minutes: 60, mode: "normal", essential_only: false, notes: null },
    today: "2026-07-22"
  });
  assert.equal(result.now?.task.id, "prerequisite");
  assert.equal(result.dependencyBlocked, 1);
});
test("a completed prerequisite releases the task for normal planning", () => {
  const result = recommendTodayTasks({
    tasks: [
      { ...baseTask, id: "prerequisite", status: "done", title: "已完成", estimated_minutes: 10 },
      { ...baseTask, id: "dependent", title: "可開始", safety_impact: true, estimated_minutes: 10 }
    ],
    dependencies: [{ id: "dependency", task_id: "dependent", depends_on_task_id: "prerequisite", created_by_id: "derek", created_at: "2026-07-22T00:00:00Z" }],
    assignments: [],
    currentUserId: "derek",
    settings,
    capacity: null,
    today: "2026-07-22"
  });
  assert.equal(result.now?.task.id, "dependent");
  assert.equal(result.dependencyBlocked, 0);
});
test("auto plan stays inside capacity and reserves buffer", () => {
  const result = recommendTodayTasks({
    tasks: Array.from({ length: 8 }, (_, index) => ({ ...baseTask, id: `t${index}`, estimated_minutes: 20, due_date: null })),
    assignments: [],
    currentUserId: "derek",
    settings,
    capacity: { id: "c", user_id: "derek", checkin_date: "2026-07-22", energy_level: "medium", available_minutes: 60, mode: "normal", essential_only: false, notes: null },
    today: "2026-07-22"
  });
  assert.ok(result.bufferMinutes >= 10);
  assert.ok(result.estimatedTotalMinutes + result.bufferMinutes <= 60);
  assert.equal(result.hasCapacityOverflow, true);
});
test("minimum day returns one core and no more than two very short extras", () => {
  const result = recommendTodayTasks({
    tasks: [
      { ...baseTask, id: "core", estimated_minutes: 20, energy_level: "low" },
      { ...baseTask, id: "quick1", estimated_minutes: 5, energy_level: "low" },
      { ...baseTask, id: "quick2", estimated_minutes: 5, energy_level: "low" },
      { ...baseTask, id: "large", estimated_minutes: 90, energy_level: "high" }
    ],
    assignments: [],
    currentUserId: "derek",
    settings,
    capacity: { id: "c", user_id: "derek", checkin_date: "2026-07-22", energy_level: "low", available_minutes: 40, mode: "minimum_step", essential_only: true, notes: null },
    minimumDay: true,
    today: "2026-07-22"
  });
  assert.ok(result.now);
  assert.equal(result.later.length, 0);
  assert.ok(result.quickWins.length <= 2);
  assert.ok(result.quickWins.every((item) => item.minutes <= 10));
  assert.ok(result.estimatedTotalMinutes + result.bufferMinutes <= 40);
});
test("easier preference prioritizes a short start", () => {
  const result = recommendTodayTasks({
    tasks: [
      { ...baseTask, id: "large", estimated_minutes: 60 },
      { ...baseTask, id: "small", estimated_minutes: 5 }
    ],
    assignments: [],
    currentUserId: "derek",
    settings,
    capacity: null,
    preference: "easier",
    today: "2026-07-22"
  });
  assert.equal(result.now?.task.id, "small");
});
test("smaller step is suggestion-only and time bounded", () => {
  const suggestion = suggestSmallerStep({ ...baseTask, next_action: "打開報表並核對今個月所有交易" });
  assert.equal(suggestion.minutes, 10);
  assert.match(suggestion.text, /第一個可見動作/);
});
