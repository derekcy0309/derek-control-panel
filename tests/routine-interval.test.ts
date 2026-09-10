import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { addRoutineInterval } from "../lib/routine-interval.ts";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

test("routine date preview supports fixed day, month and year cadences", () => {
  assert.equal(addRoutineInterval("2026-09-10", 10, "day"), "2026-09-20");
  assert.equal(addRoutineInterval("2026-01-31", 1, "month"), "2026-02-28");
  assert.equal(addRoutineInterval("2024-02-29", 1, "year"), "2025-02-28");
  assert.equal(addRoutineInterval("2026-01-01", 0, "day"), null);
});

test("routine form is intentionally simple and does not ask for a repeat count", () => {
  const form = read("components/forms/TaskForm.tsx");
  assert.match(form, /這是一項 Routine 工作/);
  assert.match(form, /recurrence_interval_value/);
  assert.match(form, /<option value="day">日<\/option>/);
  assert.match(form, /<option value="month">月<\/option>/);
  assert.match(form, /<option value="year">年<\/option>/);
  assert.match(form, /無限期/);
  assert.match(form, /指定結束日期/);
  assert.match(form, /不設「重複次數」/);
  assert.match(form, /Routine 工作需要先設定首次到期日/);
});

test("database cadence is anchored to the scheduled date and stops after ends_on", () => {
  const migration = read("supabase/migrations/20260910150051_routine_interval_schedule.sql");
  const rollback = read("supabase/migrations/20260910150051_routine_interval_schedule.rollback.sql");
  assert.match(migration, /add column if not exists interval_value integer/);
  assert.match(migration, /interval_unit in \('day', 'month', 'year'\)/);
  assert.match(migration, /anchor_date := coalesce\(new\.due_date, new\.planned_date, rule\.last_generated_for, current_date\)/);
  assert.doesNotMatch(migration, /anchor_date := greatest/);
  assert.match(migration, /next_occurrence_date > rule\.ends_on/);
  assert.match(migration, /set is_active = false/);
  assert.match(migration, /on conflict \(recurrence_rule_id, source_task_id\) do nothing/);
  assert.match(rollback, /ROUTINE_INTERVAL_ROLLBACK_REQUIRES_EXPLICIT_DATA_HANDLING/i);
});

test("API validates interval values, end dates and the initial due date", () => {
  const api = read("app/api/control/route.ts");
  assert.match(api, /"daily", "weekly", "monthly", "custom", "interval"/);
  assert.match(api, /integerValue\(body\.intervalValue, 1, 3650\)/);
  assert.match(api, /\["day", "month", "year"\]/);
  assert.match(api, /Routine 結束日期不可早過首次到期日/);
  assert.match(api, /Routine 工作需要先設定首次到期日/);
});
