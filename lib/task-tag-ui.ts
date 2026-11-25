import type { PersonalTaskTag } from "./types.ts";
import { taskPriorityGrades, taskPriorityTagGrade } from "./task-priority-grade.ts";

type TagPriority = 1 | 3 | 5;

export function taskTagPriority(tag: Pick<PersonalTaskTag, "name" | "legacy_key">): TagPriority | null {
  const grade = taskPriorityTagGrade(tag);
  return grade === 1 ? 1 : grade === 2 ? 3 : grade ? 5 : null;
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

export function taskMatchesTagText(task: { title: string; personal_tag_ids?: readonly string[] }, needle: string, tagNames: ReadonlyMap<string, string>) {
  const legacySearch = /^p([1-4])$/i.exec(needle.trim());
  const gradeLabel = legacySearch ? taskPriorityGrades[Number(legacySearch[1]) - 1].label.toLowerCase() : null;
  return !needle || task.title.toLocaleLowerCase().includes(needle)
    || (task.personal_tag_ids ?? []).some(id => {
      const name = tagNames.get(id)?.toLocaleLowerCase();
      return name?.includes(needle) || (gradeLabel !== null && name === gradeLabel) || (needle === "恩海居" && name === "sec");
    });
}
