import assert from "node:assert/strict";
import test from "node:test";
import { taskTagColors } from "../lib/task-tag-colors.ts";

test("the four classifications and all custom Tags get distinct colors, even with similar IDs", () => {
  const keys = ["personal", "family", "sec", "wecare", "priority_p1", "priority_p2", "priority_p3"];
  const tags = Array.from({ length: 60 }, (_, i) => ({
    id: "11111111-1111-4111-8111-" + String(i).padStart(12, "0"),
    legacy_key: keys[i] ?? (i === 50 ? "family" : null),
    name: `Tag ${i}`,
  }));
  const palette = taskTagColors(tags);
  assert.equal(palette.size, 60);
  assert.equal(new Set(Array.from(palette.values(), color => JSON.stringify(color))).size, 60);
  const reordered = tags.toReversed().map(tag => ({ ...tag, name: "Renamed " + tag.name }));
  assert.deepEqual(taskTagColors(reordered), palette);
  assert.equal(taskTagColors(tags), palette, "the same catalogue can be shared without rebuilding per row");
});
