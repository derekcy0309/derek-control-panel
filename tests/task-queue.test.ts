import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { taskQueueBuckets, undatedUrgencyFor } from "../lib/task-queue.ts";
import type { Task } from "../lib/types.ts";

const here = resolve(fileURLToPath(new URL(".", import.meta.url)));
const read = (path: string) => readFileSync(resolve(here, `../${path}`), "utf8");

function task(id: string, values: Partial<Task> = {}): Task {
  return {
    id,
    user_id: "user-1",
    scope: "home",
    source_type: "follow_up",
    title: id,
    owner: null,
    due_date: null,
    follow_up_date: null,
    status: "not_started",
    next_action: null,
    risk: "low",
    notes: null,
    completed_at: null,
    deleted_at: null,
    archived_at: null,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    requested_priority: 3,
    ...values
  };
}

test("dated tasks use non-overlapping overdue, seven-day, fourteen-day and later buckets", () => {
  const buckets = taskQueueBuckets([
    task("overdue", { due_date: "2026-09-08" }),
    task("today", { due_date: "2026-09-09" }),
    task("day-7", { due_date: "2026-09-16" }),
    task("day-8", { due_date: "2026-09-17" }),
    task("day-14", { due_date: "2026-09-23" }),
    task("day-15", { due_date: "2026-09-24" })
  ], "2026-09-09");

  assert.deepEqual(buckets.overdue.map((item) => item.id), ["overdue"]);
  assert.deepEqual(buckets.dueWithin7Days.map((item) => item.id), ["today", "day-7"]);
  assert.deepEqual(buckets.dueWithin14Days.map((item) => item.id), ["day-8", "day-14"]);
  assert.deepEqual(buckets.dueLater.map((item) => item.id), ["day-15"]);
});

test("undated urgency reuses requested priority without duplicating the database model", () => {
  assert.equal(undatedUrgencyFor(task("urgent", { requested_priority: 1 })), "urgent");
  assert.equal(undatedUrgencyFor(task("semi", { requested_priority: 3 })), "semi_urgent");
  assert.equal(undatedUrgencyFor(task("non", { requested_priority: 5 })), "non_urgent");

  const buckets = taskQueueBuckets([
    task("urgent", { requested_priority: 2 }),
    task("semi", { requested_priority: 4 }),
    task("non", { requested_priority: 5 })
  ], "2026-09-09");
  assert.deepEqual(buckets.urgent.map((item) => item.id), ["urgent"]);
  assert.deepEqual(buckets.semiUrgent.map((item) => item.id), ["semi"]);
  assert.deepEqual(buckets.nonUrgent.map((item) => item.id), ["non"]);
});

test("waiting and blocked tasks never flash as runnable overdue work", () => {
  const buckets = taskQueueBuckets([
    task("waiting", { status: "waiting", due_date: "2026-09-01" }),
    task("blocked", { status: "blocked", due_date: "2026-09-01" }),
    task("done", { status: "done", due_date: "2026-09-01", completed_at: "2026-09-02T00:00:00Z" })
  ], "2026-09-09");
  assert.equal(buckets.overdue.length, 0);
  assert.deepEqual(buckets.waiting.map((item) => item.id), ["waiting"]);
  assert.deepEqual(buckets.blocked.map((item) => item.id), ["blocked"]);
  assert.deepEqual(buckets.completed.map((item) => item.id), ["done"]);
});

test("task UI previews five priority items, folds the rest, renders a due calendar and prints A4", () => {
  const page = read("app/tasks/page.tsx");
  const form = read("components/forms/TaskForm.tsx");
  const section = read("components/tasks/TaskQueueSection.tsx");
  const calendar = read("components/tasks/TaskDueCalendar.tsx");
  const styles = read("app/globals.css");

  assert.match(page, /const primaryPreviewLimit = 5/);
  assert.match(page, /defaultOpen previewLimit=\{primaryPreviewLimit\}/);
  assert.match(page, /第 8 至 14 日/);
  assert.match(page, /第 15 日以後/);
  assert.match(section, /顯示全部（共 \$\{tasks\.length\} 項）/);
  assert.match(calendar, /另有 \+\{dayTasks\.length - 3\} 項/);
  assert.match(form, /到期日（可留空）/);
  assert.match(form, /requestedPriority: Number\(form\.requested_priority\)/);
  assert.match(form, /Urgent/);
  assert.match(form, /Semi-urgent/);
  assert.match(form, /Non-urgent/);
  assert.match(styles, /@page \{ size: A4 portrait/);
  assert.match(styles, /animation: overdue-attention 1\.8s ease-out 3/);
});
