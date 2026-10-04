import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { currentTaskStep, taskVisibleNextAction } from "../lib/task-steps.ts";
import { taskQueueBuckets } from "../lib/task-queue.ts";
import { isTodayRunnableTask } from "../lib/today-sequence.ts";
import type { Task, TaskStep } from "../lib/types.ts";

function step(id: string, sortOrder: number, status: TaskStep["status"]): TaskStep {
  return {
    id, task_id: "task-1", sort_order: sortOrder, title: `步驟 ${id}`, status,
    waiting_note: null, follow_up_date: null, completed_at: null,
    created_by_id: "owner", updated_by_id: "owner",
    created_at: "2026-10-04T00:00:00Z", updated_at: "2026-10-04T00:00:00Z"
  };
}

test("waiting for an earlier result keeps the sequence intact; later steps may be skipped", () => {
  const steps = [step("a", 1, "done"), step("b", 2, "waiting"), step("c", 3, "todo"), step("d", 4, "later")];
  assert.equal(currentTaskStep(steps)?.id, "b");
  steps[1].status = "later";
  assert.equal(currentTaskStep(steps)?.id, "c");
  steps[2].status = "done";
  assert.equal(currentTaskStep(steps)?.id, "b");
  steps[1].status = "done";
  assert.equal(currentTaskStep(steps)?.id, "d");
  steps[3].status = "done";
  assert.equal(currentTaskStep(steps), null);
});

test("task summary uses the current small step without overwriting the original next action", () => {
  assert.equal(taskVisibleNextAction({ current_step_title: "打開文件", next_action: "完成整份報告" }), "打開文件");
  assert.equal(taskVisibleNextAction({ current_step_title: null, next_action: "完成整份報告" }), "完成整份報告");
  assert.equal(taskVisibleNextAction({ current_step_title: null, current_step_status: "all_done", next_action: "完成整份報告" }), "細步驟已做完；確認是否可結案");
});

test("waiting for a step result stays in Waiting, not Today Now", () => {
  const task = {
    id: "task-1", status: "in_progress", current_step_status: "waiting",
    current_step_title: "等回覆", due_date: "2026-10-03", blocked_reason: null
  } as Task;
  assert.equal(isTodayRunnableTask(task), false);
  assert.deepEqual(taskQueueBuckets([task], "2026-10-04").waiting.map((item) => item.id), [task.id]);
  assert.equal(taskVisibleNextAction(task), "等待結果：等回覆");
});

test("migration keeps parent status independent and protects shared steps with RLS", () => {
  const sql = readFileSync("supabase/migrations/20261004120000_task_steps.sql", "utf8").toLowerCase();
  assert.match(sql, /alter table public\.task_steps enable row level security/);
  assert.match(sql, /current_user_can_read\('task', task_id\)/);
  assert.match(sql, /current_user_can_checkpoint\(task_id\)/);
  assert.match(sql, /create index if not exists task_steps_task_order_idx/);
  assert.match(sql, /create or replace view public\.task_current_steps with \(security_invoker = true\)/);
  assert.match(sql, /restore_backup_v2/);
  assert.doesNotMatch(sql, /(?:alter table|update) public\.tasks/);
  assert.doesNotMatch(sql, /set\s+status\s*=\s*'done'/);
});
