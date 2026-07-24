import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(resolve(here, "../supabase/migrations/202607220001_control_panel_operating_system.sql"), "utf8").toLowerCase();
const rollback = readFileSync(resolve(here, "../supabase/migrations/202607220001_control_panel_operating_system.rollback.sql"), "utf8").toLowerCase();
const handoffMigration = readFileSync(resolve(here, "../supabase/migrations/20260724040911_continuous_task_handoffs.sql"), "utf8").toLowerCase();
const handoffRollback = readFileSync(resolve(here, "../supabase/migrations/20260724040911_continuous_task_handoffs.rollback.sql"), "utf8").toLowerCase();
const connectionMigration = readFileSync(resolve(here, "../supabase/migrations/20260724042142_trusted_handoff_connections.sql"), "utf8").toLowerCase();
const reclaimMigration = readFileSync(resolve(here, "../supabase/migrations/20260724050000_reclaim_task_handoff.sql"), "utf8").toLowerCase();
const reclaimRollback = readFileSync(resolve(here, "../supabase/migrations/20260724050000_reclaim_task_handoff.rollback.sql"), "utf8").toLowerCase();
const checkpointMigration = readFileSync(resolve(here, "../supabase/migrations/20260724120731_restart_checkpoints.sql"), "utf8").toLowerCase();
const checkpointRollback = readFileSync(resolve(here, "../supabase/migrations/20260724120731_restart_checkpoints.rollback.sql"), "utf8").toLowerCase();
const checkpointResourceMigration = readFileSync(resolve(here, "../supabase/migrations/20260724121803_checkpoint_resource_privacy.sql"), "utf8").toLowerCase();
const checkpointResourceRollback = readFileSync(resolve(here, "../supabase/migrations/20260724121803_checkpoint_resource_privacy.rollback.sql"), "utf8").toLowerCase();
const inboxMigration = readFileSync(resolve(here, "../supabase/migrations/20260724150744_inbox_processing_mode.sql"), "utf8").toLowerCase();
const inboxRollback = readFileSync(resolve(here, "../supabase/migrations/20260724150744_inbox_processing_mode.rollback.sql"), "utf8").toLowerCase();
const todayPlanMigration = readFileSync(resolve(here, "../supabase/migrations/20260724154148_today_auto_plan_mvd.sql"), "utf8").toLowerCase();
const todayPlanRollback = readFileSync(resolve(here, "../supabase/migrations/20260724154148_today_auto_plan_mvd.rollback.sql"), "utf8").toLowerCase();
const notificationMigration = readFileSync(resolve(here, "../supabase/migrations/20260724162344_notification_system.sql"), "utf8").toLowerCase();
const notificationRollback = readFileSync(resolve(here, "../supabase/migrations/20260724162344_notification_system.rollback.sql"), "utf8").toLowerCase();
const notificationClaimFixMigration = readFileSync(resolve(here, "../supabase/migrations/20260724181119_fix_notification_claim_conflict.sql"), "utf8").toLowerCase();
const notificationClaimFixRollback = readFileSync(resolve(here, "../supabase/migrations/20260724181119_fix_notification_claim_conflict.rollback.sql"), "utf8").toLowerCase();
const weeklyReviewMigration = readFileSync(resolve(here, "../supabase/migrations/20260724182259_weekly_review.sql"), "utf8").toLowerCase();
const weeklyReviewRollback = readFileSync(resolve(here, "../supabase/migrations/20260724182259_weekly_review.rollback.sql"), "utf8").toLowerCase();
const dependencyMigration = readFileSync(resolve(here, "../supabase/migrations/20260724172250_task_dependencies_milestones.sql"), "utf8").toLowerCase();
const dependencyRollback = readFileSync(resolve(here, "../supabase/migrations/20260724172250_task_dependencies_milestones.rollback.sql"), "utf8").toLowerCase();
const recurrenceMigration = readFileSync(resolve(here, "../supabase/migrations/20260724173935_recurring_task_routines.sql"), "utf8").toLowerCase();
const recurrenceRollback = readFileSync(resolve(here, "../supabase/migrations/20260724173935_recurring_task_routines.rollback.sql"), "utf8").toLowerCase();
const recurrenceIndexesMigration = readFileSync(resolve(here, "../supabase/migrations/20260724175911_recurrence_foreign_key_indexes.sql"), "utf8").toLowerCase();
const recurrenceIndexesRollback = readFileSync(resolve(here, "../supabase/migrations/20260724175911_recurrence_foreign_key_indexes.rollback.sql"), "utf8").toLowerCase();
const bodyDoubleMigration = readFileSync(resolve(here, "../supabase/migrations/20260725190000_body_double_mode.sql"), "utf8").toLowerCase();
const bodyDoubleRollback = readFileSync(resolve(here, "../supabase/migrations/20260725190000_body_double_mode.rollback.sql"), "utf8").toLowerCase();
const bodyDoubleEligibilityMigration = readFileSync(resolve(here, "../supabase/migrations/20260725190100_body_double_checkpoint_eligibility.sql"), "utf8").toLowerCase();
const bodyDoubleEligibilityRollback = readFileSync(resolve(here, "../supabase/migrations/20260725190100_body_double_checkpoint_eligibility.rollback.sql"), "utf8").toLowerCase();
const controlRoute = readFileSync(resolve(here, "../app/api/control/route.ts"), "utf8").toLowerCase();
const notificationRoute = readFileSync(resolve(here, "../app/api/cron/notifications/route.ts"), "utf8").toLowerCase();
const notificationSettings = readFileSync(resolve(here, "../components/NotificationSettings.tsx"), "utf8").toLowerCase();
const serviceWorker = readFileSync(resolve(here, "../public/sw.js"), "utf8").toLowerCase();
const todayPage = readFileSync(resolve(here, "../app/page.tsx"), "utf8").toLowerCase();
const taskForm = readFileSync(resolve(here, "../components/forms/TaskForm.tsx"), "utf8").toLowerCase();
const handoffControls = readFileSync(resolve(here, "../components/items/TaskHandoffControls.tsx"), "utf8").toLowerCase();
const inboxProcessingMode = readFileSync(resolve(here, "../components/inbox/InboxProcessingMode.tsx"), "utf8").toLowerCase();
const bodyDoublePage = readFileSync(resolve(here, "../app/body-double/page.tsx"), "utf8").toLowerCase();

const protectedTables = [
  "user_profiles",
  "share_records",
  "assignments",
  "joint_memberships",
  "user_planning_metadata",
  "share_audit_logs",
  "activity_logs",
  "operating_items",
  "daily_capacity_checkins"
];

test("upgrade is additive for the legacy core tables", () => {
  for (const table of ["tasks", "transactions", "meetings", "balances", "user_settings"]) {
    assert.doesNotMatch(migration, new RegExp(`drop\\s+table(?:\\s+if\\s+exists)?\\s+public\\.${table}\\b`));
  }
});

test("every new account-data table enables row level security", () => {
  for (const table of protectedTables) {
    assert.match(migration, new RegExp(`alter\\s+table\\s+public\\.${table}\\s+enable\\s+row\\s+level\\s+security`));
  }
});

test("private-by-default task policy is installed", () => {
  assert.match(migration, /create\s+policy\s+tasks_select_authorized/);
  assert.match(migration, /owner_id\s*=\s*\(select\s+auth\.uid\(\)\)/);
  assert.match(migration, /share_records/);
});

test("field-level update guards exist for shared resources", () => {
  assert.match(migration, /enforce_task_update_permission/);
  assert.match(migration, /enforce_operating_item_update_permission/);
  assert.match(migration, /before\s+update\s+on\s+public\.tasks/);
  assert.match(migration, /before\s+update\s+on\s+public\.operating_items/);
});

test("sharing resolves only an explicitly supplied email", () => {
  assert.match(migration, /resolve_share_target\(target_email\s+text\)/);
  assert.match(migration, /lower\(u\.email\)\s*=\s*lower\(btrim\(target_email\)\)/);
});

test("migration provides an explicit rollback path", () => {
  for (const table of protectedTables) assert.match(rollback, new RegExp(`drop\\s+table\\s+if\\s+exists\\s+public\\.${table}`));
  assert.match(rollback, /intentionally\s+keeps\s+task\s+columns\s+and\s+user_settings\s+columns/);
});

test("continuous handoffs separate a completed step from a closed case", () => {
  assert.match(handoffMigration, /'waiting','blocked','completed',\s*'returned','closed','cancelled'/);
  assert.match(handoffMigration, /p_resolution\s+not\s+in\s+\('continue','return','close'\)/);
  assert.match(handoffMigration, /status\s*=\s*'returned'/);
  assert.match(handoffMigration, /status\s*=\s*'done'/);
});

test("handoff notes are append-only, attributed and protected by RLS", () => {
  assert.match(handoffMigration, /create\s+table\s+if\s+not\s+exists\s+public\.task_handoff_notes/);
  assert.match(handoffMigration, /author_id\s+uuid\s+not\s+null\s+references\s+auth\.users/);
  assert.match(handoffMigration, /created_at\s+timestamptz\s+not\s+null\s+default\s+now\(\)/);
  assert.match(handoffMigration, /alter\s+table\s+public\.task_handoff_notes\s+enable\s+row\s+level\s+security/);
  assert.match(handoffMigration, /grant\s+select,\s*insert\s+on\s+public\.task_handoff_notes\s+to\s+authenticated/);
  assert.doesNotMatch(handoffMigration, /grant\s+[^;]*(?:update|delete)[^;]*task_handoff_notes/);
});

test("handoff mutations are transactional database functions using invoker rights", () => {
  for (const functionName of ["start_task_handoff", "record_task_handoff_progress", "resolve_task_handoff_step"]) {
    assert.match(handoffMigration, new RegExp(`function\\s+public\\.${functionName}`));
  }
  assert.match(handoffMigration, /security\s+invoker/);
  assert.doesNotMatch(handoffMigration, /function\s+public\.(?:start|record|resolve)_task_handoff[\s\S]*?security\s+definer/);
});

test("continuous handoff migration has a non-destructive rollback", () => {
  assert.match(handoffRollback, /drop\s+table\s+if\s+exists\s+public\.task_handoff_notes/);
  assert.match(handoffRollback, /intentionally\s+preserves\s+all\s+task/);
  assert.doesNotMatch(handoffRollback, /drop\s+table\s+(?:if\s+exists\s+)?public\.(?:tasks|assignments)/);
});

test("handoff picker exposes only explicit trusted connections", () => {
  assert.match(connectionMigration, /create\s+table\s+if\s+not\s+exists\s+public\.user_handoff_connections/);
  assert.match(connectionMigration, /alter\s+table\s+public\.user_handoff_connections\s+enable\s+row\s+level\s+security/);
  assert.match(connectionMigration, /c\.user_id\s*=\s*\(select\s+auth\.uid\(\)\)\s+and\s+c\.participant_user_id\s*=\s*p\.user_id/);
  assert.match(connectionMigration, /where\s+lower\(email\)\s+in/);
  assert.doesNotMatch(connectionMigration, /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/);
});

test("new tasks can start a trusted handoff from every task form", () => {
  assert.match(taskForm, /建立後由誰跟進/);
  assert.match(taskForm, /handoff_to_user_id/);
  assert.match(taskForm, /handoff_note/);
  assert.match(controlRoute, /body\.handoffToUserId/i);
  assert.match(controlRoute, /start_task_handoff/);
  assert.match(controlRoute, /建立後直接交俾對方跟進/);
});

test("the current recipient can visibly return a task to the previous handler", () => {
  assert.match(handoffControls, /交回.*跟進/);
  assert.match(handoffControls, /setresolvemode\("return"\)/);
  assert.match(controlRoute, /resolution === "return"/);
});

test("both participants can visibly choose the current task handler", () => {
  assert.match(taskForm, /由我跟進/);
  assert.match(taskForm, /由.*display_name.*跟進/);
  assert.match(handoffControls, /目前負責人/);
  assert.match(handoffControls, /由我跟進/);
  assert.match(handoffControls, /handoff_reclaim/);
});

test("sender reclaim is transactional, attributed and protected by invoker rights", () => {
  assert.match(reclaimMigration, /function\s+public\.reclaim_task_handoff/);
  assert.match(reclaimMigration, /security\s+invoker/);
  assert.match(reclaimMigration, /a\.assigned_by_id\s*=\s*actor/);
  assert.match(reclaimMigration, /insert\s+into\s+public\.task_handoff_notes/);
  assert.match(reclaimMigration, /author_id/);
  assert.doesNotMatch(reclaimMigration, /security\s+definer/);
  assert.match(reclaimRollback, /drop\s+function\s+if\s+exists\s+public\.reclaim_task_handoff/);
  assert.match(reclaimRollback, /intentionally\s+preserved/);
});

test("restart checkpoints are additive, persistent and indexed for latest-first reads", () => {
  assert.match(checkpointMigration, /create\s+table\s+if\s+not\s+exists\s+public\.task_checkpoints/);
  assert.match(checkpointMigration, /task_id\s+uuid\s+not\s+null\s+references\s+public\.tasks/);
  assert.match(checkpointMigration, /last_worked_at\s+timestamptz\s+not\s+null\s+default\s+now\(\)/);
  assert.match(checkpointMigration, /task_checkpoints_task_history_idx/);
  assert.match(checkpointMigration, /where\s+state\s*=\s*'draft'/);
  assert.doesNotMatch(checkpointMigration, /drop\s+table\s+(?:if\s+exists\s+)?public\.tasks/);
});

test("checkpoint drafts and saved history have separate RLS visibility", () => {
  assert.match(checkpointMigration, /alter\s+table\s+public\.task_checkpoints\s+enable\s+row\s+level\s+security/);
  assert.match(checkpointMigration, /state\s*=\s*'saved'[\s\S]*current_user_can_read\('task',\s*task_id\)/);
  assert.match(checkpointMigration, /state\s*=\s*'draft'[\s\S]*author_id\s*=\s*\(select\s+auth\.uid\(\)\)/);
  assert.match(checkpointMigration, /permission\s+in\s+\('update_status',\s*'edit',\s*'co_owner'\)/);
  assert.match(checkpointMigration, /a\.status\s+in\s+\('accepted',\s*'in_progress',\s*'waiting',\s*'blocked'\)/);
});

test("checkpoint writes are idempotent, validated and use invoker rights", () => {
  assert.match(checkpointMigration, /function\s+public\.save_task_checkpoint/);
  assert.match(checkpointMigration, /security\s+invoker/);
  assert.match(checkpointMigration, /pg_advisory_xact_lock/);
  assert.match(checkpointMigration, /checkpoint_content_required/);
  assert.match(checkpointMigration, /checkpoint_immutable/);
  assert.match(checkpointMigration, /resource_url\s*!~\s*'\^https:/);
  assert.doesNotMatch(checkpointMigration, /function\s+public\.save_task_checkpoint[\s\S]*?security\s+definer/);
});

test("latest checkpoint view honours underlying RLS and rollback preserves task data", () => {
  assert.match(checkpointMigration, /view\s+public\.latest_task_checkpoints[\s\S]*security_invoker\s*=\s*true/);
  assert.match(checkpointRollback, /drop\s+table\s+if\s+exists\s+public\.task_checkpoints/);
  assert.doesNotMatch(checkpointRollback, /drop\s+table\s+(?:if\s+exists\s+)?public\.(?:tasks|assignments|share_records)/);
});

test("checkpoint API exposes explicit read, draft and final-save operations", () => {
  assert.match(controlRoute, /view\s*===\s*"task_checkpoints"/);
  assert.match(controlRoute, /case\s+"save_checkpoint_draft"/);
  assert.match(controlRoute, /case\s+"save_checkpoint"/);
  assert.match(controlRoute, /client\.rpc\("save_task_checkpoint"/);
  assert.match(controlRoute, /checkpointtext\(body\.nextminimumstep,\s*2000/);
  assert.match(controlRoute, /related resources|相關資源/);
});

test("checkpoint resource URLs remain author-private when a task is shared", () => {
  assert.match(checkpointResourceMigration, /create\s+table\s+if\s+not\s+exists\s+public\.task_checkpoint_resources/);
  assert.match(checkpointResourceMigration, /alter\s+table\s+public\.task_checkpoint_resources\s+enable\s+row\s+level\s+security/);
  assert.match(checkpointResourceMigration, /task_checkpoint_resources_select_author/);
  assert.match(checkpointResourceMigration, /author_id\s*=\s*\(select\s+auth\.uid\(\)\)/);
  assert.match(checkpointResourceMigration, /new\.resource_links\s*:=\s*'\[\]'/);
  assert.match(checkpointResourceMigration, /insert\s+into\s+public\.task_checkpoint_resources/);
  assert.match(controlRoute, /from\("task_checkpoint_resources"\)/);
});

test("saved checkpoint resources are immutable and privacy rollback preserves core data", () => {
  assert.match(checkpointResourceMigration, /checkpoint_state\s*<>\s*'draft'/);
  assert.match(checkpointResourceMigration, /raise\s+exception\s+'checkpoint_immutable'/);
  assert.match(checkpointResourceRollback, /drop\s+table\s+if\s+exists\s+public\.task_checkpoint_resources/);
  assert.doesNotMatch(checkpointResourceRollback, /drop\s+table\s+(?:if\s+exists\s+)?public\.(?:tasks|task_checkpoints|assignments|share_records)/);
});

test("Inbox processing is additive, private and explicitly exposed only to authenticated users", () => {
  assert.match(inboxMigration, /create\s+table\s+if\s+not\s+exists\s+public\.inbox_processing_events/);
  assert.match(inboxMigration, /alter\s+table\s+public\.inbox_processing_events\s+enable\s+row\s+level\s+security/);
  assert.match(inboxMigration, /using\s*\(\(select\s+auth\.uid\(\)\)\s*=\s*user_id\)/);
  assert.match(inboxMigration, /revoke\s+all\s+on\s+public\.inbox_processing_events\s+from\s+anon,\s*authenticated/);
  assert.match(inboxMigration, /grant\s+select,\s*insert,\s*update\s+on\s+public\.inbox_processing_events\s+to\s+authenticated/);
  assert.doesNotMatch(inboxMigration, /grant\s+[^;]*delete[^;]*inbox_processing_events/);
  assert.doesNotMatch(inboxMigration, /drop\s+table\s+(?:if\s+exists\s+)?public\.(?:tasks|operating_items)/);
});

test("Inbox conversion is transactional and protected against duplicate submission", () => {
  assert.match(inboxMigration, /function\s+public\.process_inbox_item/);
  assert.match(inboxMigration, /unique\s*\(user_id,\s*idempotency_key\)/);
  assert.match(inboxMigration, /e\.idempotency_key\s*=\s*p_idempotency_key/);
  assert.match(inboxMigration, /for\s+update/);
  assert.match(inboxMigration, /original_item\s+jsonb\s+not\s+null/);
  assert.match(inboxMigration, /to_jsonb\(inbox_item\)/);
  assert.match(inboxMigration, /perform\s+public\.start_task_handoff/);
});

test("Inbox RPCs use invoker rights, authenticate, authorize exact ownership and are not public", () => {
  assert.match(inboxMigration, /security\s+invoker/);
  assert.doesNotMatch(inboxMigration, /function\s+public\.(?:process_inbox_item|undo_last_inbox_processing)[\s\S]*?security\s+definer/);
  assert.match(inboxMigration, /actor\s+uuid\s*:=\s*\(select\s+auth\.uid\(\)\)/);
  assert.match(inboxMigration, /i\.owner_id\s*=\s*actor/);
  assert.match(inboxMigration, /revoke\s+all\s+on\s+function\s+public\.process_inbox_item[\s\S]*?from\s+public,\s*anon/);
  assert.match(inboxMigration, /grant\s+execute\s+on\s+function\s+public\.process_inbox_item[\s\S]*?to\s+authenticated/);
  assert.match(inboxMigration, /set\s+search_path\s*=\s*public,\s*pg_temp/);
});

test("Inbox Undo is latest-only, time-limited and refuses to erase later progress", () => {
  assert.match(inboxMigration, /function\s+public\.undo_last_inbox_processing/);
  assert.match(inboxMigration, /order\s+by\s+e\.processed_at\s+desc/);
  assert.match(inboxMigration, /interval\s+'15\s+minutes'/);
  assert.match(inboxMigration, /inbox_undo_not_latest/);
  assert.match(inboxMigration, /inbox_undo_target_changed/);
  assert.match(inboxMigration, /public\.task_checkpoints/);
  assert.match(inboxMigration, /undo_last_inbox_processing[\s\S]*?original_item->'metadata'/);
});

test("Inbox API and UI process one item with all required choices and pagination", () => {
  assert.match(controlRoute, /view\s*===\s*"inbox_processing"/);
  assert.match(controlRoute, /case\s+"process_inbox_item"/);
  assert.match(controlRoute, /case\s+"undo_inbox_processing"/);
  assert.match(controlRoute, /\.range\(offset,\s*offset\s*\+\s*pagesize\s*-\s*1\)/);
  for (const action of ["do_now", "create_task", "add_project", "add_waiting", "assign", "schedule", "keep_note", "skip"]) {
    assert.match(inboxProcessingMode, new RegExp(`action:\\s*"${action}"`));
  }
  assert.match(inboxProcessingMode, /bundle\.position/);
  assert.match(inboxProcessingMode, /idempotencykey/);
  assert.match(inboxProcessingMode, /undo\s+最近一次處理/);
});

test("Inbox rollback removes only Inbox additions", () => {
  assert.match(inboxRollback, /drop\s+table\s+if\s+exists\s+public\.inbox_processing_events/);
  assert.match(inboxRollback, /drop\s+column\s+if\s+exists\s+inbox_processing_event_id/);
  assert.doesNotMatch(inboxRollback, /drop\s+table\s+(?:if\s+exists\s+)?public\.(?:tasks|operating_items|assignments|share_records)/);
});

test("Today Auto-Plan acceptance is private, auditable and idempotent", () => {
  assert.match(todayPlanMigration, /create\s+table\s+if\s+not\s+exists\s+public\.today_plan_acceptances/);
  assert.match(todayPlanMigration, /alter\s+table\s+public\.today_plan_acceptances\s+enable\s+row\s+level\s+security/);
  assert.match(todayPlanMigration, /user_id\s*=\s*\(select\s+auth\.uid\(\)\)/);
  assert.match(todayPlanMigration, /unique\s*\(user_id,\s*idempotency_key\)/);
  assert.match(todayPlanMigration, /on\s+conflict\s+\(user_id,\s*idempotency_key\)\s+do\s+nothing/);
  assert.match(todayPlanMigration, /grant\s+select,\s*insert\s+on\s+public\.today_plan_acceptances\s+to\s+authenticated/);
  assert.doesNotMatch(todayPlanMigration, /grant\s+[^;]*(?:update|delete)[^;]*today_plan_acceptances/);
});

test("Today Auto-Plan changes only personal planning metadata after confirmation", () => {
  assert.match(todayPlanMigration, /function\s+public\.accept_today_auto_plan/);
  assert.match(todayPlanMigration, /security\s+invoker/);
  assert.match(todayPlanMigration, /task\.status\s+not\s+in\s+\('done',\s*'cancelled',\s*'blocked',\s*'waiting'\)/);
  assert.match(todayPlanMigration, /insert\s+into\s+public\.user_planning_metadata/);
  assert.doesNotMatch(todayPlanMigration, /update\s+public\.tasks/);
  assert.doesNotMatch(todayPlanMigration, /security\s+definer/);
  assert.match(todayPlanMigration, /revoke\s+all\s+on\s+function\s+public\.accept_today_auto_plan[\s\S]*from\s+public,\s*anon/);
});

test("Minimum Viable Day persists rest without moving or completing tasks", () => {
  assert.match(todayPlanMigration, /add\s+column\s+if\s+not\s+exists\s+rest_day\s+boolean/);
  assert.match(controlRoute, /rest_day:\s*boolean\(body\.restday\)/);
  assert.match(todayPage, /今日休息/);
  assert.match(todayPage, /今日核心責任已完成/);
  assert.match(todayPage, /只完成第一步/);
  assert.match(todayPage, /請.*接手/);
  assert.match(todayPage, /延至指定日/);
  assert.match(todayPage, /沒有自動移動任何任務/);
});

test("Today UI requires confirmation and exposes transparent replanning controls", () => {
  assert.match(controlRoute, /view\s*===\s*"today"/);
  assert.match(controlRoute, /function\s+todaydashboard/);
  assert.match(controlRoute, /\.not\("status",\s*"in",\s*"\(done,cancelled,blocked,waiting\)"\)/);
  assert.match(controlRoute, /\.limit\(200\)/);
  assert.match(controlRoute, /case\s+"accept_today_plan"/);
  assert.match(controlRoute, /client\.rpc\("accept_today_auto_plan"/);
  assert.match(todayPage, /確認加入 today/);
  assert.match(todayPage, /重新安排/);
  assert.match(todayPage, /太難/);
  assert.match(todayPage, /換一件/);
  assert.match(todayPage, /拆細一點/);
  assert.match(todayPage, /預留 buffer/);
  assert.match(todayPage, /被阻塞任務已排除/);
});

test("Today Auto-Plan rollback preserves all core work data", () => {
  assert.match(todayPlanRollback, /drop\s+table\s+if\s+exists\s+public\.today_plan_acceptances/);
  assert.match(todayPlanRollback, /drop\s+column\s+if\s+exists\s+rest_day/);
  assert.doesNotMatch(todayPlanRollback, /drop\s+table\s+(?:if\s+exists\s+)?public\.(?:tasks|assignments|user_planning_metadata|daily_capacity_checkins)/);
});

test("notification account data is RLS protected and delivery history is frontend immutable", () => {
  for (const table of ["notification_preferences", "push_subscriptions", "notification_deliveries", "notification_attempts"]) {
    assert.match(notificationMigration, new RegExp(`alter\\s+table\\s+public\\.${table}\\s+enable\\s+row\\s+level\\s+security`));
  }
  assert.match(notificationMigration, /notification_deliveries_select_own/);
  assert.match(notificationMigration, /grant\s+select\s+on\s+public\.notification_deliveries\s+to\s+authenticated/);
  assert.doesNotMatch(notificationMigration, /grant\s+(?:insert|update|delete)[^;]*notification_deliveries/);
  assert.match(notificationMigration, /revoke\s+insert,\s*update,\s*delete\s+on\s+public\.push_subscriptions\s+from\s+authenticated/);
});

test("notification payloads are generic, quiet-hour aware and idempotent", () => {
  assert.match(notificationMigration, /unique\s*\(user_id,\s*dedupe_key\)/);
  assert.match(notificationMigration, /on\s+conflict\s+\(user_id,\s*dedupe_key\)\s+do\s+nothing/);
  assert.match(notificationMigration, /notification_after_quiet_hours/);
  assert.match(notificationMigration, /if\s+local_time\s*>=\s*preference\.quiet_hours_start/);
  assert.match(notificationMigration, /一項工作限期接近/);
  assert.doesNotMatch(notificationMigration, /task\.title|task\.notes|health|child.*generic_body/);
});

test("push endpoint registration and dispatch are authenticated through narrow RPCs", () => {
  assert.match(notificationMigration, /function\s+public\.save_push_subscription/);
  assert.match(notificationMigration, /actor\s+uuid\s*:=\s*\(select\s+auth\.uid\(\)\)/);
  assert.match(notificationMigration, /on\s+conflict\s+\(endpoint\)\s+do\s+update/);
  assert.match(notificationMigration, /notification_dispatch_authorized/);
  assert.match(notificationMigration, /extensions\.digest\(coalesce\(p_secret/);
  assert.match(notificationMigration, /grant\s+execute\s+on\s+function[^;]*public\.claim_due_notifications[^;]*to\s+anon/);
  assert.doesNotMatch(notificationMigration, /grant\s+execute\s+on\s+function[^;]*public\.claim_due_notifications[^;]*to\s+authenticated/);
});

test("server dispatch verifies the bearer secret and never logs private payloads", () => {
  assert.match(notificationRoute, /timingsafeequal/);
  assert.match(notificationRoute, /authorization/);
  assert.match(notificationRoute, /bearer\s*\$\{secret\}/);
  assert.match(notificationRoute, /claim_due_notifications/);
  assert.match(notificationRoute, /complete_notification_attempt/);
  assert.doesNotMatch(notificationRoute, /console\.(?:log|error)|row\.endpoint\)/);
});

test("notification claim hotfix uses the concrete attempt constraint and has a traceable rollback", () => {
  assert.match(notificationClaimFixMigration, /create or replace function public\.claim_due_notifications/);
  assert.match(notificationClaimFixMigration, /on conflict on constraint notification_attempts_delivery_id_subscription_id_attempt_n_key/);
  assert.doesNotMatch(notificationClaimFixMigration, /on conflict \(delivery_id, subscription_id, attempt_number\)/);
  assert.match(notificationClaimFixRollback, /on conflict \(delivery_id, subscription_id, attempt_number\)/);
});

test("weekly review is owner-only, additive, and never grants direct task changes", () => {
  assert.match(weeklyReviewMigration, /create table if not exists public\.weekly_reviews/);
  assert.match(weeklyReviewMigration, /alter table public\.weekly_reviews enable row level security/);
  assert.match(weeklyReviewMigration, /weekly_reviews_select_own/);
  assert.match(weeklyReviewMigration, /weekly_reviews_insert_own/);
  assert.match(weeklyReviewMigration, /weekly_reviews_update_own/);
  assert.match(weeklyReviewMigration, /weekly_review_next_action_required/);
  assert.match(weeklyReviewMigration, /grant select, insert, update on table public\.weekly_reviews to authenticated/);
  assert.doesNotMatch(weeklyReviewMigration, /grant[^;]*delete[^;]*weekly_reviews/);
  assert.doesNotMatch(weeklyReviewMigration, /(?:update|delete|insert)\s+public\.(?:tasks|assignments|share_records)/);
  assert.match(weeklyReviewRollback, /drop table if exists public\.weekly_reviews/);
  assert.doesNotMatch(weeklyReviewRollback, /drop table\s+(?:if\s+exists\s+)?public\.(?:tasks|assignments|share_records)/);
});

test("browser notification permission is explicit and service worker records opens", () => {
  assert.match(notificationSettings, /notification\.requestpermission\(\)/);
  assert.match(notificationSettings, /pushmanager\.subscribe/);
  assert.match(notificationSettings, /允許並啟用通知/);
  assert.match(notificationSettings, /night-shift/);
  assert.match(serviceWorker, /addEventListener\("push"/i);
  assert.match(serviceWorker, /addEventListener\("notificationclick"/i);
  assert.match(serviceWorker, /action:\s*"notification_opened"/);
});

test("notification rollback removes only notification objects and preserves core data", () => {
  for (const table of ["notification_attempts", "notification_deliveries", "push_subscriptions", "notification_preferences"]) {
    assert.match(notificationRollback, new RegExp(`drop\\s+table\\s+if\\s+exists\\s+public\\.${table}`));
  }
  assert.doesNotMatch(notificationRollback, /drop\s+table\s+(?:if\s+exists\s+)?public\.(?:tasks|assignments|user_planning_metadata|daily_capacity_checkins)/);
});

test("dependency migration prevents cycles and keeps task and project access scoped", () => {
  assert.match(dependencyMigration, /create table if not exists public\.task_dependencies/);
  assert.match(dependencyMigration, /create table if not exists public\.project_milestones/);
  assert.match(dependencyMigration, /task_dependency_cycle/);
  assert.match(dependencyMigration, /alter table public\.task_dependencies enable row level security/);
  assert.match(dependencyMigration, /alter table public\.project_milestones enable row level security/);
  assert.match(dependencyMigration, /current_user_can_edit/);
  assert.match(dependencyMigration, /current_user_can_read\('task', task_id\)/);
  assert.match(dependencyMigration, /current_user_can_read\('operating_item', project_id\)/);
  assert.match(dependencyMigration, /project_id uuid references public\.operating_items/);
  assert.match(dependencyRollback, /rollback_requires_explicit_data_handling/);
  assert.doesNotMatch(dependencyMigration, /drop table\s+(?:if\s+exists\s+)?public\.(?:tasks|operating_items)/);
});

test("recurring routines are owner-scoped, generate only on completion, and do not prefill a backlog", () => {
  assert.match(recurrenceMigration, /create table if not exists public\.task_recurrence_rules/);
  assert.match(recurrenceMigration, /create table if not exists public\.task_recurrence_generations/);
  assert.match(recurrenceMigration, /alter table public\.task_recurrence_rules enable row level security/);
  assert.match(recurrenceMigration, /alter table public\.task_recurrence_generations enable row level security/);
  assert.match(recurrenceMigration, /unique \(recurrence_rule_id, source_task_id\)/);
  assert.match(recurrenceMigration, /after update of status on public\.tasks/);
  assert.match(recurrenceMigration, /new\.status <> 'done' or old\.status = 'done'/);
  assert.match(recurrenceMigration, /where id = new\.recurrence_rule_id and owner_id = new\.owner_id and is_active/);
  assert.match(recurrenceMigration, /visibility\s*\) values \([\s\S]*?'private'/);
  assert.match(recurrenceMigration, /task_recurrence_rules_select_own/);
  assert.match(recurrenceMigration, /task_recurrence_generations_select_own/);
  assert.match(recurrenceRollback, /recurring_routines_rollback_requires_explicit_data_handling/);
  assert.doesNotMatch(recurrenceMigration, /drop table\s+(?:if\s+exists\s+)?public\.(?:tasks|operating_items)/);
});

test("recurrence foreign keys have additive, reversible covering indexes", () => {
  for (const index of [
    "task_recurrence_rules_created_by_idx",
    "task_recurrence_generations_source_task_idx",
    "task_recurrence_generations_generated_task_idx"
  ]) {
    assert.match(recurrenceIndexesMigration, new RegExp(`create\\s+index\\s+if\\s+not\\s+exists\\s+${index}`));
    assert.match(recurrenceIndexesRollback, new RegExp(`drop\\s+index\\s+if\\s+exists\\s+public\\.${index}`));
  }
});

test("Body Double sessions are two-person, durable, RLS-protected and do not mutate tasks", () => {
  for (const table of ["body_double_sessions", "body_double_participants"]) {
    assert.match(bodyDoubleMigration, new RegExp(`create\\s+table\\s+if\\s+not\\s+exists\\s+public\\.${table}`));
    assert.match(bodyDoubleMigration, new RegExp(`alter\\s+table\\s+public\\.${table}\\s+enable\\s+row\\s+level\\s+security`));
  }
  assert.match(bodyDoubleMigration, /body_double_open_pair_unique/);
  assert.match(bodyDoubleMigration, /duration_minutes in \(15, 20, 25, 45\)/);
  assert.match(bodyDoubleMigration, /body_double_sessions_select_participant/);
  assert.match(bodyDoubleMigration, /body_double_participants_select_session_participant/);
  assert.match(bodyDoubleMigration, /revoke all on public\.body_double_sessions, public\.body_double_participants from public, anon, authenticated/);
  assert.match(bodyDoubleMigration, /grant select on public\.body_double_sessions, public\.body_double_participants to authenticated/);
  assert.doesNotMatch(bodyDoubleMigration, /update public\.tasks/);
  assert.doesNotMatch(bodyDoubleMigration, /insert into public\.tasks/);
});

test("Body Double RPCs authenticate, use only trusted partners, and require a saved checkpoint before finish", () => {
  for (const functionName of ["create_body_double_session", "prepare_body_double_participant", "start_body_double_session", "update_body_double_presence", "heartbeat_body_double_session", "complete_body_double_participant"]) {
    assert.match(bodyDoubleMigration, new RegExp(`function\\s+public\\.${functionName}`));
  }
  assert.match(bodyDoubleMigration, /actor uuid := \(select auth\.uid\(\)\)/);
  assert.match(bodyDoubleMigration, /from public\.participant_profiles\(\) p where p\.user_id = p_partner_user_id/);
  assert.match(bodyDoubleMigration, /private\.current_user_can_read\('task', p_task_id\)/);
  assert.match(bodyDoubleMigration, /c\.task_id = selected_task_id and c\.author_id = actor and c\.state = 'saved'/);
  assert.match(bodyDoubleMigration, /body_double_checkpoint_required/);
  assert.match(bodyDoubleMigration, /grant execute on function public\.complete_body_double_participant/);
});

test("Body Double only offers tasks that can save the required checkpoint", () => {
  assert.match(bodyDoubleEligibilityMigration, /function public\.body_double_available_tasks/);
  assert.match(bodyDoubleEligibilityMigration, /private\.current_user_can_checkpoint\(t\.id\)/);
  assert.match(bodyDoubleEligibilityMigration, /not private\.current_user_can_checkpoint\(p_task_id\)/);
  assert.match(controlRoute, /rpc\("body_double_available_tasks"\)/);
  assert.match(bodyDoubleEligibilityRollback, /drop function if exists public\.body_double_available_tasks/);
  assert.match(bodyDoubleEligibilityRollback, /private\.current_user_can_read\('task', p_task_id\)/);
});

test("Body Double UI preserves privacy, reconnects safely, and uses the existing checkpoint flow", () => {
  assert.match(controlRoute, /view === "body_double"/);
  for (const action of ["create_body_double", "prepare_body_double", "start_body_double", "body_double_presence", "body_double_heartbeat", "complete_body_double"]) {
    assert.match(controlRoute, new RegExp(`case "${action}"`));
  }
  assert.match(bodyDoublePage, /私人任務/);
  assert.match(bodyDoublePage, /sharetasktitle/);
  assert.match(bodyDoublePage, /body_double_heartbeat/);
  assert.match(bodyDoublePage, /restartcheckpointpanel/);
  assert.match(bodyDoublePage, /對方仍可繼續/);
  assert.match(bodyDoublePage, /不是排名或監察/);
  assert.match(bodyDoubleRollback, /drop table if exists public\.body_double_participants/);
  assert.match(bodyDoubleRollback, /drop table if exists public\.body_double_sessions/);
  assert.doesNotMatch(bodyDoubleRollback, /drop\s+table\s+(?:if\s+exists\s+)?public\.(?:tasks|task_checkpoints|assignments|share_records)/);
});
