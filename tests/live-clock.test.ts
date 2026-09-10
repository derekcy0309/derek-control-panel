import assert from "node:assert/strict";
import test from "node:test";
import { formatHongKongClock } from "../lib/live-clock.ts";

test("live clock always formats the supplied instant in Hong Kong time", () => {
  const result = formatHongKongClock(new Date("2026-09-10T12:34:56.000Z"));
  assert.equal(result.timeLabel, "20:34:56");
  assert.equal(result.dateLabel, "10/09/26 (Thu)");
  assert.equal(result.iso, "2026-09-10T12:34:56.000Z");
});
