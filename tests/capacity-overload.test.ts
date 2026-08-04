import test from "node:test";
import assert from "node:assert/strict";
import { assessCapacityOverload } from "../lib/capacity-overload.ts";
import type { CapacityCheckin, Task, UserSettings } from "../lib/types.ts";

const today = "2026-07-25";
const settings = { id: "settings", user_id: "derek", email: null, daily_reminder_time: "09:00", default_reminder_days: 3, created_at: "", updated_at: "", wip_limit: 2 } satisfies UserSettings;
const capacity: CapacityCheckin = { id: "capacity", user_id: "derek", checkin_date: today, energy_level: "low", available_minutes: 60, mode: "gentle", essential_only: false, notes: null };
const baseTask: Task = { id: "task", user_id: "derek", owner_id: "derek", scope: "company", source_type: "deadline", title: "普通行政", owner: null, due_date: today, follow_up_date: null, status: "not_started", next_action: "打開文件", risk: "low", notes: null, completed_at: null, deleted_at: null, archived_at: null, created_at: "2026-07-01T00:00:00Z", updated_at: "2026-07-20T00:00:00Z", area: "work", estimated_minutes: 40 };

test("low energy and upcoming family commitments reserve buffer and expose overload without mutating tasks", () => {
  const result = assessCapacityOverload({
    tasks: [{ ...baseTask, id: "admin", due_date: "2026-08-15", estimated_minutes: 50 }, { ...baseTask, id: "another", due_date: "2026-08-15", estimated_minutes: 30, planned_date: today }],
    assignments: [], planning: [], currentUserId: "derek", settings, capacity,
    commitments: [{ id: "school", item_type: "school", area: "family", due_date: "2026-07-26", status: "active" }],
    weeklyAvailableMinutes: 120, today
  });
  assert.equal(result.today.level, "over_capacity");
  assert.ok(result.today.bufferMinutes >= 25);
  assert.ok(result.commitmentCount === 1);
  assert.equal(result.deferCandidates[0]?.id, "admin");
  assert.ok(result.reasons.some((reason) => reason.includes("不把可用時間填滿")));
});

test("safety, legal, child, revenue and critical work are never suggested for deferral or handoff", () => {
  const result = assessCapacityOverload({
    tasks: [
      { ...baseTask, id: "safe", safety_impact: true, estimated_minutes: 90 },
      { ...baseTask, id: "legal", legal_impact: true, estimated_minutes: 80 },
      { ...baseTask, id: "child", child_impact: true, estimated_minutes: 70 },
      { ...baseTask, id: "revenue", revenue_impact: 1000, estimated_minutes: 60 },
      { ...baseTask, id: "critical", critical_path: true, estimated_minutes: 50 },
      { ...baseTask, id: "normal", due_date: "2026-08-15", estimated_minutes: 40 }
    ],
    assignments: [], currentUserId: "derek", settings, capacity, today
  });
  assert.deepEqual(result.deferCandidates.map((task) => task.id), ["normal"]);
  assert.deepEqual(result.handoffCandidates.map((task) => task.id), ["normal"]);
});

test("unknown capacity stays neutral and blocked or waiting work does not count as workload", () => {
  const result = assessCapacityOverload({
    tasks: [{ ...baseTask, status: "blocked", estimated_minutes: 900 }, { ...baseTask, id: "waiting", status: "waiting", estimated_minutes: 900 }],
    assignments: [], currentUserId: "derek", settings, capacity: null, today
  });
  assert.equal(result.today.level, "unknown");
  assert.equal(result.today.committedMinutes, 0);
  assert.equal(result.needsAttention, false);
});

test("WIP at the personal limit creates a gentle signal without changing any task status", () => {
  const result = assessCapacityOverload({
    tasks: [{ ...baseTask, id: "started-1", status: "in_progress" }, { ...baseTask, id: "started-2", status: "in_progress" }],
    assignments: [], currentUserId: "derek", settings, capacity: null, today
  });
  assert.equal(result.wip.reached, true);
  assert.equal(result.needsAttention, true);
  assert.ok(result.reasons.some((reason) => reason.includes("進行中工作")));
});

test("a due recurring prompt remains in today's capacity until this occurrence is completed", () => {
  const result = assessCapacityOverload({
    tasks: [{ ...baseTask, due_date: null, recurrence_rule_id: "rule", planned_date: "2026-07-23", estimated_minutes: 20 }],
    assignments: [], currentUserId: "derek", settings, capacity, today
  });
  assert.equal(result.today.committedMinutes, 20);
});
