import assert from "node:assert/strict";
import test from "node:test";
import { activeTaskTagFilter, allTaskTags, isAllTaskTagFilter, isTaskTagFilterSelected, matchesTaskTagFilter, selectAllTaskTags, toggleTaskTagFilter } from "../lib/task-tag-filter.ts";

test("multiple selected Tag filters match any of the choices without mutating the selection", () => {
  const family = toggleTaskTagFilter(allTaskTags, "family");
  const familyOrWork = toggleTaskTagFilter(family, "work");
  assert.deepEqual([...family], ["family"]);
  assert.deepEqual([...familyOrWork], ["family", "work"]);
  assert.equal(matchesTaskTagFilter(["family"], familyOrWork), true);
  assert.equal(matchesTaskTagFilter(["work"], familyOrWork), true);
  assert.equal(matchesTaskTagFilter(["family", "work"], familyOrWork), true);
  assert.equal(matchesTaskTagFilter(["personal"], familyOrWork), false);
  assert.equal(matchesTaskTagFilter(undefined, familyOrWork), false);
  assert.deepEqual([...toggleTaskTagFilter(familyOrWork, "family")], ["work"]);
  assert.equal(matchesTaskTagFilter(undefined, allTaskTags), true);
});

test("untagged is exclusive and a removed Tag falls out of the active filter", () => {
  assert.equal(matchesTaskTagFilter([], "untagged"), true);
  assert.equal(matchesTaskTagFilter(["work"], "untagged"), false);
  const work = toggleTaskTagFilter("untagged", "work");
  assert.deepEqual([...work], ["work"]);
  const workOrFamily = toggleTaskTagFilter(work, "family");
  assert.equal(activeTaskTagFilter(workOrFamily, ["work", "family"]), workOrFamily);
  assert.deepEqual([...activeTaskTagFilter(workOrFamily, ["work"])], ["work"]);
  assert.equal(matchesTaskTagFilter(["personal"], activeTaskTagFilter(workOrFamily, ["personal"])), true);
});

test("pressing All checks all visible Tags without excluding untagged tasks", () => {
  const catalogue = ["family", "work", "dayline-priority:1"];
  const selected = activeTaskTagFilter(selectAllTaskTags, catalogue);
  assert.equal(selected, selectAllTaskTags);
  assert.equal(isAllTaskTagFilter(selected), true);
  assert.ok(catalogue.every(id => isTaskTagFilterSelected(selected, id)));
  assert.equal(matchesTaskTagFilter(["family"], selected), true);
  assert.equal(matchesTaskTagFilter(undefined, selected), true);
  assert.equal(matchesTaskTagFilter(["no-longer-listed"], selected), true);
  assert.equal(isTaskTagFilterSelected(allTaskTags, "family"), false, "initial unfiltered view still allows one-click narrowing");
  assert.equal(isTaskTagFilterSelected("untagged", "family"), false);
});

test("unchecking a Tag after All keeps the other Tags checked with OR matching", () => {
  const catalogue = new Set(["family", "work", "dayline-priority:1"]);
  const deselected = toggleTaskTagFilter(selectAllTaskTags, "family", catalogue);
  assert.equal(isAllTaskTagFilter(deselected), false);
  assert.equal(isTaskTagFilterSelected(deselected, "family"), false);
  assert.equal(isTaskTagFilterSelected(deselected, "work"), true);
  assert.equal(isTaskTagFilterSelected(deselected, "dayline-priority:1"), true);
  assert.equal(matchesTaskTagFilter(["family"], deselected), false);
  assert.equal(matchesTaskTagFilter(["family", "work"], deselected), true);
  assert.equal(matchesTaskTagFilter(["dayline-priority:1"], deselected), true);
  assert.equal(matchesTaskTagFilter([], deselected), false);
  assert.equal(toggleTaskTagFilter(selectAllTaskTags, "stale", catalogue), selectAllTaskTags);
  assert.deepEqual([...catalogue], ["family", "work", "dayline-priority:1"]);
});
