import assert from "node:assert/strict";
import { test } from "node:test";
import { withSavedTask } from "../lib/today-task-cache.ts";
import type { Task, TodayData } from "../lib/types.ts";

function task(id: string, status: Task["status"] = "not_started"): Task {
  return {
    id, user_id: "derek", scope: "home", source_type: "follow_up",
    title: id, owner: null, due_date: null, follow_up_date: null,
    status, next_action: null, risk: "low", notes: null,
    completed_at: null, deleted_at: null, archived_at: null,
    created_at: "2026-10-05T00:00:00Z", updated_at: "2026-10-05T00:00:00Z"
  };
}

function data(tasks: Task[] = []): TodayData {
  return { tasks, taskCatalog: tasks, taskQueueCatalog: tasks } as TodayData;
}

test("ordinary task save updates the three Today lists without refetch or duplicate", () => {
  const original = data([task("one")]);
  const created = withSavedTask(original, task("two"));
  assert.deepEqual(created.tasks.map((item) => item.id), ["two", "one"]);
  assert.deepEqual(created.taskCatalog.map((item) => item.id), ["two", "one"]);
  assert.deepEqual(created.taskQueueCatalog.map((item) => item.id), ["two", "one"]);
  assert.deepEqual(original.tasks.map((item) => item.id), ["one"]);

  const changed = withSavedTask(created, { ...task("two"), title: "已修改" });
  assert.equal(changed.tasks.filter((item) => item.id === "two").length, 1);
  assert.equal(changed.taskQueueCatalog[0].title, "已修改");
});

test("completed and waiting tasks stay in the task queue but not the active catalog", () => {
  const waiting = withSavedTask(data(), task("waiting", "waiting"));
  assert.equal(waiting.tasks.length, 0);
  assert.equal(waiting.taskCatalog.length, 1);
  assert.equal(waiting.taskQueueCatalog.length, 1);

  const completed = withSavedTask(waiting, task("waiting", "done"));
  assert.equal(completed.taskCatalog.length, 0);
  assert.equal(completed.taskQueueCatalog[0].status, "done");
});

test("a saved task keeps the current small step shown by the Today read model", () => {
  const existing = {
    ...task("one"), current_step_title: "開文件", current_step_status: "todo" as const,
    follow_up_date: "2026-10-06"
  };
  const changed = withSavedTask(data([existing]), { ...task("one"), title: "新名稱" });
  assert.equal(changed.taskQueueCatalog[0].current_step_title, "開文件");
  assert.equal(changed.taskQueueCatalog[0].follow_up_date, "2026-10-06");
});
