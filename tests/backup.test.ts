import test from "node:test";
import assert from "node:assert/strict";
import { backupRecordCounts, backupFormat, backupVersion, csvText, emptyBackupData, parseBackup } from "../lib/backup.ts";

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
  assert.deepEqual(backupRecordCounts(result.backup!.data).tasks, 1);
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
