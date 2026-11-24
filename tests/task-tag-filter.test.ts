import assert from "node:assert/strict";
import test from "node:test";
import { activeTaskTagFilter, allTaskTags, matchesTaskTagFilter, toggleTaskTagFilter } from "../lib/task-tag-filter.ts";

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
