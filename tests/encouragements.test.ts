import assert from "node:assert/strict";
import test from "node:test";
import { encouragements, hongKongDateKey, selectEncouragement } from "../lib/encouragements.ts";

test("encouragement library contains the approved 50 plus 36 sourced quotes", () => {
  assert.equal(encouragements.length, 86);
  assert.equal(new Set(encouragements.map((quote) => quote.id)).size, 86);
  assert.equal(encouragements.filter((quote) => quote.id.startsWith("B")).length, 36);
  assert.equal(encouragements.filter((quote) => !quote.id.startsWith("B")).length, 50);

  for (const quote of encouragements) {
    assert.ok(quote.zh.length > 0);
    assert.ok(quote.en.length > 0);
    assert.ok(quote.author.length > 0);
    assert.ok(quote.authorZh.length > 0);
    assert.ok(quote.citation.length > 0);
    assert.match(quote.sourceUrl, /^https:\/\//);
  }
});

test("unattributed original copy is not presented as a celebrity quotation", () => {
  const text = encouragements.map((quote) => quote.zh + " " + quote.en).join("\n");
  assert.doesNotMatch(text, /唔好用今日嘅能量/);
  assert.doesNotMatch(text, /今日唔需要完成全部/);
});

test("selection is deterministic and avoids recently displayed quotes", () => {
  const input = { pathname: "/tasks", dateKey: "2026-09-10" };
  const first = selectEncouragement(input);
  assert.deepEqual(selectEncouragement(input), first);

  const next = selectEncouragement({ ...input, recentIds: [first.id] });
  assert.notEqual(next.id, first.id);
  assert.equal(next.theme, first.theme);
});

test("Hong Kong date key uses the configured timezone", () => {
  assert.equal(hongKongDateKey(new Date("2026-09-09T16:30:00.000Z")), "2026-09-10");
});
