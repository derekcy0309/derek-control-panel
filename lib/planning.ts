import type { Assignment, CapacityCheckin, Task, UserSettings } from "./types.ts";

const dayMs = 86_400_000;

export type DeadlineRisk = "normal" | "attention" | "high_risk" | "overdue" | "waiting_external";

export function hkDateIso(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function calculateLatestSafeStart(dueDate: string | null | undefined, estimatedDurationDays = 0, bufferDays = 0) {
  if (!dueDate) return null;
  const date = parseDate(dueDate);
  date.setUTCDate(date.getUTCDate() - Math.max(0, estimatedDurationDays) - Math.max(0, bufferDays));
  return date.toISOString().slice(0, 10);
}

export function classifyDeadlineRisk(input: {
  dueDate?: string | null;
  latestSafeStartDate?: string | null;
  status?: string;
  waitingExternal?: boolean;
}, today = hkDateIso()) : DeadlineRisk {
  if (input.status === "done" || input.status === "completed" || input.status === "cancelled") return "normal";
  if (input.dueDate && input.dueDate < today) return "overdue";
  if (input.waitingExternal) return "waiting_external";
  const latest = input.latestSafeStartDate;
  if (latest && latest < today) return "high_risk";
  if (latest && daysBetween(today, latest) <= 2) return "attention";
  if (input.dueDate && daysBetween(today, input.dueDate) <= 3) return "attention";
  return "normal";
}

export function isStaleTask(task: Pick<Task, "status" | "updated_at"> & Partial<Pick<Task, "last_progress_at">>, today = hkDateIso(), staleDays = 7) {
  if (["done", "cancelled"].includes(task.status)) return false;
  const last = (task.last_progress_at || task.updated_at).slice(0, 10);
  return daysBetween(last, today) >= staleDays;
}

export function validateNextAction(status: string, nextAction: string | null | undefined) {
  return status !== "in_progress" || Boolean(nextAction?.trim());
}

export function waitingAge(lastContactDate: string, today = hkDateIso()) {
  const days = Math.max(0, daysBetween(lastContactDate, today));
  const band = days <= 2 ? "0–2日" : days <= 6 ? "3–6日" : days <= 13 ? "7–13日" : "14日以上";
  return { days, band };
}

export function weightedPipelineRevenue(items: Array<{ monthlyRevenue: number; conversionProbability: number }>) {
  return items.reduce((total, item) => total + Math.max(0, item.monthlyRevenue) * Math.min(1, Math.max(0, item.conversionProbability)), 0);
}

export function profitTargetGap(target: number, expectedGrossProfit: number) {
  return Math.max(0, target - expectedGrossProfit);
}

export function activeWipCount(tasks: Task[], assignments: Assignment[], currentUserId: string) {
  const acceptedIds = new Set(assignments.filter((item) => item.assigned_to_id === currentUserId && ["accepted","in_progress","blocked"].includes(item.status)).map((item) => item.resource_id));
  return tasks.filter((task) => {
    if (task.status !== "in_progress") return false;
    const owned = (task.owner_id ?? task.user_id) === currentUserId;
    return owned || acceptedIds.has(task.id);
  }).length;
}

export function recommendTodayTasks(input: {
  tasks: Task[];
  assignments: Assignment[];
  currentUserId: string;
  settings: UserSettings;
  capacity: CapacityCheckin | null;
  today?: string;
}) {
  const today = input.today ?? hkDateIso();
  const assignmentByResource = new Map(input.assignments.map((assignment) => [assignment.resource_id, assignment]));
  const candidates = input.tasks.filter((task) => {
    if (["done","cancelled"].includes(task.status) || task.deleted_at || task.archived_at) return false;
    const owned = (task.owner_id ?? task.user_id) === input.currentUserId;
    const assignment = assignmentByResource.get(task.id);
    return owned || Boolean(assignment && assignment.assigned_to_id === input.currentUserId && ["accepted","in_progress","blocked"].includes(assignment.status));
  });
  const energy = input.capacity?.energy_level;
  const scored = candidates.map((task) => {
    const due = task.due_date;
    const latest = task.latest_safe_start_date || calculateLatestSafeStart(due, task.estimated_duration_days ?? 0, task.buffer_days ?? 0);
    const risk = classifyDeadlineRisk({ dueDate: due, latestSafeStartDate: latest, status: task.status, waitingExternal: task.status === "waiting" }, today);
    let score = 0;
    const reasons: string[] = [];
    if (risk === "overdue") { score += 1200; reasons.push("已過死線"); }
    if (risk === "high_risk") { score += 1000; reasons.push("已過最遲安全開始日"); }
    if (risk === "attention") { score += 650; reasons.push("死線接近"); }
    if (task.safety_impact) { score += 900; reasons.push("涉及安全"); }
    if (task.child_impact) { score += 800; reasons.push("涉及子女"); }
    if (task.legal_impact) { score += 750; reasons.push("涉及法律或牌照"); }
    if (task.critical_path) { score += 600; reasons.push("關鍵路徑"); }
    if ((task.revenue_impact ?? 0) > 0) { score += Math.min(500, Number(task.revenue_impact) / 100); reasons.push("影響收入"); }
    if (task.status === "blocked") { score += 420; reasons.push("需要解除阻礙"); }
    if (task.status === "in_progress") score += 180;
    score += (6 - (task.requested_priority ?? 3)) * 75;
    const assignment = assignmentByResource.get(task.id);
    if (assignment?.assigned_to_id === input.currentUserId) { score += 160; reasons.push("已接受指派"); }
    if (task.planned_date === today) { score += 260; reasons.push("已安排今日"); }
    if (energy && task.energy_level === energy) { score += 130; reasons.push("配合今日能量"); }
    if (energy === "low" && (task.estimated_minutes ?? 9999) <= 15) { score += 180; reasons.push("可先完成小步驟"); }
    if (input.capacity?.essential_only && risk === "normal" && !task.safety_impact && !task.child_impact && !task.legal_impact) score -= 900;
    return { task, score, risk, reasons: reasons.length ? reasons : ["下一個可執行項目"] };
  }).sort((a, b) => b.score - a.score || (a.task.due_date ?? "9999").localeCompare(b.task.due_date ?? "9999"));
  const progressLimit = input.settings.gentle_mode ? 2 : 3;
  return { primary: scored[0] ?? null, progress: scored.slice(1, 1 + progressLimit), all: scored };
}

export function notificationPreview(kind: "assignment" | "family" | "document" | "health" | "general", actorName?: string) {
  if (kind === "assignment") return `${actorName || "對方"} 指派了一項工作給你`;
  if (kind === "family") return "你有一項家庭事項需要處理";
  if (kind === "document") return "一項私人文件即將到期";
  if (kind === "health") return "你今日有一項健康行政事項";
  return "你有一項事項需要留意";
}

function parseDate(value: string) { return new Date(`${value.slice(0, 10)}T00:00:00.000Z`); }
function daysBetween(from: string, to: string) { return Math.floor((parseDate(to).getTime() - parseDate(from).getTime()) / dayMs); }
