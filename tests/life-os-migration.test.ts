import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  resolve(here, "../supabase/migrations/20260726120000_life_os_ai_calendar_email.sql"),
  "utf8"
).toLowerCase();
const hardening = readFileSync(
  resolve(here, "../supabase/migrations/20260726121000_life_os_boundary_hardening.sql"),
  "utf8"
).toLowerCase();
const familyVisibilityHotfix = readFileSync(
  resolve(here, "../supabase/migrations/20260726122000_fix_family_visibility_record_shape.sql"),
  "utf8"
).toLowerCase();
const planRoute = readFileSync(resolve(here, "../app/api/ai/plan-day/route.ts"), "utf8");
const taskRoute = readFileSync(resolve(here, "../app/api/ai/analyze-task/route.ts"), "utf8");
const manualChatGPTRoute = readFileSync(
  resolve(here, "../app/api/chatgpt/task-assistant/route.ts"),
  "utf8"
);
const manualChatGPT = readFileSync(resolve(here, "../lib/ai/manual-chatgpt.ts"), "utf8");
const manualChatGPTPanel = readFileSync(
  resolve(here, "../components/TaskAIAnalysisPanel.tsx"),
  "utf8"
);
const cronRoute = readFileSync(resolve(here, "../app/api/cron/due-email/route.ts"), "utf8");
const calendarSync = readFileSync(resolve(here, "../lib/integrations/google-calendar.ts"), "utf8");
const calendarConnectRoute = readFileSync(
  resolve(here, "../app/api/integrations/google-calendar/connect/route.ts"),
  "utf8"
);

test("private, household, and explicit-share reads remain separate in RLS", () => {
  assert.match(migration, /visibility = 'household'/);
  assert.match(migration, /current_user_is_household_member/);
  assert.match(migration, /share_records/);
  assert.match(migration, /task\.owner_id = \(select auth\.uid\(\)\)/);
  assert.match(migration, /'accepted','in_progress','waiting','blocked','completed'/);
  assert.match(migration, /household_owner_required/);
  assert.match(migration, /household_already_full/);
  assert.match(hardening, /item_type = 'inbox'/);
  assert.match(hardening, /new\.visibility := 'private'/);
  assert.match(familyVisibilityHotfix, /to_jsonb\(new\) ->> 'item_type' = 'inbox'/);
  assert.doesNotMatch(familyVisibilityHotfix, /new\.item_type/);
});

test("household collaborators can progress family work without changing private content", () => {
  assert.match(hardening, /allowed_permission := 'update_status'/);
  assert.match(hardening, /old\.area = 'family'/);
  assert.match(hardening, /old\.visibility = 'household'/);
  assert.match(hardening, /'status','progress','blocked_reason'/);
  assert.match(hardening, /raise exception 'task_update_forbidden'/);
});

test("Google tokens remain private and only confirmed schedules can sync", () => {
  assert.match(migration, /private\.google_calendar_tokens/);
  assert.match(migration, /revoke all on private\.google_calendar_tokens from public, anon, authenticated/);
  assert.match(migration, /schedule_status in \('tentative','confirmed','cancelled'\)/);
  assert.match(calendarSync, /item\.schedule_status !== "confirmed"/);
  assert.match(calendarSync, /onConflict: "operating_item_id"/);
  assert.match(hardening, /calendar_event_links_item_unique_idx/);
  assert.match(calendarConnectRoute, /calendar", "not_configured"/);
  assert.match(calendarConnectRoute, /nextresponse\.redirect\(redirect\)/i);
});

test("daily planner is free, ChatGPT imports are bound, and accepted plans stay internal", () => {
  assert.match(planRoute, /calendarSync: false/);
  assert.match(planRoute, /model = "rules-engine"/);
  assert.doesNotMatch(planRoute, /generateText|Output\.object/);
  assert.match(planRoute, /maximumItems/);
  assert.match(planRoute, /accept_today_auto_plan/);
  assert.match(planRoute, /p_idempotency_key: planId/);
  assert.match(migration, /unique \(plan_id, task_id, starts_at\)/);
  assert.match(taskRoute, /只提供建議，不修改資料/);
  assert.match(taskRoute, /model: "rules-engine"/);
  assert.doesNotMatch(taskRoute, /generateText|Output\.object/);
  assert.doesNotMatch(taskRoute, /\.from\("tasks"\)\.update/);
  assert.match(manualChatGPTRoute, /authenticateRequest/);
  assert.match(manualChatGPTRoute, /redactManualTaskForChatGPT/);
  assert.match(manualChatGPT, /redactSensitiveText/);
  assert.match(manualChatGPTRoute, /parseManualChatGPTTaskResponse/);
  assert.match(manualChatGPTRoute, /model: "chatgpt-manual"/);
  assert.doesNotMatch(manualChatGPTRoute, /\.from\("tasks"\)\.update/);
  assert.match(manualChatGPTPanel, /navigator\.clipboard/);
  assert.match(manualChatGPTPanel, /window\.open/);
  assert.match(manualChatGPTPanel, /controlAction\("update_task"/);
});

test("daily email uses an authenticated cron claim and exact three-day horizon", () => {
  assert.match(migration, /claim_due_email_digests/);
  assert.match(migration, /notification_dispatch_authorized/);
  assert.match(migration, /email_digest_days, 3/);
  assert.match(migration, /lower\(users\.email\) = 'derekcy0309@gmail\.com'/);
  assert.match(migration, /lower\(profile\.display_name\) = 'suki'/);
  assert.match(migration, /greatest\(coalesce\(preference\.email_digest_days, 3\), 1\) - 1/);
  assert.match(cronRoute, /isAuthorizedCronRequest/);
  assert.match(cronRoute, /idempotencyKey/);
});
