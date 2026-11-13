import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

test("recurrence tags use an additive private hook without replacing the existing generator", async () => {
  const directory = new URL("../supabase/migrations/", import.meta.url);
  const file = (await readdir(directory)).find((name) => name.endsWith("_recurrence_and_backup_tags.sql"));
  assert.ok(file);
  const sql = await readFile(new URL(file, directory), "utf8");
  assert.match(sql, /after insert or update of generated_task_id on public\.task_recurrence_generations/);
  assert.match(sql, /link\.user_id = task_owner/);
  assert.match(sql, /tag\.user_id = task_owner and tag\.deleted_at is null/);
  assert.doesNotMatch(sql, /create or replace function private\.generate_next_recurring_task/);
  assert.doesNotMatch(sql, /security definer|disable row level security|drop table/i);
  assert.match(sql, /restore_backup_v2\(p_backup\)/);
  assert.match(sql, /revoke all on function public\.restore_backup_v3\(jsonb\) from public, anon/);
});

test("export, preview and confirmed restore include tags under the current account", async () => {
  const route = await readFile(new URL("../app/api/backup/route.ts", import.meta.url), "utf8");
  for (const table of ["personal_task_tags", "task_tag_assignments", "task_tag_preferences"]) {
    assert.match(route, new RegExp(`ownTagRows\\(client, "${table}", user.id`));
  }
  assert.match(route, /\.eq\("user_id", userId\)/);
  assert.match(route, /\.range\(index,/);
  assert.match(route, /rpc\("restore_backup_v3"/);
  assert.match(route, /body\.confirmation !== "RESTORE" \|\| body\.acknowledged !== true/);
  assert.match(route, /key: "tags", label: "Tags"/);
  assert.match(route, /Cache-Control": "private, no-store/);
});
