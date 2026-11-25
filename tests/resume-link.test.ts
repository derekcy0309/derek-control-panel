import assert from "node:assert/strict";
import test from "node:test";
import { resumeCheckpointId, resumeTarget } from "../lib/resume-link.ts";

const owner = "self", task = { status: "in_progress", owner_id: owner };
const id = "11111111-1111-4111-8111-111111111111";
const latest = { id, author_id: owner, next_minimum_step: "核對下一段", last_worked_at: "2026-11-25T15:58:00Z" };
const now = new Date("2026-11-25T16:00:00Z");
test("按香港曆日而不是相隔 24 小時，無須追蹤登入", () => {
  assert.equal(resumeCheckpointId(owner, task, latest, now), id);
  for (const stamp of ["2026-11-25T16:00:00Z", "2026-11-26T16:00:00Z", "", "bad"]) {
    assert.equal(resumeCheckpointId(owner, task, { ...latest, last_worked_at: stamp }, now), null);
  }
});
test("僅本人任務、本人最新已載入的可接續記錄，缺少資料則不顯示", () => {
  for (const status of ["waiting","blocked","done","cancelled","unknown"]) assert.equal(resumeCheckpointId(owner,{...task,status},latest,now),null);
  for (const row of [{...task,owner_id:"other"},{...task,assignee_id:"other"},{...task,owner_id:undefined}]) assert.equal(resumeCheckpointId(owner,row,latest,now),null);
  for (const record of [null,{...latest,author_id:"other"},{...latest,next_minimum_step:" "},{...latest,id:"nested/path"}]) assert.equal(resumeCheckpointId(owner,task,record,now),null);
});
test("進度連結只識別具有效紀錄識別碼的站內錨點", () => {
  assert.equal(resumeTarget("#task-progress-"+id),id);
  for (const value of ["#task-progress-", id, "#task-progress-https://test.invalid", "#task-progress-"+id+"/extra"]) assert.equal(resumeTarget(value),null);
});
