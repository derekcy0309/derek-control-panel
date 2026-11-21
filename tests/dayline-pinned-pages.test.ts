import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_PINNED_PAGES, makePinnedSlots, pinnedPageIsCurrent, readPinnedPages, updatePinnedSlot, validatePinnedPages
} from "../lib/dayline-pinned-pages.ts";

test("defaults are stable for existing or old account settings", () => {
  for (const old of [[], undefined, null, ["/old-page"], "settings"]) assert.deepEqual(readPinnedPages(old), DEFAULT_PINNED_PAGES);
  assert.deepEqual(readPinnedPages(["/calendar", "https://example.test", "/cashflow", "/calendar"]), ["/calendar", "/cashflow"]);
});

test("moving an already-pinned link swaps slots without duplicating it", () => {
  const initial = makePinnedSlots(["/calendar", "/cashflow"]);
  const slots = updatePinnedSlot(initial, 0, "/cashflow");
  assert.deepEqual(slots, ["/cashflow", "/calendar", "", "", ""]);
  assert.deepEqual(updatePinnedSlot(slots, 3, "/calendar"), ["/cashflow", "", "", "/calendar", ""]);
  assert.deepEqual(initial, ["/calendar", "/cashflow", "", "", ""]);
});

test("API permits a bounded unique allowlist, not arbitrary or restricted URLs", () => {
  assert.ok(validatePinnedPages([]));
  assert.ok(validatePinnedPages(DEFAULT_PINNED_PAGES));
  for (const invalid of [
    ["/calendar", "/calendar"], [...DEFAULT_PINNED_PAGES, "/search"], new Array(1),
    ["javascript:alert(1)"], ["//example.test"], ["https://example.test"], ["/calendar?next=/settings"],
    ["/admin/accounts"], ["/agent"], ["/api/control"], ["/../../../settings"], [null]
  ]) assert.equal(validatePinnedPages(invalid), false);
});

test("home and task list keep distinct active states and task details retain their parent hint", () => {
  assert.ok(pinnedPageIsCurrent("/", "/", "today"));
  assert.ok(!pinnedPageIsCurrent("/", "/", "tasks"));
  assert.ok(pinnedPageIsCurrent("/#task-action-list", "/", "tasks"));
  assert.ok(pinnedPageIsCurrent("/#task-action-list", "/tasks/task-1", "focus"));
  assert.ok(pinnedPageIsCurrent("/briefing", "/briefing/medical", "focus"));
  assert.ok(!pinnedPageIsCurrent("/briefing", "/briefing-fake", "focus"));
});
