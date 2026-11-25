import type { PersonalTaskTag, Task } from "./types.ts";

export const taskPriorityGrades = [
  { value: 1, label: "First priority", duration: "一星期", rank: 1 },
  { value: 2, label: "Urgent", duration: "兩星期", rank: 3 },
  { value: 3, label: "Semi urgent", duration: "一個月", rank: 4 },
  { value: 4, label: "Non urgent", duration: "六星期", rank: 5 }
] as const;

export type TaskPriorityGrade = typeof taskPriorityGrades[number]["value"];
export type GradedTask = Pick<Task, "priority_grade" | "priority_selected_grade" | "priority_escalation_date" | "status">
  & Partial<Pick<Task, "archived_at" | "deleted_at" | "completed_at" | "updated_at">>;
const hongKongDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit" });

function closedDate(value: string | null | undefined) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const instant = new Date(value);
  return Number.isFinite(instant.getTime()) ? hongKongDay.format(instant) : null;
}

export function parseTaskPriorityGrade(value: unknown): TaskPriorityGrade | null {
  const grade = typeof value === "string" && /^[1-4]$/.test(value) ? Number(value) : value;
  return grade === 1 || grade === 2 || grade === 3 || grade === 4 ? grade : null;
}

export function priorityGradeOption(grade: TaskPriorityGrade) {
  return taskPriorityGrades[grade - 1];
}

export function taskPriorityTagGrade(tag: Pick<PersonalTaskTag, "name" | "legacy_key">): TaskPriorityGrade | null {
  const legacy = /^priority_p([1-4])$/.exec(tag.legacy_key ?? "");
  if (legacy) return parseTaskPriorityGrade(legacy[1]);
  const name = tag.name.trim().toLowerCase();
  const short = /^p([1-4])$/.exec(name);
  return short ? parseTaskPriorityGrade(short[1]) : taskPriorityGrades.find((option) => option.label.toLowerCase() === name)?.value ?? null;
}

export function priorityDefaultDeadline(today: string, grade: TaskPriorityGrade): string {
  const day = new Date(`${today}T00:00:00Z`);
  if (grade === 3) {
    const originalDay = day.getUTCDate();
    day.setUTCDate(1);
    day.setUTCMonth(day.getUTCMonth() + 1);
    const lastDay = new Date(day);
    lastDay.setUTCMonth(lastDay.getUTCMonth() + 1, 0);
    day.setUTCDate(Math.min(originalDay, lastDay.getUTCDate()));
  } else {
    day.setUTCDate(day.getUTCDate() + (grade === 1 ? 7 : grade === 2 ? 14 : 42));
  }
  return day.toISOString().slice(0, 10);
}

/** The escalation anchor is independent of the editable task deadline. */
export function effectiveManagedTaskGrade(task: GradedTask, today: string): TaskPriorityGrade | null {
  const stored = parseTaskPriorityGrade(task.priority_grade);
  const anchor = task.priority_escalation_date;
  if (stored === null || stored === 1 || !anchor) return stored;
  let asOf = today;
  if (task.archived_at || task.deleted_at || task.status === "done" || task.status === "cancelled") {
    const dates = [task.archived_at, task.deleted_at, task.status === "done" ? task.completed_at : task.status === "cancelled" ? task.updated_at : null]
      .map(closedDate).filter((date): date is string => date !== null).sort();
    // Keep the grade visible before closing the task, even if closure preceded
    // the next persistence job. A closed task won't continue to escalate.
    if (!dates.length) return stored;
    if (dates[0] < today) asOf = dates[0];
  }
  // Include overdue anchors: once a grade rises, passing that date cannot undo it.
  const automatic = anchor <= priorityDefaultDeadline(asOf, 1) ? 1
    : anchor <= priorityDefaultDeadline(asOf, 2) ? 2
    : anchor <= priorityDefaultDeadline(asOf, 3) ? 3 : 4;
  return automatic < stored ? automatic : stored;
}

export function taskPriorityGrade(task: GradedTask & Pick<Task, "personal_tag_ids">, catalog: readonly PersonalTaskTag[], today: string) {
  const managed = effectiveManagedTaskGrade(task, today);
  if (managed !== null) return managed;
  const ids = new Set(task.personal_tag_ids ?? []);
  let strongest: TaskPriorityGrade | null = null;
  for (const tag of catalog) {
    if (!ids.has(tag.id)) continue;
    const candidate = taskPriorityTagGrade(tag);
    if (candidate !== null && (strongest === null || candidate < strongest)) strongest = candidate;
  }
  return strongest;
}
