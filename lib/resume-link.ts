const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hkDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit" });

/** Extra metadata for today's first task, not a second suggestion or a measure of absence. */
export function resumeCheckpointId(
  userId: string,
  task: { owner_id?: string | null; user_id?: string | null; assignee_id?: string | null; status?: string },
  latest: { id?: string; author_id?: string; next_minimum_step?: string | null; last_worked_at?: string | null } | null,
  now = new Date()
) {
  if (!userId || (task.owner_id ?? task.user_id) !== userId || (task.assignee_id && task.assignee_id !== userId)
    || !["not_started", "in_progress"].includes(task.status ?? "") || !latest?.id || !uuid.test(latest.id)
    || latest.author_id !== userId || !latest.next_minimum_step?.trim() || !latest.last_worked_at) return null;
  const last = new Date(latest.last_worked_at);
  if (!Number.isFinite(last.getTime()) || !Number.isFinite(now.getTime()) || hkDay.format(last) >= hkDay.format(now)) return null;
  return latest.id;
}

export function resumeTarget(hash: string) {
  const value = hash.startsWith("#task-progress-") ? hash.slice("#task-progress-".length) : "";
  return uuid.test(value) ? value : null;
}
