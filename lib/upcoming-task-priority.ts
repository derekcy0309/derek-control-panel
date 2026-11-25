import { simplePriority } from "./simple-mode.ts";
import { priorityGradeOption, taskPriorityGrade, taskPriorityGrades, taskPriorityTagGrade, type GradedTask, type TaskPriorityGrade } from "./task-priority-grade.ts";
import type { PersonalTaskTag, Task } from "./types.ts";

type TaskPriorityInput = GradedTask & Pick<Task, "requested_priority" | "personal_tag_ids">;
const virtualTag = (grade: TaskPriorityGrade): PersonalTaskTag => ({
  id: `dayline-priority:${grade}`, name: priorityGradeOption(grade).label, legacy_key: `priority_p${grade}`
});

/** Priority chips share the Tag filters without mutating any user's private Tag links. */
export function createTaskPriorityProjection(
  catalog: readonly PersonalTaskTag[],
  tasks: readonly TaskPriorityInput[],
  today: string
) {
  const ordinaryTags = catalog.filter(tag => taskPriorityTagGrade(tag) === null);
  const oldGradeIds = new Set(catalog.filter(tag => taskPriorityTagGrade(tag) !== null).map(tag => tag.id));
  const gradesInView = new Set<TaskPriorityGrade>();
  const resolved = new WeakMap<TaskPriorityInput, TaskPriorityGrade | null>();
  function grade(task: TaskPriorityInput) {
    if (resolved.has(task)) return resolved.get(task) ?? null;
    const result = taskPriorityGrade(task, catalog, today);
    resolved.set(task, result);
    return result;
  }
  for (const task of tasks) {
    const result = grade(task);
    if (result !== null) gradesInView.add(result);
  }
  const displayCatalog = [
    ...taskPriorityGrades.filter(({ value }) => gradesInView.has(value)).map(({ value }) => virtualTag(value)),
    ...ordinaryTags
  ];
  const tagsById = new Map(displayCatalog.map(tag => [tag.id, tag]));
  function gradeTag(task: TaskPriorityInput) {
    const result = grade(task);
    return result === null ? undefined : virtualTag(result);
  }
  function ids(task: TaskPriorityInput): readonly string[] {
    const original = task.personal_tag_ids ?? [];
    const tag = gradeTag(task);
    return tag ? [tag.id, ...original.filter(id => !oldGradeIds.has(id))] : original;
  }
  function labels(task: TaskPriorityInput) {
    const tag = gradeTag(task);
    return ids(task).flatMap(id => {
      const label = id === tag?.id ? tag : tagsById.get(id);
      return label ? [label] : [];
    });
  }
  function rank(task: TaskPriorityInput) {
    const result = grade(task);
    return result === null ? simplePriority(task.requested_priority) : priorityGradeOption(result).rank;
  }
  function promotedTag(task: TaskPriorityInput) {
    const result = grade(task);
    return result !== null && task.priority_selected_grade && result < task.priority_selected_grade ? virtualTag(result) : undefined;
  }
  return { catalog: displayCatalog, ids, rank, labels, promotedTag };
}

export type TaskPriorityProjection = ReturnType<typeof createTaskPriorityProjection>;
