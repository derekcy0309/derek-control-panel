import type { OperatingItem, Task } from "./types.ts";

export type PriorityBand = "high" | "medium" | "low";

export function duePriorityBand(dueDate: string | null | undefined, today: string): PriorityBand | null {
  if (!dueDate) return null;
  const days = calendarDaysBetween(today, dueDate);
  if (days <= 7) return "high";
  if (days <= 21) return "medium";
  return "low";
}

export function priorityValueForDueDate(dueDate: string | null | undefined, today: string) {
  const band = duePriorityBand(dueDate, today);
  if (band === "high") return 1;
  if (band === "medium") return 3;
  if (band === "low") return 5;
  return null;
}

export function effectiveTaskPriority(task: Pick<Task, "due_date" | "requested_priority">, today: string) {
  return priorityValueForDueDate(task.due_date, today) ?? task.requested_priority ?? 3;
}

export function operatingItemPriorityBand(item: Pick<OperatingItem, "due_date" | "metadata">, today: string): PriorityBand {
  const dated = duePriorityBand(item.due_date, today);
  if (dated) return dated;
  const manual = item.metadata.manualUrgency;
  return manual === "high" || manual === "medium" || manual === "low" ? manual : "low";
}

export function shiftIsoDate(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function calendarDaysBetween(from: string, to: string) {
  const start = new Date(`${from}T12:00:00Z`).getTime();
  const end = new Date(`${to}T12:00:00Z`).getTime();
  return Math.round((end - start) / 86_400_000);
}
