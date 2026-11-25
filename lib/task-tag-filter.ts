export type TaskTagFilter = ReadonlySet<string> | "untagged" | "all";

// The initial/reset state shows all tasks, but selecting one chip from there
// starts a single-Tag filter. An explicit 全部 click checks every visible chip.
export const allTaskTags: ReadonlySet<string> = new Set();
export const selectAllTaskTags = "all" as const;

export function isAllTaskTagFilter(filter: TaskTagFilter) {
  return filter === selectAllTaskTags || (typeof filter !== "string" && filter.size === 0);
}

export function isTaskTagFilterSelected(filter: TaskTagFilter, id: string) {
  return filter === selectAllTaskTags || (typeof filter !== "string" && filter.has(id));
}

export function activeTaskTagFilter(filter: TaskTagFilter, knownIds: Iterable<string>): TaskTagFilter {
  if (typeof filter === "string" || filter.size === 0) return filter;
  const known = new Set(knownIds);
  const active = new Set([...filter].filter(id => known.has(id)));
  return active.size === filter.size ? filter : active;
}

export function toggleTaskTagFilter(filter: TaskTagFilter, id: string, knownIds: Iterable<string> = []): TaskTagFilter {
  if (filter === selectAllTaskTags) {
    const next = new Set(knownIds);
    // A stale click on a chip removed from the catalogue cannot narrow All.
    return next.delete(id) ? next : filter;
  }
  const next = new Set(filter === "untagged" ? [] : filter);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

export function matchesTaskTagFilter(tagIds: readonly string[] | undefined, filter: TaskTagFilter) {
  if (filter === selectAllTaskTags) return true;
  if (filter === "untagged") return !tagIds?.length;
  return !filter.size || Boolean(tagIds?.some(id => filter.has(id)));
}
