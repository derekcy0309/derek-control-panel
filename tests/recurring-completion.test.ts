import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("ongoing recurring work is completed as an occurrence, not presented as case closure", async () => {
  const taskCard = await readFile(new URL("../components/items/TaskCard.tsx", import.meta.url), "utf8");
  const today = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const focusMode = await readFile(new URL("../components/FocusMode.tsx", import.meta.url), "utf8");

  assert.match(taskCard, /const isOngoingRecurrence = Boolean\(recurrenceRule\?\.is_active\)/);
  assert.match(taskCard, /isOngoingRecurrence \? "今次已完成" : "完成任務"/);
  assert.match(taskCard, /不代表結案/);
  assert.match(today, /task\.recurrence_rule_id \? "今次已完成" : "完成任務"/);
  assert.match(today, /已記錄今次完成；這項恆常工作會按設定繼續提示。/);
  assert.match(focusMode, /task\.recurrence_rule_id \? "今次已完成" : "完成任務"/);
  assert.match(focusMode, /並不代表結案/);
});
