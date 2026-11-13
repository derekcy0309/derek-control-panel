import test from "node:test";
import assert from "node:assert/strict";
import { backupRecordCounts, backupFormat, backupVersion, backupTaskCsvRows, csvText, emptyBackupData, parseBackup, planBackupTagRestore } from "../lib/backup.ts";

const userId = "00000000-0000-4000-8000-000000000001";

function sampleBackup() {
  return {
    format: backupFormat,
    version: backupVersion,
    exportedAt: "2026-07-25T12:00:00.000Z",
    ownerId: userId,
    app: { version: "0.4.0", environment: "preview" },
    includes: ["本人任務"],
    excluded: ["共享資料"],
    data: { ...emptyBackupData(), tasks: [{ id: "00000000-0000-4000-8000-000000000002", title: "整理備份" }] }
  };
}

test("backup parser accepts the matching account and normalizes missing collections", () => {
  const result = parseBackup(sampleBackup(), userId);
  assert.equal(result.error, null);
  assert.equal(result.backup?.ownerId, userId);
  assert.equal(result.backup?.data.tasks.length, 1);
  assert.equal(result.backup?.data.checkpoints.length, 0);
  assert.equal(result.backup?.data.taskSteps.length, 0);
  assert.deepEqual(backupRecordCounts(result.backup!.data).tasks, 1);
});

test("backup keeps task steps as a first-class collection", () => {
  const backup = sampleBackup();
  backup.data.taskSteps.push({ id: "00000000-0000-4000-8000-000000000003", task_id: "00000000-0000-4000-8000-000000000002", title: "打開文件" });
  const parsed = parseBackup(backup, userId);
  assert.equal(parsed.error, null);
  assert.equal(parsed.backup?.data.taskSteps[0].title, "打開文件");
  assert.equal(backupRecordCounts(parsed.backup!.data).taskSteps, 1);
});

test("backup parser rejects other accounts, unsupported versions and oversized collections", () => {
  assert.match(parseBackup({ ...sampleBackup(), ownerId: "00000000-0000-4000-8000-000000000099" }, userId).error ?? "", /目前登入帳戶/);
  assert.match(parseBackup({ ...sampleBackup(), version: 99 }, userId).error ?? "", /格式或版本/);
  assert.match(parseBackup({ ...sampleBackup(), data: { ...emptyBackupData(), tasks: Array.from({ length: 10_001 }, () => ({})) } }, userId).error ?? "", /安全上限/);
});

test("CSV export quotes values and neutralizes spreadsheet formulas", () => {
  const csv = csvText([{ title: '=HYPERLINK("https://example.com")', notes: 'a,b' }], [{ key: "title", label: "標題" }, { key: "notes", label: "筆記" }]);
  assert.match(csv, /'=HYPERLINK/);
  assert.match(csv, /"a,b"/);
});

const taskId = "00000000-0000-4000-8000-000000000002";
const tagId = "00000000-0000-4000-8000-000000000003";
const otherTagId = "00000000-0000-4000-8000-000000000004";
function taggedBackup() {
  const backup = sampleBackup();
  backup.data.personalTaskTags = [{ id: tagId, user_id: userId, name: "學習", deleted_at: null }];
  backup.data.taskTagAssignments = [{ user_id: userId, task_id: taskId, tag_id: tagId }];
  backup.data.taskTagPreferences = [{ user_id: userId, initialized_at: "2026-11-13T12:00:00Z" }];
  return backup;
}

test("JSON round trip retains private tag definitions, links and no-reseed preference", () => {
  const backup = taggedBackup();
  const parsed = parseBackup(JSON.parse(JSON.stringify(backup)), userId);
  assert.equal(parsed.error, null);
  assert.deepEqual(parsed.backup?.data.personalTaskTags, backup.data.personalTaskTags);
  assert.deepEqual(parsed.backup?.data.taskTagAssignments, backup.data.taskTagAssignments);
  assert.deepEqual(parsed.backup?.data.taskTagPreferences, backup.data.taskTagPreferences);
  assert.equal(backupRecordCounts(parsed.backup!.data).taskTagAssignments, 1);
});

test("old V1 backups without tags remain valid and do not request any tag change", () => {
  const { personalTaskTags: _tags, taskTagAssignments: _links, taskTagPreferences: _preferences, ...oldData } = sampleBackup().data;
  const parsed = parseBackup({ ...sampleBackup(), data: oldData }, userId);
  assert.equal(parsed.error, null);
  assert.deepEqual(parsed.backup?.data.personalTaskTags, []);
  assert.deepEqual(parsed.backup?.data.taskTagAssignments, []);
  assert.deepEqual(parsed.backup?.data.taskTagPreferences, []);
});

test("tag backup rejects foreign owners, dangling links, duplicate names and malformed dates", () => {
  for (const mutate of [
    (data: ReturnType<typeof emptyBackupData>) => { data.personalTaskTags[0].user_id = otherTagId; },
    (data: ReturnType<typeof emptyBackupData>) => { data.taskTagAssignments[0].user_id = otherTagId; },
    (data: ReturnType<typeof emptyBackupData>) => { data.taskTagPreferences[0].user_id = otherTagId; },
    (data: ReturnType<typeof emptyBackupData>) => { data.taskTagAssignments[0].tag_id = otherTagId; },
    (data: ReturnType<typeof emptyBackupData>) => { data.personalTaskTags[0].deleted_at = "invalid"; },
    (data: ReturnType<typeof emptyBackupData>) => { data.personalTaskTags.push({ ...data.personalTaskTags[0], id: otherTagId }); }
  ]) {
    const backup = taggedBackup(); mutate(backup.data);
    assert.ok(parseBackup(backup, userId).error);
  }
  assert.ok(parseBackup({ ...taggedBackup(), data: { ...taggedBackup().data, personalTaskTags: {} } }, userId).error);
});

test("preview restores missing tags and links without changing any existing selection", () => {
  const data = taggedBackup().data;
  assert.deepEqual(planBackupTagRestore(data, [], [], new Set([taskId])), {
    tagAdds: 1, tagConflicts: 0, linkAdds: 1, linkConflicts: 0, unavailableLinks: 0, deletedTagLinks: 0
  });
  const tags = [{ id: otherTagId, name: " 學習 ", deleted_at: null }];
  const plan = planBackupTagRestore(data, tags, [{ task_id: taskId, tag_id: otherTagId }], new Set([taskId]));
  assert.equal(plan.tagAdds, 0); assert.equal(plan.tagConflicts, 1);
  assert.equal(plan.linkAdds, 0); assert.equal(plan.linkConflicts, 1);
});

test("preview respects an existing rename and never revives a deleted tag or unavailable task", () => {
  const data = taggedBackup().data;
  const renamed = planBackupTagRestore(data, [{ id: tagId, name: "新名稱", deleted_at: null }], [], new Set([taskId]));
  assert.equal(renamed.tagAdds, 0); assert.equal(renamed.linkAdds, 1);
  const removed = planBackupTagRestore(data, [{ id: tagId, name: "已移除", deleted_at: "2026-11-14T00:00:00Z" }, { id: otherTagId, name: "學習" }], [], new Set([taskId]));
  assert.equal(removed.linkAdds, 0); assert.equal(removed.deletedTagLinks, 1);
  const unavailable = planBackupTagRestore(data, [], [], new Set());
  assert.equal(unavailable.linkAdds, 0); assert.equal(unavailable.unavailableLinks, 1);
});

test("zero-tag backup still retains the initialization marker so removed presets stay removed", () => {
  const backup = taggedBackup(); backup.data.personalTaskTags = []; backup.data.taskTagAssignments = [];
  const parsed = parseBackup(backup, userId);
  assert.equal(parsed.error, null);
  assert.equal(parsed.backup?.data.taskTagPreferences.length, 1);
});

test("task CSV lists active tag names, excludes removed tags and neutralizes formulas", () => {
  const data = taggedBackup().data;
  data.personalTaskTags[0].name = "=FORMULA";
  data.personalTaskTags.push({ id: otherTagId, user_id: userId, name: "Removed", deleted_at: "2026-11-14T00:00:00Z" });
  data.taskTagAssignments.push({ user_id: userId, task_id: taskId, tag_id: otherTagId });
  const rows = backupTaskCsvRows(data);
  assert.equal(rows[0].tags, "=FORMULA");
  assert.match(csvText(rows, [{ key: "tags", label: "Tags" }]), /'=FORMULA/);
});
