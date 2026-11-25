import assert from "node:assert/strict";
import { test } from "node:test";
import { createTaskPriorityProjection } from "../lib/upcoming-task-priority.ts";
import { matchesTaskTagFilter } from "../lib/task-tag-filter.ts";
import { taskMatchesTagText } from "../lib/task-tag-ui.ts";
import { effectiveTaskPriority } from "../lib/due-priority.ts";
import { parseTaskPriorityGrade, priorityDefaultDeadline, taskPriorityGrades } from "../lib/task-priority-grade.ts";
import { simpleToday } from "../lib/simple-mode.ts";
import { briefDate } from "../lib/calendar-brief.ts";
import type { PersonalTaskTag, PlanningMetadata, Task } from "../lib/types.ts";

const today = "2026-11-25";
const tags: PersonalTaskTag[] = [
  { id: "legacy-p3", name: "P3", legacy_key: "priority_p3" },
  { id: "category", name: "Wecare", legacy_key: null },
  { id: "legacy-p1", name: "最重要", legacy_key: "priority_p1" }
];
const make = (id: string, due: string | null, extra: Partial<Task> = {}) => ({
  id, title: id, due_date: due, personal_tag_ids: [], status: "not_started", requested_priority: 5, owner_id: "me", user_id: "me", ...extra
} as Task);
const managed = (grade: 1 | 2 | 3 | 4, anchor: string | null, more: Partial<Task> = {}) => ({
  priority_grade: grade, priority_selected_grade: grade, priority_escalation_date: anchor, ...more
});

test("four independent grades have the specified default Hong Kong calendar deadlines", () => {
  assert.deepEqual(taskPriorityGrades.map(({ value }) => priorityDefaultDeadline(today, value)), [
    "2026-12-02", "2026-12-09", "2026-12-25", "2027-01-06"
  ]);
  assert.equal(priorityDefaultDeadline("2027-01-31", 3), "2027-02-28");
  assert.equal(priorityDefaultDeadline("2028-01-31", 3), "2028-02-29");
  assert.equal(parseTaskPriorityGrade("4"), 4);
  for (const value of [0, 5, false, [], "1.0", "P1", ""]) assert.equal(parseTaskPriorityGrade(value), null);
});

test("all escalation boundaries are inclusive and running several missed dates can catch up", () => {
  const tasks = [
    make("outsideMonth", null, managed(4, "2026-12-26")),
    make("exactMonth", null, managed(4, "2026-12-25")),
    make("outside14", null, managed(3, "2026-12-10")),
    make("exact14", null, managed(3, "2026-12-09")),
    make("outside7", null, managed(2, "2026-12-03")),
    make("exact7", null, managed(2, "2026-12-02")),
    make("overdue", null, managed(4, "2026-11-15")),
    make("alreadyFirst", null, managed(1, "2027-02-01"))
  ];
  const p = createTaskPriorityProjection(tags, tasks, today);
  assert.deepEqual(tasks.map(p.rank), [5, 4, 4, 3, 3, 1, 1, 1]);
  assert.deepEqual(tasks.map(t => p.labels(t)[0].name), [
    "Non urgent", "Semi urgent", "Semi urgent", "Urgent", "Urgent", "First priority", "First priority", "First priority"
  ]);
});

test("editing or clearing the visible deadline cannot upgrade or downgrade a managed grade", () => {
  for (const due of ["2026-11-24", "2026-11-25", "2030-03-01", null]) {
    const first = make("first", due, managed(1, "2027-01-10", { priority_selected_grade: 4 }));
    const low = make("future", due, managed(4, "2027-01-10"));
    const projected = make("projected", due, managed(3, "2026-12-01"));
    const projection = createTaskPriorityProjection(tags, [first, low, projected], today);
    assert.equal(projection.rank(first), 1);
    assert.equal(projection.promotedTag(first)?.name, "First priority");
    assert.equal(projection.rank(low), 5);
    assert.equal(projection.rank(projected), 1);
    assert.equal(effectiveTaskPriority(low, today), 5);
  }
});

test("explicit manual lower choice establishes a new window and leaves the real due date alone", () => {
  const before = make("change", today, managed(1, "2026-11-24", { priority_selected_grade: 4 }));
  const after = { ...before, ...managed(4, priorityDefaultDeadline(today, 4)) };
  const p = createTaskPriorityProjection(tags, [before, after], today);
  assert.equal(after.due_date, before.due_date);
  assert.equal(p.rank(before), 1);
  assert.equal(p.rank(after), 5);
  assert.equal(p.promotedTag(after), undefined);
});

test("promotion crosses Hong Kong, not UTC, midnight and does not start for closed or undated occurrences", () => {
  const task = make("boundary", "2027-12-01", managed(2, "2026-12-03"));
  const before = briefDate(new Date("2026-11-25T15:59:59Z"));
  const after = briefDate(new Date("2026-11-25T16:00:00Z"));
  assert.equal(createTaskPriorityProjection(tags, [task], before).rank(task), 3);
  assert.equal(createTaskPriorityProjection(tags, [task], after).rank(task), 1);
  const excluded = [
    { ...task, status: "done" } as Task, { ...task, status: "cancelled" } as Task,
    { ...task, archived_at: "2026-11-25T15:59:00Z" }, { ...task, deleted_at: today }, { ...task, priority_escalation_date: null }
  ];
  assert.deepEqual(excluded.map(createTaskPriorityProjection(tags, excluded, after).rank), [3, 3, 3, 3, 3]);
  const completedBeforeCron = { ...task, status: "done", completed_at: "2026-11-25T16:05:00Z" } as Task;
  assert.equal(createTaskPriorityProjection(tags, [completedBeforeCron], "2027-01-01").rank(completedBeforeCron), 1);
});

test("canonical grade chips preserve raw organizational Tags, accept old filters/search terms and remain display-only", () => {
  const task = make("mixed", null, managed(1, "2026-12-01", { priority_selected_grade: 3, personal_tag_ids: ["legacy-p3", "category"] }));
  const projection = createTaskPriorityProjection(tags, [task], today);
  const ids = projection.ids(task);
  assert.deepEqual(ids, ["dayline-priority:1", "category"]);
  assert.ok(matchesTaskTagFilter(ids, new Set(["dayline-priority:1"])));
  assert.ok(!matchesTaskTagFilter(ids, new Set(["dayline-priority:3"])));
  assert.deepEqual(task.personal_tag_ids, ["legacy-p3", "category"]);
  const names = new Map(projection.catalog.map(tag => [tag.id, tag.name]));
  assert.ok(taskMatchesTagText({ title: task.title, personal_tag_ids: ids }, "p1", names));
  assert.ok(taskMatchesTagText({ title: task.title, personal_tag_ids: ids }, "first priority", names));
  const legacy = make("legacy", today, { personal_tag_ids: ["legacy-p3"] });
  assert.equal(createTaskPriorityProjection(tags, [legacy], today).rank(legacy), 4);
});

test("suggestions prefer the upgraded grade but manual Today order still wins", () => {
  const ordinary = make("ordinary", "2026-11-26", managed(2, "2026-12-09"));
  const promoted = make("upgraded", today, managed(3, "2026-12-01"));
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
