import type { Task } from "./types.ts";

export function isTodayRunnableTask(task: Task) {
  return !["done", "cancelled", "blocked", "waiting"].includes(task.status) && !task.blocked_reason?.trim();
}

export function currentAndNextTodayTask(sequence: Task[]) {
  const runnable = sequence.filter(isTodayRunnableTask);
  return { current: runnable[0] ?? null, next: runnable[1] ?? null };
}

export function remainingTodayTasks(sequence: Task[], currentId?: string | null, nextId?: string | null) {
  return sequence.filter((task) => isTodayRunnableTask(task) && task.id !== currentId && task.id !== nextId);
}
