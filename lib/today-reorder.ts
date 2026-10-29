/** Move one task to a zero-based position without mutating the current draft. */
export function moveTodayTask(ids: string[], taskId: string, position: number): string[] {
  const index = ids.indexOf(taskId);
  if (index < 0 || !Number.isInteger(position) || position < 0 || position >= ids.length || index === position) return ids;
  const result = [...ids];
  result.splice(index, 1);
  result.splice(position, 0, taskId);
  return result;
}

export function sameTodayTasks(draft: string[], current: string[]): boolean {
  return draft.length === current.length && new Set(draft).size === draft.length
    && draft.every((id) => current.includes(id));
}
