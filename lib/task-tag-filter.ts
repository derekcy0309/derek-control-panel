export type TaskTagFilter = ReadonlySet<string> | "untagged";
export const allTaskTags: ReadonlySet<string> = new Set();

export function activeTaskTagFilter(filter: TaskTagFilter, knownIds: Iterable<string>): TaskTagFilter {
  if (filter === "untagged" || filter.size === 0) return filter;
  const known = new Set(knownIds);
  const active = new Set([...filter].filter(id => known.has(id)));
  return active.size === filter.size ? filter : active;
}

export function toggleTaskTagFilter(filter: TaskTagFilter, id: string): TaskTagFilter {
  const next = new Set(filter === "untagged" ? [] : filter);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

export function matchesTaskTagFilter(tagIds: readonly string[] | undefined, filter: TaskTagFilter) {
  if (filter === "untagged") return !tagIds?.length;
  return !filter.size || Boolean(tagIds?.some(id => filter.has(id)));
}
