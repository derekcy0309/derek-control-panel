import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Focus completion preserves notes and visibly reports its progress", async () => {
  const focusMode = await readFile(new URL("../components/FocusMode.tsx", import.meta.url), "utf8");
  assert.match(focusMode, /saveCheckpointWithFallbacks/);
  assert.match(focusMode, /正在安全儲存專注 notes，然後完成任務/);
  assert.match(focusMode, /未能安全儲存專注 notes，所以任務尚未標記完成/);
});

test("task cards expose checkpoint notes on demand and surface failed actions", async () => {
  const taskCard = await readFile(new URL("../components/items/TaskCard.tsx", import.meta.url), "utf8");
  const checkpointPanel = await readFile(new URL("../components/TaskCheckpointNotesPanel.tsx", import.meta.url), "utf8");
  assert.match(taskCard, /TaskCheckpointNotesPanel/);
  assert.match(taskCard, /actionError/);
  assert.match(taskCard, /正在交差/);
  assert.match(checkpointPanel, /loadTaskCheckpoints/);
  assert.match(checkpointPanel, /你的未交差草稿/);
  assert.match(checkpointPanel, /專注模式記下的工作位置會在這裡保留/);
});
