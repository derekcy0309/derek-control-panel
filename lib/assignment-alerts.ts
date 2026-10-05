import type { AssignmentAlertRecord } from "./control-api";

export type AssignmentAlert = {
  key: string;
  assignmentId: string;
  taskId: string;
  kind: "received" | "acknowledged" | "accepted" | "followup";
  dueDate: string | null;
};

export function nextAssignmentAlert(
  records: AssignmentAlertRecord[],
  userId: string,
  today: string,
  seen: ReadonlySet<string>
): AssignmentAlert | null {
  const candidates: AssignmentAlert[] = [];
  for (const record of records) {
    if (record.assigned_to_id === userId && record.status === "pending_acceptance" && !record.acknowledged_at) {
      candidates.push({ key: `received:${record.id}`, assignmentId: record.id, taskId: record.resource_id, kind: "received", dueDate: record.due_date });
    }
    if (record.assigned_by_id !== userId || record.assigned_to_id === userId) continue;
    const receiptAt = record.acknowledged_at ?? record.accepted_at;
    const acceptedRecently = record.accepted_at
      && Date.parse(record.accepted_at) >= Date.parse(`${today}T00:00:00Z`) - 7 * 86400000;
    if (record.acknowledged_at) {
      candidates.push({ key: `acknowledged:${record.id}`, assignmentId: record.id, taskId: record.resource_id, kind: "acknowledged", dueDate: record.due_date });
    } else if (acceptedRecently) {
      candidates.push({ key: `accepted:${record.id}`, assignmentId: record.id, taskId: record.resource_id, kind: "accepted", dueDate: record.due_date });
    }
    if (record.task_active && receiptAt && record.due_date && ["pending_acceptance", "accepted", "in_progress", "waiting", "blocked"].includes(record.status)) {
      const days = Math.round((Date.parse(`${record.due_date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
      if (record.work_dates?.length ? days === 0 && record.work_dates.includes(today) : days >= 0 && days <= 1) {
        candidates.push({ key: `followup:${record.id}:${record.due_date}`, assignmentId: record.id, taskId: record.resource_id, kind: "followup", dueDate: record.due_date });
      }
    }
  }
  return candidates.find((candidate) => !seen.has(candidate.key)) ?? null;
}
