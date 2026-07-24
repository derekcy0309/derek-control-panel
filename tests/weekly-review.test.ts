import assert from "node:assert/strict";
import test from "node:test";
import { addCalendarDays, assessWeeklyCapacity, normalizeWeeklyOutcomes, weekStartForDate } from "../lib/weekly-review.ts";

test("weekly review normalizes every selected date to Monday", () => {
  assert.equal(weekStartForDate("2026-07-25"), "2026-07-20");
  assert.equal(weekStartForDate("2026-07-20"), "2026-07-20");
  assert.equal(weekStartForDate("not-a-date"), null);
  assert.equal(weekStartForDate("2026-02-30"), null);
});

test("weekly review calendar bounds cross month boundaries safely", () => {
  assert.equal(addCalendarDays("2026-07-27", 6), "2026-08-02");
  assert.equal(addCalendarDays("2026-07-27", 7), "2026-08-03");
  assert.equal(addCalendarDays("invalid", 1), null);
});

test("weekly capacity only gives a gentle signal after a user provides capacity", () => {
  assert.deepEqual(assessWeeklyCapacity(120, null), {
    knownEstimatedMinutes: 120,
    availableMinutes: null,
    remainingMinutes: null,
    level: "unknown"
  });
  assert.equal(assessWeeklyCapacity(120, 200).level, "within_capacity");
  assert.equal(assessWeeklyCapacity(180, 200).level, "tight");
  assert.equal(assessWeeklyCapacity(240, 200).level, "over_capacity");
});

test("weekly outcomes remain user-authored, short and bounded", () => {
  assert.deepEqual(normalizeWeeklyOutcomes(["  第一件  ", "", 42, "第二件", "第三件", "第四件"]), ["第一件", "第二件", "第三件"]);
});
