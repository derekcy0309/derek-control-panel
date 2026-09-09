import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(resolve(here, "../supabase/migrations/20260909120022_request_duty.sql"), "utf8").toLowerCase();
const rollback = readFileSync(resolve(here, "../supabase/migrations/20260909120022_request_duty.rollback.sql"), "utf8").toLowerCase();
const schema = readFileSync(resolve(here, "../supabase/schema.sql"), "utf8").toLowerCase();
const controlRoute = readFileSync(resolve(here, "../app/api/control/route.ts"), "utf8");
const page = readFileSync(resolve(here, "../app/request-duty/page.tsx"), "utf8");
const appShell = readFileSync(resolve(here, "../components/AppShell.tsx"), "utf8");

test("request duty extends the existing task model without a duplicate data table", () => {
  assert.match(migration, /alter\s+table\s+public\.tasks/);
  assert.match(migration, /tasks_source_type_check/);
  assert.match(migration, /'duty_request'/);
  assert.doesNotMatch(migration, /create\s+table/);
  assert.match(schema, /source_type[\s\S]*'duty_request'/);
});

test("request duty creation requires a date and uses the existing private-by-default task access", () => {
  assert.match(controlRoute, /sourceType === "duty_request" && !dueDate/);
  assert.match(controlRoute, /defaultResourceAccess\(client, user\.id, area\)/);
  assert.match(page, /taskCategory: "sec"/);
  assert.match(page, /sourceType: "duty_request"/);
  assert.match(page, /dueDate: date/);
});

test("the checked state completes the original task and can be reopened", () => {
  assert.match(page, /controlAction\("update_task"/);
  assert.match(page, /status: completedState \? "done" : "not_started"/);
  assert.match(page, /completed_at: completedState \? new Date\(\)\.toISOString\(\) : null/);
  assert.match(page, /type="checkbox"/);
  assert.match(page, /顯示已完成/);
});

test("request duty is reachable from navigation and rollback keeps task records", () => {
  assert.match(appShell, /href: "\/request-duty", label: "Request Duty"/);
  assert.match(rollback, /update\s+public\.tasks[\s\S]*source_type\s*=\s*'follow_up'/);
  assert.doesNotMatch(rollback, /delete\s+from\s+public\.tasks/);
  assert.doesNotMatch(rollback, /drop\s+table/);
});
