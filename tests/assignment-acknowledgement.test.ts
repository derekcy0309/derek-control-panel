import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("supabase/migrations/20261014065549_assignment_acknowledgement_permission.sql", "utf8");
const receiptGuard = migration.slice(migration.indexOf("if new.acknowledged_at is distinct"), migration.indexOf("if actor = old.assigned_by_id then return new"));

test("assignment acknowledgement permits only the pending recipient's first receipt", () => {
  assert.match(receiptGuard, /actor = old.assigned_to_id/);
  assert.match(receiptGuard, /old.status = 'pending_acceptance'/);
  assert.match(receiptGuard, /new.status = old.status/);
  assert.match(receiptGuard, /old.acknowledged_at is null/);
  assert.match(receiptGuard, /new.acknowledged_at is not null/);
  assert.match(receiptGuard, /to_jsonb\(new\) - array\['acknowledged_at','updated_at'\]/);
  assert.match(receiptGuard, /to_jsonb\(old\) - array\['acknowledged_at','updated_at'\]/);
  assert.match(receiptGuard, /raise exception 'ASSIGNMENT_ACK_FORBIDDEN'/);
});

test("the acknowledgement fix does not broaden grants, RLS or existing assignment identity", () => {
  assert.match(migration, /ASSIGNMENT_IDENTITY_IMMUTABLE/);
  assert.match(migration, /revoke all on function private.enforce_assignment_update_permission\(\) from public, anon, authenticated/);
  assert.doesNotMatch(migration, /\bgrant\b|\bcreate policy\b|disable row level|update public\.|delete from/i);
  const previous = readFileSync("supabase/rollback-20261014065549-assignment-acknowledgement-permission.sql", "utf8");
  const legacyStart = "if actor = old.assigned_by_id then return new; end if;";
  assert.equal(migration.slice(migration.indexOf(legacyStart)), previous.slice(previous.indexOf(legacyStart)));
});

test("database regression runs actual authenticated writes and rolls back its fixtures", () => {
  const sql = readFileSync("tests/sql/assignment-acknowledgement.sql", "utf8");
  assert.match(sql, /set local role authenticated/);
  assert.match(sql, /for actor_index in 1\.\.3 loop/);
  assert.match(sql, /public.start_task_handoff/);
  for (const assertion of ["OUTSIDER_READ_LEAK", "SENDER_ACKNOWLEDGED_FOR_RECIPIENT", "ACK_CHANGED_OTHER_FIELDS", "ACK_RETRY_CHANGED_RECORD", "RECEIPT_NOTIFICATION_NOT_EXACTLY_ONCE", "ACCEPTANCE_NOTIFICATION_NOT_EXACTLY_ONCE", "ACCEPT_DID_NOT_SET_CURRENT_ASSIGNEE", "FIXTURE_CLEANUP_FAILED"]) assert.ok(sql.includes(assertion));
  assert.match(sql, /exception when sqlstate 'PT001'/);
  assert.match(sql, /EXPECTED_LEGACY_BUG_NOT_REPRODUCED/);
});
