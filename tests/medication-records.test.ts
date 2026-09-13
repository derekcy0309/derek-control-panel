import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { alternatingDateTone, doseWithUnit, localToday, medicationPresets } from "../lib/medication-records.ts";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

test("medication presets retain the requested options", () => {
  assert.deepEqual(medicationPresets, ["Ritalin", "Ritalin LA", "Concerta", "Vyvanse", "Atomextine", "其他藥物"]);
});

test("dose display adds mg once", () => {
  assert.equal(doseWithUnit("18"), "18 mg");
  assert.equal(doseWithUnit("18 mg"), "18 mg");
  assert.equal(doseWithUnit(""), "");
});

test("same-date groups alternate only two tones", () => {
  assert.equal(alternatingDateTone(0), alternatingDateTone(2));
  assert.equal(alternatingDateTone(1), alternatingDateTone(3));
  assert.notEqual(alternatingDateTone(0), alternatingDateTone(1));
});

test("today formatter is stable for a supplied local date", () => {
  assert.equal(localToday(new Date(2026, 7, 31, 9, 0, 0)), "2026-08-31");
});

test("medication records support an optional actual taken time", () => {
  const page = read("app/medications/page.tsx");
  const api = read("app/api/medication-logs/route.ts");
  const migration = read("supabase/migrations/20260913120000_medication_taken_time.sql");
  assert.match(page, /實際服用時間（可留空）/);
  assert.match(page, /type="time"/);
  assert.match(api, /taken_time/);
  assert.match(api, /服用時間不正確，請使用 24 小時格式/);
  assert.match(migration, /taken_time time without time zone/);
});
