import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("supabase/migrations/20260728100000_home_reminders_task_notices_user_invites.sql", "utf8").toLowerCase();
const control = readFileSync("app/api/control/route.ts", "utf8").toLowerCase();
const home = readFileSync("app/page.tsx", "utf8").toLowerCase();
const taskForm = readFileSync("components/forms/TaskForm.tsx", "utf8").toLowerCase();
const invite = readFileSync("app/api/admin/invite/route.ts", "utf8").toLowerCase();

test("home supports manual task inclusion without deleting the task", () => {
  assert.match(control, /case "set_today_task"/);
  assert.match(control, /plan_source:\s*included \? "manual"/);
  assert.match(home, /todaytaskmanager/);
});

test("reminders are independent, participant-visible, and use generic notifications", () => {
  assert.match(migration, /create table if not exists public\.reminders/);
  assert.match(migration, /create table if not exists public\.reminder_recipients/);
  assert.match(migration, /current_user_can_read_reminder/);
  assert.match(migration, /when 'reminder' then '你有一項已安排活動'/);
  assert.match(migration, /generic_title,\s*generic_body,\s*target_path[\s\S]*title_text,\s*body_text,\s*path_text/);
});

test("task checkboxes synchronize explicit notice recipients and preserve prior shares", () => {
  assert.match(taskForm, /通知 \{participant\.display_name\}/);
  assert.match(control, /set_task_notice_recipients/);
  assert.match(migration, /owns_share boolean not null default false/);
  assert.match(migration, /notice\.owns_share/);
});

test("Derek calendar and administrator access are explicit", () => {
  assert.match(migration, /personal_calendar_email = 'derekcy0309@gmail\.com'/);
  assert.match(migration, /is_admin = true/);
});

test("portal invitations are admin-only and isolate the server credential", () => {
  assert.match(invite, /profile\.data\?\.is_admin/);
  assert.match(invite, /supabase_service_role_key/i);
  assert.match(invite, /inviteuserbyemail/);
  assert.doesNotMatch(control, /service_role/i);
});
