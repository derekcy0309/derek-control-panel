import assert from "node:assert/strict";
import { test } from "node:test";
import { isOverdueTask, overdueDays, overdueTaskDays } from "../lib/overdue-tasks.ts";

const today = "2026-11-25";
const active = { due_date: "2026-11-24", status: "not_started", archived_at: null, deleted_at: null } as const;

test("only real dates strictly before today show overdue", () => {
  assert.equal(overdueDays("2026-11-24", today), 1);
  assert.equal(overdueDays("2026-11-25", today), null);
  assert.equal(overdueDays("2026-11-26", today), null);
  assert.equal(overdueDays(null, today), null);
  assert.equal(overdueDays("2026-02-30", today), null);
  assert.equal(overdueDays("2026-11-24T23:00:00Z", today), null);
});

test("days late are HK calendar dates, including year and leap-day boundaries", () => {
  assert.equal(overdueDays("2026-12-31", "2027-01-02"), 2);
  assert.equal(overdueDays("2028-02-28", "2028-03-01"), 2);
});

test("only active overdue tasks qualify, including waiting or blocked; ownership belongs to the caller", () => {
  assert.equal(overdueTaskDays(active, today), 1);
  assert.equal(isOverdueTask({ ...active, status: "waiting" }, today), true);
  assert.equal(isOverdueTask({ ...active, status: "blocked" }, today), true);
  assert.equal(isOverdueTask({ ...active, status: "done" }, today), false);
  assert.equal(isOverdueTask({ ...active, status: "cancelled" }, today), false);
  assert.equal(isOverdueTask({ ...active, archived_at: "2026-11-24T10:00:00Z" }, today), false);
  assert.equal(isOverdueTask({ ...active, deleted_at: "2026-11-24T10:00:00Z" }, today), false);
});
