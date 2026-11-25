import type { Assignment, AssignmentStatus, Task } from "./types";

type Handoff = Pick<Assignment, "id" | "resource_type" | "resource_id" | "created_at" | "status" | "assigned_by_id" | "assigned_to_id" | "acknowledged_at" | "waiting_until" | "proposed_date" | "handoff_sequence" | "parent_assignment_id">;
type Work = Pick<Task, "id" | "owner_id" | "user_id" | "assignee_id" | "status" | "follow_up_date" | "current_step_status">;
type People = { currentUser: { id: string }; participants: readonly { user_id: string; display_name: string | null }[] };
type HandoffLine = { id: string; state: string; next: string; waitingUntil?: string | null; proposedDate?: string | null };

const finished: ReadonlySet<AssignmentStatus> = new Set(["declined", "returned", "completed", "closed", "cancelled"]);
const hkDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit" });
export function handoffsByTask<T extends Handoff>(assignments: readonly T[]) {
  const groups = new Map<string, T[]>();
  for (const assignment of assignments) {
    if (assignment.resource_type !== "task") continue;
    const group = groups.get(assignment.resource_id);
    if (group) group.push(assignment);
    else groups.set(assignment.resource_id, [assignment]);
  }
  return groups;
}

export function handoffDate(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? hkDate.format(parsed) : null;
}

/** A read-only projection of the assignments already visible in this user's view. */
export function handoffSummary(taskId: string, task: Work | undefined, assignments: readonly Handoff[], people: People) {
  const work = task?.id === taskId ? task : undefined;
  const history = assignments.filter(a => a.resource_type === "task" && a.resource_id === taskId)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || (b.handoff_sequence ?? 1) - (a.handoff_sequence ?? 1));
  const latest = history[0];
  const name = (id: string | undefined, fallback: string) => id === people.currentUser.id ? "你" : people.participants.find(p => p.user_id === id)?.display_name || fallback;
  const handler = name(work?.assignee_id ?? work?.owner_id ?? work?.user_id, "負責人");
  const active = history.filter(a => !finished.has(a.status));
  const followUp = handoffDate(work?.follow_up_date);
  let lines: HandoffLine[];
  if (work?.status === "done" || work?.status === "cancelled") {
    lines = [{ id: taskId, state: work.status === "done" ? "任務已完成" : "任務已取消", next: "毋須跟進" }];
  } else if (latest) {
    // More than one person can hold an open assignment for the same task.
    lines = (active.length ? active : [latest]).map(a => {
      const sender = name(a.assigned_by_id, "交辦人"), receiver = name(a.assigned_to_id, "接收人");
      const line = (state: string, next: string): HandoffLine => ({ id: a.id, state, next });
      switch (a.status) {
        case "pending_acceptance": return a.acknowledged_at ? line("已確認收悉，尚未接受", `待${receiver}決定是否接受`) : line("尚未確認收悉", `待${receiver}回覆交接`);
        case "accepted": return line("已接受交接", `由${receiver}跟進`);
        case "in_progress": return line(history.some(p => p.id === a.parent_assignment_id && p.status === "returned") ? "已交回上一位負責人" : "跟進中", `由${receiver}跟進`);
        case "waiting": return { ...line("等候回覆或結果", `由${receiver}跟進`), waitingUntil: handoffDate(a.waiting_until) };
        case "blocked": return line("工作受阻", `由${receiver}跟進阻礙`);
        case "clarification_requested": return line("已要求補充資料", `待${sender}補充資料`);
        case "alternative_date_proposed": return { ...line("已提議改期", `待${sender}確認新日期`), proposedDate: handoffDate(a.proposed_date) };
        case "declined": return line("接收人已婉拒", `由${sender}重新安排`);
        case "returned": return line("已交回上一位負責人", `由${sender}繼續跟進`);
        case "completed": return line("此段交接已完成", work ? `任務仍由${handler}跟進` : "未有後續交接資料");
        case "closed": return line("已結案", "毋須跟進");
        case "cancelled": return line("此段交接已取消", work ? `請${handler}確認下一步` : "未有後續交接資料");
      }
    });
  } else {
    lines = [{ id: taskId, state: work?.status === "waiting" || work?.current_step_status === "waiting" ? "等候回覆或結果" : "未有交接紀錄", next: `由${handler}跟進` }];
  }
  return { lines, followUp: work?.status === "done" || work?.status === "cancelled" || (!active.length && latest?.status === "closed") ? null : followUp };
}
