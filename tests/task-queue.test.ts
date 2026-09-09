import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { taskQueueBuckets, undatedUrgencyFor } from "../lib/task-queue.ts";
import { duePriorityBand, effectiveTaskPriority, operatingItemPriorityBand } from "../lib/due-priority.ts";
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

test("dated priority upgrades automatically as the due date approaches", () => {
  const today = "2026-09-10";
  assert.equal(duePriorityBand("2026-09-09", today), "high");
  assert.equal(duePriorityBand("2026-09-17", today), "high");
  assert.equal(duePriorityBand("2026-09-18", today), "medium");
  assert.equal(duePriorityBand("2026-10-01", today), "medium");
  assert.equal(duePriorityBand("2026-10-02", today), "low");
  assert.equal(effectiveTaskPriority(task("dated", { due_date: "2026-09-15", requested_priority: 5 }), today), 1);
  assert.equal(operatingItemPriorityBand({ due_date: null, metadata: { manualUrgency: "medium" } }, today), "medium");
});

test("task UI previews five priority items, puts undated work above the bottom calendar and prints A4", () => {
  const page = read("app/tasks/page.tsx");
  const form = read("components/forms/TaskForm.tsx");
  const section = read("components/tasks/TaskQueueSection.tsx");
  const calendar = read("components/tasks/TaskDueCalendar.tsx");
  const styles = read("app/globals.css");
  const duePicker = read("components/forms/DueDatePicker.tsx");

  assert.match(page, /const primaryPreviewLimit = 5/);
  assert.match(page, /defaultOpen previewLimit=\{primaryPreviewLimit\}/);
  assert.match(page, /第 8 至 14 日/);
  assert.match(page, /第 15 日以後/);
  assert.ok(page.indexOf("Semi-urgent（無日期）") < page.indexOf("<TaskDueCalendar"));
  assert.ok(page.indexOf("Non-urgent（無日期）") < page.indexOf("<TaskDueCalendar"));
  assert.ok(page.indexOf("已完成／已取消") < page.indexOf("<TaskDueCalendar"));
  assert.match(section, /顯示全部（共 \$\{tasks\.length\} 項）/);
  assert.match(calendar, /另有 \+\{dayTasks\.length - 3\} 項/);
  assert.match(form, /<DueDatePicker/);
  assert.match(duePicker, /到期日（可留空）/);
  assert.match(form, /requestedPriority: Number\(form\.requested_priority\)/);
  assert.match(form, /Urgent/);
  assert.match(form, /Semi-urgent/);
  assert.match(form, /Non-urgent/);
  assert.match(styles, /@page \{ size: A4 portrait/);
  assert.match(styles, /animation: overdue-attention 1\.8s ease-out 3/);
  assert.match(styles, /task-category-family/);
  assert.match(styles, /task-queue-section-semi/);
  assert.match(styles, /task-due-calendar-header/);
  assert.match(duePicker, /const quickDates = \[7, 14, 21, 30\]/);
  assert.match(duePicker, /\{days\} 日/);
  assert.match(duePicker, /type="date"/);
  assert.match(form, /自訂顯示狀態（可留空）/);
});

test("sidebar keeps the daily loop open and removes the duplicate sharing route", () => {
  const shell = read("components/AppShell.tsx");
  assert.match(shell, /label: "每日使用",[\s\S]*?defaultOpen: true/);
  assert.match(shell, /label: "計劃與跟進"/);
  assert.match(shell, /label: "協作與檢視"/);
  assert.equal((shell.match(/href: "\/sharing"/g) ?? []).length, 1);
  assert.match(shell, /label: "交辦及分享"/);
  assert.match(shell, /group\.defaultOpen \|\| activeGroup/);
  assert.doesNotMatch(shell, /href: "\/workspace\/sop"/);
  assert.doesNotMatch(shell, /href: "\/workspace\/document"/);
  assert.ok(shell.indexOf('href: "/cashflow"') < shell.indexOf('label: "系統設定"'));
  assert.match(shell, /EncouragementFooter/);
});

test("family overview explains sensitive school data and groups every item by urgency", () => {
  const workspace = read("app/workspace/[view]/page.tsx");
  assert.match(workspace, /高、中、低 urgency/);
  assert.match(workspace, /operatingItemPriorityBand/);
  assert.match(workspace, /學生姓名、班別／學號、聯絡資料、健康或特殊教育需要/);
  assert.match(workspace, /身份文件、登入資料/);
  assert.match(workspace, /自訂顯示狀態（可留空）/);
});

test("custom task status is bounded display metadata and never replaces workflow status", () => {
  const migration = read("supabase/migrations/20260909172149_task_custom_status.sql");
  const rollback = read("supabase/migrations/20260909172149_task_custom_status.rollback.sql");
  const api = read("app/api/control/route.ts");
  assert.match(migration, /add column if not exists custom_status_label text/);
  assert.match(migration, /between 1 and 60/);
  assert.doesNotMatch(migration, /drop constraint if exists tasks_status_check/i);
  assert.match(api, /custom_status_label: resourceText\(body\.customStatusLabel, 60\)/);
  assert.match(api, /payload\.custom_status_label = resourceText\(payload\.custom_status_label, 60\)/);
  assert.match(rollback, /drop column if exists custom_status_label/);
});
