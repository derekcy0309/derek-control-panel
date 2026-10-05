import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { todayPickMatches } from "../lib/today-pick-list.ts";
import type { Task } from "../lib/types.ts";

function task(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id, user_id: "user-1", scope: "home", source_type: "follow_up",
    title: id, owner: null, due_date: null, follow_up_date: null,
    status: "not_started", next_action: null, risk: "low", notes: null,
    completed_at: null, deleted_at: null, archived_at: null,
    created_at: "2026-10-05T00:00:00Z", updated_at: "2026-10-05T00:00:00Z",
    requested_priority: 3, ...overrides
  };
}

test("Today picker finds existing work without exposing waiting, blocked, completed or included tasks", () => {
  const tasks = [
    task("personal", { title: "個人安排" }),
    task("work", { title: "Wecare 工作" }),
    task("waiting", { status: "waiting" }),
    task("blocked", { blocked_reason: "等文件" }),
    task("done", { status: "done" })
  ];
  assert.deepEqual(todayPickMatches(tasks, new Set(["personal"]), "工作").map((item) => item.id), ["work"]);
  assert.deepEqual(todayPickMatches(tasks, new Set(), "").map((item) => item.id), ["personal", "work"]);
});

test("one task creation form can add the new task to Today in the same save", () => {
  const form = readFileSync("components/forms/TaskForm.tsx", "utf8");
  const control = readFileSync("app/api/control/route.ts", "utf8");
  const home = readFileSync("app/page.tsx", "utf8");
  assert.match(form, /addToToday: form\.add_to_today/);
  assert.match(form, /refreshRelated: form\.add_to_today/);
  assert.match(control, /body\.addToToday === true/);
  assert.match(control, /upsertTodayPlanning\(client, user\.id, result\.data\.id, true\)/);
  assert.match(home, /availableTasks=\{currentData\.taskQueueCatalog\}/);
  assert.doesNotMatch(home, /compact\s*\n\s*onSaved/);
});
