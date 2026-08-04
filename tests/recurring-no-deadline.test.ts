import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

test("recurring task form offers an explicit no-deadline mode and keeps a schedule prompt", () => {
  const form = read("components/forms/TaskForm.tsx");
  assert.match(form, /recurrence_deadline_mode: "scheduled" \| "none"/);
  assert.match(form, /沒有期限，只按週期提示/);
  assert.match(form, /保留今次工作直至你按「今次已完成」/);
  assert.match(form, /deadlineMode: form\.recurrence_deadline_mode/);
  assert.match(form, /due_date: mode === "none" \? ""/);
});

test("owners can change an existing recurring rule without changing authorization", () => {
  const api = read("app/api/control/route.ts");
  const card = read("components/items/TaskCard.tsx");
  const migration = read("supabase/migrations/20260804130000_recurring_no_deadline_reminders.sql");
  assert.match(api, /set_task_recurrence_deadline_mode/);
  assert.match(api, /client\.rpc\("set_task_recurrence_deadline_mode"/);
  assert.match(migration, /security invoker/);
  assert.match(migration, /existing_rule\.owner_id <> actor/);
  assert.match(migration, /order by task\.id[\s\S]*?for update/);
  assert.match(migration, /set planned_date = coalesce\(task\.due_date, task\.planned_date\),[\s\S]*?due_date = null/);
  assert.match(migration, /revoke all on function public\.set_task_recurrence_deadline_mode/);
  assert.match(migration, /grant execute on function public\.set_task_recurrence_deadline_mode\(uuid, text\)[\s\S]*?to authenticated/);
  assert.match(card, /沒有期限，只提示/);
  assert.match(card, /每次有到期日/);
});

test("migration keeps one successor, removes fake deadlines and schedules one private reminder per occurrence", () => {
  const migration = read("supabase/migrations/20260804130000_recurring_no_deadline_reminders.sql");
  const rollback = read("supabase/migrations/20260804130000_recurring_no_deadline_reminders.rollback.sql");
  assert.match(migration, /add column if not exists deadline_mode text not null default 'scheduled'/);
  assert.match(migration, /deadline_mode in \('scheduled', 'none'\)/);
  assert.match(migration, /new\.status <> 'done' or old\.status = 'done'/);
  assert.match(migration, /case when rule\.deadline_mode = 'scheduled' then next_occurrence_date else null end/);
  assert.match(migration, /case when rule\.deadline_mode = 'none' then next_occurrence_date else null end/);
  assert.match(migration, /'recurrence:' \|\| rule\.id::text \|\| ':' \|\| next_occurrence_date::text/);
  assert.match(migration, /on conflict \(user_id, dedupe_key\) do nothing/);
  assert.match(migration, /private\.notification_after_quiet_hours/);
  assert.match(migration, /'\/tasks\/' \|\| p_resource_id::text/);
  assert.doesNotMatch(migration, /drop table public\.(tasks|task_recurrence_rules|notification_deliveries)/);
  assert.match(rollback, /set due_date = coalesce\(task\.due_date, task\.planned_date, rule\.last_generated_for\)/);
  assert.match(rollback, /set kind = 'task_notice'/);
  assert.match(rollback, /drop column if exists deadline_mode/);
});

test("recurrence reminder remains opt-in, quiet-hours aware and lock-screen private", () => {
  const settings = read("components/NotificationSettings.tsx");
  const api = read("app/api/control/route.ts");
  const migration = read("supabase/migrations/20260804130000_recurring_no_deadline_reminders.sql");
  assert.match(settings, /定期工作每輪提示/);
  assert.match(settings, /recurrenceEnabled: preferences\.recurrence_enabled/);
  assert.match(api, /recurrence_enabled: source\.recurrenceEnabled === undefined \? true/);
  assert.match(migration, /preference\.browser_enabled and case/);
  assert.match(migration, /when p_kind = 'recurrence_reminder' then preference\.recurrence_enabled/);
  assert.match(migration, /一項沒有期限的定期工作已到今次提示時段/);
  assert.doesNotMatch(migration, /rule\.template ->> 'title'.*generic_body/);
});

test("a due recurrence prompt stays in Today without becoming a deadline overdue", () => {
  const planning = read("lib/planning.ts");
  const dashboard = read("lib/dashboard.ts");
  const overdueBlock = dashboard.slice(dashboard.indexOf("export function getOverdueTasks"), dashboard.indexOf("export function getTodayFollowUps"));
  assert.match(planning, /task\.recurrence_rule_id && task\.planned_date && task\.planned_date <= today/);
  assert.match(planning, /定期工作已到提示時段/);
  assert.match(dashboard, /const recurrencePrompt = task\.recurrence_rule_id \? task\.planned_date : null/);
  assert.doesNotMatch(overdueBlock, /planned_date/);
});
