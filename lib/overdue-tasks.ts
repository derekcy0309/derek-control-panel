import type { Task } from "./types.ts";

type DueTask = Pick<Task, "due_date" | "status" | "archived_at" | "deleted_at">;
const dayInMs = 86_400_000;
const dateOnly = /^\d{4}-\d{2}-\d{2}$/;

// Both inputs are civil dates (the caller supplies today's Hong Kong date).
// UTC arithmetic here only measures calendar days, not elapsed device hours.
function civilDay(date: string) {
  if (!dateOnly.test(date)) return null;
  const time = Date.parse(date + "T00:00:00Z");
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === date ? time : null;
}

export function overdueDays(dueDate: string | null | undefined, today: string): number | null {
  if (!dueDate || dueDate >= today) return null;
  const dueDay = civilDay(dueDate);
  const todayDay = civilDay(today);
  return dueDay !== null && todayDay !== null && todayDay > dueDay ? (todayDay - dueDay) / dayInMs : null;
}

export function overdueTaskDays(task: DueTask, today: string): number | null {
  if (task.archived_at || task.deleted_at || task.status === "done" || task.status === "cancelled") return null;
  return overdueDays(task.due_date, today);
}

export function isOverdueTask(task: DueTask, today: string) {
  return overdueTaskDays(task, today) !== null;
}
