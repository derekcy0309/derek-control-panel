import { shiftIsoDate } from "./due-priority.ts";
import { simplePriority } from "./simple-mode.ts";
import { taskTagPriority } from "./task-tag-ui.ts";
import type { PersonalTaskTag, Task } from "./types.ts";

type Rank = 1 | 3 | 5;
type TaskPriorityInput = Pick<Task, "due_date" | "requested_priority" | "status" | "archived_at" | "deleted_at" | "personal_tag_ids">;
const virtualPriority = {
  1: { id: "upcoming-priority:p1", name: "P1", legacy_key: "priority_p1" },
  3: { id: "upcoming-priority:p2", name: "P2", legacy_key: "priority_p2" }
} satisfies Record<1 | 3, PersonalTaskTag>;
const sameCreatedPriority = (tag: PersonalTaskTag) => tag.legacy_key?.startsWith("priority_") ?? false;
const dateOnly = /^\d{4}-\d{2}-\d{2}$/;

/** Compute one viewer's display/ranking only; never send these IDs to saves. */
export function createTaskPriorityProjection(
  catalog: readonly PersonalTaskTag[],
  tasks: readonly TaskPriorityInput[],
  today: string
) {
  const byId = new Map(catalog.map(tag => [tag.id, tag]));
  const tagRankById = new Map(catalog.map(tag => [tag.id, taskTagPriority(tag)]));
  const target = new Map<Rank, PersonalTaskTag>();
  for (const tag of catalog) {
    const rank = tagRankById.get(tag.id);
    if (rank && (!target.has(rank) || (sameCreatedPriority(tag) && !sameCreatedPriority(target.get(rank)!)))) {
      target.set(rank, tag);
    }
  }
  const seven = shiftIsoDate(today, 7), fourteen = shiftIsoDate(today, 14);
  function promotionWindow(task: TaskPriorityInput): 7 | 14 | null {
    const due = task.due_date;
    if (!due || !dateOnly.test(due) || due < today || due > fourteen || task.deleted_at || task.archived_at
      || task.status === "done" || task.status === "cancelled") return null;
    return due <= seven ? 7 : 14;
  }
  const promotedRank = (rank: Rank | null | undefined, window: 7 | 14 | null): 1 | 3 | null =>
    (rank === 3 || rank === 5) && window === 7 ? 1 : rank === 5 && window === 14 ? 3 : null;
  const destination = (rank: 1 | 3) => target.get(rank) ?? virtualPriority[rank];
  function promotedTag(task: TaskPriorityInput) {
    const window = promotionWindow(task);
    if (!window) return undefined;
    let promoted: 1 | 3 | null = null;
    for (const id of task.personal_tag_ids ?? []) {
      const next = promotedRank(tagRankById.get(id), window);
      if (next && (!promoted || next < promoted)) promoted = next;
    }
    return promoted ? destination(promoted) : undefined;
  }
  const displayCatalog = [...catalog];
  const virtualIds = new Set<string>();
  for (const task of tasks) {
    const tag = promotedTag(task);
    if (tag && !byId.has(tag.id) && !virtualIds.has(tag.id)) {
      displayCatalog.push(tag);
      virtualIds.add(tag.id);
    }
  }
  function ids(task: TaskPriorityInput): readonly string[] {
    const original = task.personal_tag_ids ?? [];
    const window = promotionWindow(task);
    if (!window) return original;
    const replacements = new Set<string>();
    const kept = new Set<string>();
    for (const id of original) {
      const next = promotedRank(tagRankById.get(id), window);
      if (next) replacements.add(destination(next).id);
      else kept.add(id);
    }
    return replacements.size ? [...new Set([...replacements, ...kept])] : original;
  }
  function rank(task: TaskPriorityInput): Rank {
    const window = promotionWindow(task);
    let priority: Rank | null = null;
    for (const id of task.personal_tag_ids ?? []) {
      const current = tagRankById.get(id);
      if (!current) continue;
      const effective = promotedRank(current, window) ?? current;
      if (!priority || effective < priority) priority = effective;
    }
    return priority ?? simplePriority(task.requested_priority);
  }
  const labelsById = new Map(displayCatalog.map(tag => [tag.id, tag]));
  function labels(task: TaskPriorityInput) {
    return ids(task).flatMap(id => {
      const tag = labelsById.get(id);
      return tag ? [tag] : [];
    }).sort((a, b) => (taskTagPriority(a) ?? 10) - (taskTagPriority(b) ?? 10));
  }
  return { catalog: displayCatalog, ids, rank, labels, promotedTag };
}

export type TaskPriorityProjection = ReturnType<typeof createTaskPriorityProjection>;
