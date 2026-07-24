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
const controlRoute = readFileSync(resolve(here, "../app/api/control/route.ts"), "utf8").toLowerCase();
const taskForm = readFileSync(resolve(here, "../components/forms/TaskForm.tsx"), "utf8").toLowerCase();
const handoffControls = readFileSync(resolve(here, "../components/items/TaskHandoffControls.tsx"), "utf8").toLowerCase();

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
