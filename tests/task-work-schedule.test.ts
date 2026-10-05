import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { recommendTodayTasks } from "../lib/planning.ts";
import { nextAssignmentAlert } from "../lib/assignment-alerts.ts";
import { orderTodayPlan } from "../lib/today-plan-order.ts";
import { taskScheduledForDate, validateTaskWorkSchedule } from "../lib/task-work-schedule.ts";
import type { Task, UserSettings } from "../lib/types.ts";

const task: Task = {
  id: "friday", user_id: "derek", owner_id: "derek", scope: "home", source_type: "deadline",
  title: "星期五完成", owner: null, due_date: "2026-10-09", work_start_date: "2026-10-05",
  work_dates: ["2026-10-08", "2026-10-09"], follow_up_date: null, status: "not_started",
  next_action: "先做第一步", risk: "low", notes: null, completed_at: null,
  deleted_at: null, archived_at: null, created_at: "2026-10-05T00:00:00Z", updated_at: "2026-10-05T00:00:00Z"
};
const settings = { id: "s", user_id: "derek", email: null, daily_reminder_time: "09:00", default_reminder_days: 3, created_at: "", updated_at: "", gentle_mode: false, wip_limit: 3 } satisfies UserSettings;

test("Monday-to-Friday task is automatically suggested only on chosen Thursday and Friday", () => {
  for (const date of ["2026-10-05", "2026-10-06", "2026-10-07"]) {
    assert.equal(taskScheduledForDate(task, date), false);
    assert.equal(recommendTodayTasks({ tasks: [task], assignments: [], currentUserId: "derek", settings, capacity: null, today: date }).now, null);
  }
  for (const date of ["2026-10-08", "2026-10-09"]) {
    assert.equal(taskScheduledForDate(task, date), true);
    assert.equal(recommendTodayTasks({ tasks: [task], assignments: [], currentUserId: "derek", settings, capacity: null, today: date }).now?.task.id, task.id);
  }
});

test("an explicit manual Today choice may override a chosen work day", () => {
  const result = recommendTodayTasks({
    tasks: [task], assignments: [], currentUserId: "derek", settings, capacity: null,
    today: "2026-10-05", planning: [{ user_id: "derek", resource_type: "task", resource_id: task.id,
      personal_priority: 3, planned_date: "2026-10-05", snoozed_until: null, pinned: false,
      hidden_from_today: false, plan_role: "now", plan_source: "manual" }]
  });
  assert.equal(result.now?.task.id, task.id);
});

test("a chosen work day remains visible when ordinary WIP capacity is full", () => {
  const inProgress: Task = { ...task, id: "already-started", work_start_date: null, work_dates: null,
    due_date: null, status: "in_progress" };
  const result = recommendTodayTasks({ tasks: [task, inProgress], assignments: [],
    currentUserId: "derek", settings: { ...settings, wip_limit: 1 }, capacity: null,
    today: "2026-10-08" });
  assert.ok(result.all.some((item) => item.task.id === task.id));
});

test("work schedule rejects missing, duplicate and out-of-range dates", () => {
  assert.equal(validateTaskWorkSchedule({ startDate: null, dueDate: "2026-10-09", workDates: null }).error, null);
  assert.ok(validateTaskWorkSchedule({ startDate: "2026-10-05", dueDate: "2026-10-09", workDates: [] }).error);
  assert.ok(validateTaskWorkSchedule({ startDate: "2026-10-05", dueDate: "2026-10-09", workDates: ["2026-10-10"] }).error);
  assert.ok(validateTaskWorkSchedule({ startDate: "2026-10-05", dueDate: "2026-10-09", workDates: ["2026-10-08", "2026-10-08"] }).error);
  assert.ok(validateTaskWorkSchedule({ startDate: "2026-02-30", dueDate: "2026-10-09", workDates: ["2026-10-08"] }).error);
  assert.deepEqual(validateTaskWorkSchedule({ startDate: "2026-10-05", dueDate: "2026-10-09", workDates: ["2026-10-09", "2026-10-08"] }).workDates, ["2026-10-08", "2026-10-09"]);
});

test("legacy creation without schedule fields stays valid", () => {
  assert.deepEqual(validateTaskWorkSchedule({ startDate: undefined, dueDate: undefined, workDates: undefined }), {
    startDate: null, workDates: null, error: null
  });
  assert.equal(validateTaskWorkSchedule({ startDate: undefined, dueDate: "2026-10-09", workDates: undefined }).error, null);
  assert.ok(validateTaskWorkSchedule({ startDate: undefined, dueDate: "2026-10-09", workDates: ["2026-10-05"] }).error);
});

test("manual Today order takes priority and legacy auto plan keeps role order", () => {
  const base = { plan_role: "later" as const, plan_source: "manual" as const };
  const manual = orderTodayPlan([
    { ...base, resource_id: "second", plan_position: 2 },
    { ...base, resource_id: "first", plan_position: 1 }
  ]);
  assert.deepEqual(manual.map((item) => item.resource_id), ["first", "second"]);
  const automatic = orderTodayPlan([
    { resource_id: "later", plan_role: "later" as const, plan_source: "auto_plan" as const, plan_position: 1 },
    { resource_id: "now", plan_role: "now" as const, plan_source: "auto_plan" as const, plan_position: 2 }
  ]);
  assert.deepEqual(automatic.map((item) => item.resource_id), ["now", "later"]);
});

test("delegator follow-up for scheduled work is limited to the selected due day", () => {
  const record = {
    id: "a", resource_id: task.id, assigned_by_id: "derek", assigned_to_id: "suki",
    status: "accepted", due_date: "2026-10-09", work_dates: task.work_dates,
    accepted_at: "2026-10-05T00:00:00Z", acknowledged_at: null,
    created_at: "2026-10-05T00:00:00Z", updated_at: null, task_active: true
  };
  assert.equal(nextAssignmentAlert([record], "derek", "2026-10-08", new Set(["accepted:a"])), null);
  assert.equal(nextAssignmentAlert([record], "derek", "2026-10-09", new Set(["accepted:a"]))?.kind, "followup");
});

test("migration preserves old tasks, deduplicates chosen-day notifications and restricts reordering", () => {
  const sql = readFileSync("supabase/migrations/20261005120000_task_work_days_manual_order.sql", "utf8").toLowerCase();
  assert.match(sql, /add column if not exists work_start_date date/);
  assert.match(sql, /add column if not exists work_dates date\[\]/);
  assert.match(sql, /task\.work_dates is null/);
  assert.match(sql, /task-work-day:/);
  assert.match(sql, /metadata\.user_id = actor/);
  assert.match(sql, /private\.notification_dispatch_authorized/);
  assert.doesNotMatch(sql, /delete from public\.tasks/);
});
