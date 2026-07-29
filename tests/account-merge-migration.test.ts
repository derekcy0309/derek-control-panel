import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const migration = readFileSync(
  resolve(here, "../supabase/migrations/20260729110000_merge_kwok_cy_into_derekcy0309.sql"),
  "utf8"
).toLowerCase();
const rollback = readFileSync(
  resolve(here, "../supabase/migrations/20260729110000_merge_kwok_cy_into_derekcy0309.rollback.sql"),
  "utf8"
).toLowerCase();

test("account merge resolves real accounts by email and never creates an account", () => {
  assert.match(migration, /lower\(email\) = 'kwok_cy@wecarenursing\.com\.hk'/);
  assert.match(migration, /lower\(email\) = 'derekcy0309@gmail\.com'/);
  assert.match(migration, /account_merge_source_not_found/);
  assert.match(migration, /account_merge_target_not_found/);
  assert.doesNotMatch(migration, /insert\s+into\s+auth\.users/);
});

test("account merge moves references before deleting the legacy Auth account", () => {
  assert.match(migration, /confrelid = 'auth\.users'::regclass/);
  assert.match(migration, /update storage\.objects/);
  assert.match(migration, /account_merge_reference_remains/);
  assert.match(migration, /delete from auth\.sessions/);
  assert.match(migration, /delete from auth\.users/);
  assert.match(migration, /account_merge_source_delete_failed/);
});

test("account merge preserves the target profile and grants administrator access", () => {
  assert.match(migration, /set is_admin = true/);
  assert.match(migration, /handoff_enabled = true/);
  assert.match(migration, /personal_calendar_email = 'derekcy0309@gmail\.com'/);
  assert.match(migration, /merged_legacy_account/);
});

test("rollback documentation does not claim that a deleted Auth identity can be restored", () => {
  assert.match(rollback, /irreversible/);
  assert.match(rollback, /does not support recreating a deleted identity/);
  assert.doesNotMatch(rollback, /insert\s+into\s+auth\.users/);
});
