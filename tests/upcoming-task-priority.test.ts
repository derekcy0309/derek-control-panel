import assert from "node:assert/strict";
import { test } from "node:test";
import { createTaskPriorityProjection } from "../lib/upcoming-task-priority.ts";
import { matchesTaskTagFilter } from "../lib/task-tag-filter.ts";
import { simpleToday } from "../lib/simple-mode.ts";
import { briefDate } from "../lib/calendar-brief.ts";
import type { PersonalTaskTag, PlanningMetadata, Task } from "../lib/types.ts";

const today = "2026-11-25";
const tags: PersonalTaskTag[] = [
  { id: "p3", name: "P3", legacy_key: "priority_p3" },
  { id: "category", name: "Wecare", legacy_key: null },
  { id: "p2", name: "P2", legacy_key: "priority_p2" },
  { id: "p1", name: "最重要", legacy_key: "priority_p1" }
];
const make = (id: string, due: string | null, ids = ["p3"], extra: Partial<Task> = {}) => ({
  id, due_date: due, personal_tag_ids: ids, status: "not_started", requested_priority: 5, owner_id: "me", user_id: "me", ...extra
} as Task);

test("uses inclusive HK thresholds, cascades P3 inside 7 days and preserves P1", () => {
  const tasks = [
    make("day15", "2026-12-10"),
    make("day14", "2026-12-09"),
    make("day8", "2026-12-03"),
    make("day7", "2026-12-02"),
    make("today", today, ["p2"]),
    make("p2twoWeeks", "2026-12-09", ["p2"]),
    make("persistP1", "2027-01-02", ["p1"])
  ];
  const projection = createTaskPriorityProjection(tags, tasks, today);
  assert.deepEqual(tasks.map(projection.rank), [5, 3, 3, 1, 1, 3, 1]);
  assert.deepEqual(tasks.map(t => projection.ids(t)[0]), ["p3", "p2", "p2", "p1", "p1", "p2", "p1"]);
  assert.equal(projection.labels(tasks[3])[0].name, "最重要", "preserve renamed existing owner tag");
});

test("the seven-day upgrade starts at Hong Kong midnight, not UTC midnight", () => {
  const upcoming = make("boundary", "2026-12-03");
  const before = briefDate(new Date("2026-11-25T15:59:59Z"));
  const after = briefDate(new Date("2026-11-25T16:00:00Z"));
  assert.equal(createTaskPriorityProjection(tags, [upcoming], before).rank(upcoming), 3);
  assert.equal(createTaskPriorityProjection(tags, [upcoming], after).rank(upcoming), 1);
});

test("upgrades real Tags only and never upgrades overdue, undated or closed tasks", () => {
  const tasks = [
    make("past", "2026-11-24"), make("undated", null),
    make("done", today, ["p3"], { status: "done" }), make("cancelled", today, ["p3"], { status: "cancelled" }),
    make("archive", today, ["p3"], { archived_at: today }), make("deleted", today, ["p3"], { deleted_at: today }),
    make("category", today, ["category"]), make("untagged", today, [])
  ];
  const projection = createTaskPriorityProjection(tags, tasks, today);
  assert.deepEqual(tasks.map(t => projection.promotedTag(t)), tasks.map(() => undefined));
  assert.deepEqual(tasks.map(t => projection.ids(t)), tasks.map(t => t.personal_tag_ids));
  assert.deepEqual(tasks.map(projection.rank), tasks.map(() => 5));
});

test("promoted Tag matches the filter without overwriting raw Tags or auto-creating deleted ones", () => {
  const both = make("mixed","2026-11-27", ["p3", "category", "p2"]);
  const projection = createTaskPriorityProjection(tags, [both], today);
  assert.deepEqual(projection.ids(both), ["p1", "category"]);
  assert.ok(matchesTaskTagFilter(projection.ids(both), new Set(["p1"])));
  assert.ok(!matchesTaskTagFilter(projection.ids(both), new Set(["p3"])));
  assert.deepEqual(both.personal_tag_ids, ["p3", "category", "p2"]);
  const retained = tags.filter(t => t.id !== "p1");
  const virtual = createTaskPriorityProjection(retained, [both], today);
  assert.deepEqual(virtual.ids(both), ["upcoming-priority:p1", "category"]);
  assert.equal(virtual.labels(both)[0].name, "P1");
  assert.ok(!retained.some(t => t.name === "P1"));
  assert.deepEqual(createTaskPriorityProjection(tags, [both], "2026-11-12").ids(both), both.personal_tag_ids);
});

test("suggestion order uses upgraded priority but manual Today order still wins", () => {
  const ordinary = make("ordinary", "2026-11-26", ["p2"]);
  const promoted = make("upgraded", "2026-11-25");
  const tasks = [ordinary, promoted];
  const projection = createTaskPriorityProjection(tags, tasks, today);
  const input = { tasks, planning: [] as PlanningMetadata[], dependencies: [], assignments: [], userId: "me", today, priorityRank: projection.rank };
  assert.deepEqual(simpleToday(input).ordered.map(t => t.id), [promoted.id, ordinary.id]);
  const planning = tasks.map((task, index) => ({
    user_id: "me", resource_type: "task", resource_id: task.id, planned_date: today, plan_source: "manual",
    plan_role: index === 0 ? "now" : "later", plan_position: index
  } as PlanningMetadata));
  assert.deepEqual(simpleToday({ ...input, planning }).ordered.map(t => t.id), [ordinary.id, promoted.id]);
});
