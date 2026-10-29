import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { moveTodayTask, sameTodayTasks } from "../lib/today-reorder.ts";

test("move a task straight to the start or end without mutating the input", () => {
  const items = ["a", "b", "c", "d"];
  assert.deepEqual(moveTodayTask(items, "d", 0), ["d", "a", "b", "c"]);
  assert.deepEqual(moveTodayTask(items, "a", 3), ["b", "c", "d", "a"]);
  assert.deepEqual(items, ["a", "b", "c", "d"]);
});

test("invalid positions and missing tasks do not change the order", () => {
  const items = ["a", "b"];
  for (const position of [-1, 2, 0.5, NaN]) assert.equal(moveTodayTask(items, "a", position), items);
  assert.equal(moveTodayTask(items, "missing", 1), items);
});

test("detect an updated list or duplicate before saving a draft", () => {
  assert.equal(sameTodayTasks(["b", "a"], ["a", "b"]), true);
  assert.equal(sameTodayTasks(["b", "a"], ["a", "c"]), false);
  assert.equal(sameTodayTasks(["a", "a"], ["a", "b"]), false);
  assert.equal(sameTodayTasks(["a"], ["a", "b"]), false);
});

test("the reorder interface batches changes and sends one saved order", () => {
  const source = readFileSync(resolve("components/TodayAllTasks.tsx"), "utf8");
  assert.match(source, /安排今日次序/);
  assert.match(source, /排到第幾位/);
  assert.match(source, /儲存次序/);
  assert.equal((source.match(/controlAction\("reorder_today_tasks"/g) ?? []).length, 1);
  assert.match(source, /!draftStillCurrent/);
});
