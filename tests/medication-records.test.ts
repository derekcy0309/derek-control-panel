import assert from "node:assert/strict";
import test from "node:test";
import { alternatingDateTone, doseWithUnit, localToday, medicationPresets } from "../lib/medication-records.ts";

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
