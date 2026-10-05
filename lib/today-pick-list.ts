import type { Task } from "./types.ts";

export function todayPickMatches(tasks: Task[], includedIds: Set<string>, query: string, limit = 8) {
  const needle = query.trim().toLocaleLowerCase();
  return tasks.filter((task) =>
    !includedIds.has(task.id)
    && !["done", "cancelled", "waiting", "blocked"].includes(task.status)
    && !task.deleted_at && !task.archived_at
    && task.current_step_status !== "waiting"
    && !task.blocked_reason?.trim()
    && (!needle || task.title.toLocaleLowerCase().includes(needle))
  ).slice(0, limit);
}
