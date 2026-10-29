import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { customPrintableTasks, printableTaskPool, todayPrintableTasks } from "../lib/todo-print.ts";
import type { Task, PlanningMetadata, TaskDependency } from "../lib/types.ts";

const task = (id: string, values: Partial<Task> = {}) => ({ id, title: id, status: "not_started", ...values } as Task);
const plan = (id: string, values: Partial<PlanningMetadata> = {}) => ({ resource_id: id, resource_type: "task", user_id: "me", planned_date: "2026-10-28", plan_role: "later", plan_source: "manual", ...values } as PlanningMetadata);

test("printable tasks reuse existing ids and exclude completed, archived, waiting and blocked work", () => {
  const input = [task("ready"), task("ready"), task("done", { status: "done" }), task("cancelled", { status: "cancelled" }), task("waiting", { status: "waiting" }), task("step-waiting", { current_step_status: "waiting" }), task("blocked", { status: "blocked" }), task("reason", { blocked_reason: "waiting for permission" }), task("archived", { archived_at: "2026-10-28" }), task("deleted", { deleted_at: "2026-10-28" }), task("dependent")];
  const dependencies = [{ task_id: "dependent", depends_on_task_id: "waiting" }] as TaskDependency[];
  assert.deepEqual(printableTaskPool(input, dependencies).map(item => item.id), ["ready"]);
  assert.equal(input.length, 11);
});

test("today printing only uses current user's confirmed plan and respects manual order", () => {
  const tasks = [task("second"), task("first"), task("unplanned"), task("other-user"), task("tomorrow")];
  const planning = [plan("second", { plan_position: 2 }), plan("first", { plan_position: 1 }), plan("first", { plan_position: 1 }), plan("other-user", { user_id: "someone-else" }), plan("tomorrow", { planned_date: "2026-10-29" })];
  assert.deepEqual(todayPrintableTasks(tasks, planning, "me", "2026-10-28").map(item => item.id), ["first", "second"]);
});

test("automatic off-day, hidden and snoozed tasks do not get printed as today's work", () => {
  const tasks = [task("off-day", { work_dates: ["2026-10-29"] }), task("manual", { work_dates: ["2026-10-29"] }), task("hidden"), task("snoozed")];
  const planning = [plan("off-day", { plan_source: "auto_plan" }), plan("manual"), plan("hidden", { hidden_from_today: true }), plan("snoozed", { snoozed_until: "2026-10-29" })];
  assert.deepEqual(todayPrintableTasks(tasks, planning, "me", "2026-10-28").map(item => item.id), ["manual"]);
  assert.deepEqual(todayPrintableTasks(tasks, [], "me", "2026-10-28"), []);
});

test("custom selection keeps today's arranged tasks in their order before other tasks", () => {
  const items = [task("family"), task("personal"), task("work"), task("other")];
  const ordered = [items[2], items[0], items[1]];
  assert.deepEqual(customPrintableTasks(items, ordered).map(item => item.id), ["work", "family", "personal", "other"]);
  assert.deepEqual(items.map(item => item.id), ["family", "personal", "work", "other"]);
});

test("paper includes handwritten start/end times, next step and notes space but no private notes or finance fields", async () => {
  const sheet = await readFile(new URL("../components/tasks/TodoPrintSheet.tsx", import.meta.url), "utf8");
  const page = await readFile(new URL("../app/todo-list/page.tsx", import.meta.url), "utf8");
  assert.match(sheet, /____：____ 至 ____：____/);
  assert.match(sheet, /taskVisibleNextAction\(task\)/);
  assert.match(sheet, /完成勾選格/);
  assert.match(sheet, /tasks\.map\(\(task, index\)/);
  assert.doesNotMatch(sheet, /taskCategoryOptions\.map|tasks\.filter/);
  assert.doesNotMatch(sheet, /task\.notes|task\.description|cashflow|transactions|user_id/);
  assert.doesNotMatch(page, /controlAction|localStorage|sessionStorage/);
  assert.match(page, /useTodayData\(\)/);
  assert.match(page, /slice\(currentPage \* 20/);
  assert.match(page, /window\.print\(\)/);
});
