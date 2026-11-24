import type { PersonalTaskTag } from "./types.ts";

type TagPriority = 1 | 3 | 5;

export function taskTagPriority(tag: Pick<PersonalTaskTag, "name" | "legacy_key">): TagPriority | null {
  if (tag.legacy_key === "priority_p1") return 1;
  if (tag.legacy_key === "priority_p2") return 3;
  if (tag.legacy_key === "priority_p3") return 5;
  const name = tag.name.trim().toUpperCase();
  return name === "P1" ? 1 : name === "P2" ? 3 : name === "P3" ? 5 : null;
}

export function priorityFromTaskTags(ids: readonly string[], catalog: readonly PersonalTaskTag[]): TagPriority | null {
  const chosen = new Set(ids);
  let priority: TagPriority | null = null;
  for (const tag of catalog) {
    if (!chosen.has(tag.id)) continue;
    const next = taskTagPriority(tag);
    if (next !== null && (priority === null || next < priority)) priority = next;
  }
  return priority;
}

export function taskTagPriorityChange(before: readonly string[], after: readonly string[], catalog: readonly PersonalTaskTag[]): TagPriority | undefined {
  const beforePriority = priorityFromTaskTags(before, catalog);
  const afterPriority = priorityFromTaskTags(after, catalog);
  // Editing organisation tags alone must never alter the task's existing rank.
  return beforePriority === afterPriority ? undefined : (afterPriority ?? 3);
}

export function taskMatchesTagText(task: { title: string; personal_tag_ids?: string[] }, needle: string, tagNames: ReadonlyMap<string, string>) {
  return !needle || task.title.toLocaleLowerCase().includes(needle)
    || (task.personal_tag_ids ?? []).some(id => {
      const name = tagNames.get(id)?.toLocaleLowerCase();
      return name?.includes(needle) || (needle === "恩海居" && name === "sec");
    });
}
