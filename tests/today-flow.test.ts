import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { currentAndNextTodayTask, remainingTodayTasks } from "../lib/today-sequence.ts";
import type { Task } from "../lib/types.ts";

const baseTask: Task = {
  id: "now", user_id: "derek", owner_id: "derek", scope: "company", source_type: "deadline", title: "第一項", owner: null,
  due_date: null, follow_up_date: null, status: "done", next_action: "完成第一步", risk: "low", notes: null,
  completed_at: "2026-07-31T00:00:00.000Z", deleted_at: null, archived_at: null,
  created_at: "2026-07-31T00:00:00.000Z", updated_at: "2026-07-31T00:00:00.000Z", area: "work", visibility: "private"
};

test("Today promotes the next runnable confirmed task after Now is completed", () => {
  const later: Task = { ...baseTask, id: "later", title: "下一項", status: "not_started", next_action: "打開報表" };
  const quickWin: Task = { ...baseTask, id: "quick", title: "小任務", status: "not_started", next_action: "回覆訊息" };
  const position = currentAndNextTodayTask([baseTask, later, quickWin]);

  assert.equal(position.current?.id, "later");
  assert.equal(position.next?.id, "quick");
  assert.deepEqual(remainingTodayTasks([baseTask, later, quickWin], position.current?.id, position.next?.id), []);
});

test("Today skips completed, blocked, waiting, and cancelled items when showing the next step", () => {
  const blocked: Task = { ...baseTask, id: "blocked", status: "blocked" };
  const waiting: Task = { ...baseTask, id: "waiting", status: "waiting" };
  const cancelled: Task = { ...baseTask, id: "cancelled", status: "cancelled" };
  const ready: Task = { ...baseTask, id: "ready", status: "not_started", next_action: "立即開始" };
  const position = currentAndNextTodayTask([baseTask, blocked, waiting, cancelled, ready]);

  assert.equal(position.current?.id, "ready");
  assert.equal(position.next, null);
});

test("Today keeps the main action before secondary tools and exposes the following task", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /currentAndNextTodayTask\(plannedSequence\)/);
  assert.match(page, /完成這項後，下一個做/);
  assert.match(page, /上一項已完成，現在只需處理這一項。/);
  assert.ok(page.indexOf("<PrimaryTask") < page.lastIndexOf("<TodayTaskManager"));
  assert.match(page, /今日工具與完整安排/);
});
