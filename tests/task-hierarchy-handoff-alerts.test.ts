import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { nextAssignmentAlert } from "../lib/assignment-alerts.ts";
import type { AssignmentAlertRecord } from "../lib/control-api.ts";

function assignment(values: Partial<AssignmentAlertRecord> = {}): AssignmentAlertRecord {
  return {
    id: "assignment-1", resource_id: "task-1", assigned_by_id: "derek",
    assigned_to_id: "suki", status: "pending_acceptance", due_date: "2026-10-05",
    accepted_at: null, acknowledged_at: null, created_at: "2026-10-04T00:00:00Z",
    updated_at: "2026-10-04T00:00:00Z", task_active: true,
    ...values
  };
}

test("recipient sees a received prompt until acknowledging; sender sees acknowledgement", () => {
  const pending = assignment();
  assert.equal(nextAssignmentAlert([pending], "suki", "2026-10-04", new Set())?.kind, "received");
  assert.equal(nextAssignmentAlert([pending], "derek", "2026-10-04", new Set()), null);
  const acknowledged = assignment({ acknowledged_at: "2026-10-04T00:30:00Z" });
  assert.equal(nextAssignmentAlert([acknowledged], "suki", "2026-10-04", new Set()), null);
  assert.equal(nextAssignmentAlert([acknowledged], "derek", "2026-10-04", new Set())?.kind, "acknowledged");
  const accepted = assignment({ status: "accepted", accepted_at: "2026-10-04T01:00:00Z" });
  assert.equal(nextAssignmentAlert([accepted], "suki", "2026-10-04", new Set()), null);
  assert.equal(nextAssignmentAlert([accepted], "derek", "2026-10-04", new Set())?.kind, "accepted");
});

test("sender follow-up only appears near due date for active acknowledged assignments", () => {
  const accepted = assignment({ status: "in_progress", accepted_at: "2026-09-20T00:00:00Z", due_date: "2026-10-05" });
  assert.equal(nextAssignmentAlert([accepted], "derek", "2026-10-04", new Set())?.kind, "followup");
  assert.equal(nextAssignmentAlert([accepted], "derek", "2026-10-02", new Set()), null);
  assert.equal(nextAssignmentAlert([{ ...accepted, task_active: false }], "derek", "2026-10-04", new Set()), null);
  assert.equal(nextAssignmentAlert([accepted], "derek", "2026-10-04", new Set([`followup:${accepted.id}:${accepted.due_date}`])), null);
  assert.equal(nextAssignmentAlert([assignment({ acknowledged_at: "2026-10-04T01:00:00Z" })], "derek", "2026-10-04", new Set(["acknowledged:assignment-1"]))?.kind, "followup");
});

test("child tasks preserve legacy data and assignment follow-ups are idempotent", () => {
  const migration = readFileSync("supabase/migrations/20261004150000_task_children_assignment_followups.sql", "utf8").toLowerCase();
  const route = readFileSync("app/api/control/route.ts", "utf8");
  const shell = readFileSync("components/AppShell.tsx", "utf8");
  const alerts = readFileSync("components/AssignmentAlerts.tsx", "utf8");
  assert.match(migration, /add column if not exists parent_task_id uuid references public\.tasks\(id\)/);
  assert.match(migration, /tasks_parent_active_idx/);
  assert.match(migration, /task_parent_forbidden/);
  assert.match(migration, /on conflict \(user_id, dedupe_key\) do nothing/);
  assert.match(migration, /private\.notification_dispatch_authorized/);
  assert.match(migration, /assignment_ack_forbidden/);
  assert.match(migration, /handover-acknowledged:/);
  assert.doesNotMatch(migration, /delete from public\.(tasks|operating_items)/);
  assert.match(route, /parent\.data\.owner_id !== user\.id/);
  assert.match(route, /parent_task_id: parentTaskId/);
  assert.match(route, /if \(itemType === "project"\) return jsonError/);
  assert.doesNotMatch(shell, /href: "\/workspace\/project"/);
  assert.match(alerts, /response\.quietModeUntil/);
  assert.match(alerts, /\/sharing\?tab=pending/);
  assert.match(route, /async function acknowledgeAssignment/);
});
