import { activeWipCount, classifyDeadlineRisk, hkDateIso } from "./planning.ts";
import type { Assignment, CapacityCheckin, OperatingItem, PlanningMetadata, Task, UserSettings } from "./types.ts";

export type CapacityLoadLevel = "unknown" | "within_capacity" | "tight" | "over_capacity";

export type CapacityOverloadAssessment = {
  today: { level: CapacityLoadLevel; availableMinutes: number | null; committedMinutes: number; bufferMinutes: number; overByMinutes: number };
  week: { level: CapacityLoadLevel; availableMinutes: number | null; committedMinutes: number; bufferMinutes: number; overByMinutes: number };
  wip: { count: number; limit: number; reached: boolean };
  commitmentCount: number;
  reasons: string[];
  deferCandidates: Task[];
  handoffCandidates: Task[];
  needsAttention: boolean;
};

export function assessCapacityOverload(input: {
  tasks: Task[];
  assignments: Assignment[];
  planning?: PlanningMetadata[];
  currentUserId: string;
  settings: UserSettings;
  capacity: CapacityCheckin | null;
  commitments?: Array<Pick<OperatingItem, "id" | "item_type" | "area" | "due_date" | "status">>;
  weeklyAvailableMinutes?: number | null;
  today?: string;
}): CapacityOverloadAssessment {
  const today = input.today ?? hkDateIso();
  const weekEnd = endOfWeek(today);
  const assignments = new Set(input.assignments
    .filter((assignment) => assignment.resource_type === "task" && assignment.assigned_to_id === input.currentUserId && ["accepted", "in_progress"].includes(assignment.status))
    .map((assignment) => assignment.resource_id));
  const planning = new Set((input.planning ?? [])
    .filter((item) => item.resource_type === "task" && item.planned_date === today && !item.hidden_from_today)
    .map((item) => item.resource_id));
  const actionable = input.tasks.filter((task) => isActionable(task, input.currentUserId, assignments));
  const commitments = (input.commitments ?? []).filter((item) => item.due_date && item.due_date >= today && item.due_date <= weekEnd && !["completed", "cancelled"].includes(item.status));
  const commitmentBuffer = Math.min(90, commitments.reduce((total, item) => total + (item.item_type === "health" || item.item_type === "school" ? 25 : 15), 0));
  const todayTasks = actionable.filter((task) => task.status === "in_progress" || task.planned_date === today || planning.has(task.id) || isUrgentToday(task, today));
  const weekTasks = actionable.filter((task) => task.status === "in_progress" || isDuringWeek(task, today, weekEnd));
  const todayCommitted = sumMinutes(todayTasks);
  const weekCommitted = sumMinutes(weekTasks);
  const todayBuffer = bufferFor(input.capacity, commitmentBuffer, true);
  const weekBuffer = weeklyBuffer(input.weeklyAvailableMinutes ?? null, commitmentBuffer);
  const todayLoad = loadLevel(input.capacity?.available_minutes ?? null, todayCommitted, todayBuffer);
  const weekLoad = loadLevel(input.weeklyAvailableMinutes ?? null, weekCommitted, weekBuffer);
  const wipCount = activeWipCount(input.tasks, input.assignments, input.currentUserId);
  const wipLimit = Math.max(1, input.settings.wip_limit ?? 3);
  const reasons: string[] = [];
  if (todayLoad.level === "over_capacity") reasons.push(`今日已排定約 ${todayCommitted} 分鐘，連同 ${todayBuffer} 分鐘緩衝後超出你填寫的可用時間。`);
  else if (todayLoad.level === "tight") reasons.push(`今日已接近你填寫的可用時間；已預留 ${todayBuffer} 分鐘緩衝。`);
  if (weekLoad.level === "over_capacity") reasons.push(`本週餘下的已知工作約 ${weekCommitted} 分鐘，超過你先前填寫的可用時間。`);
  else if (weekLoad.level === "tight") reasons.push("本週餘下時間接近容量上限，保留一些空間會較穩妥。");
  if (wipCount >= wipLimit) reasons.push(`進行中工作已有 ${wipCount} 項（你的上限是 ${wipLimit} 項）。`);
  if (input.capacity?.energy_level === "low") reasons.push("今天是低能量設定，所以建議不把可用時間填滿。");
  if (input.capacity?.mode === "shift") reasons.push("夜更模式下已保留額外轉換時間，建議只挑適合夜更的工作。 ");
  if (commitments.length) reasons.push(`本週餘下時間有 ${commitments.length} 項家庭／健康等承諾，已為它們預留 ${commitmentBuffer} 分鐘。`);

  const deferCandidates = actionable
    .filter((task) => canDefer(task, today))
    .sort((left, right) => estimateMinutes(right) - estimateMinutes(left)
      || (right.due_date ?? "9999-12-31").localeCompare(left.due_date ?? "9999-12-31")
      || left.id.localeCompare(right.id))
    .slice(0, 2);
  const handoffCandidates = deferCandidates.filter((task) => (task.owner_id ?? task.user_id) === input.currentUserId).slice(0, 1);

  return {
    today: todayLoad,
    week: weekLoad,
    wip: { count: wipCount, limit: wipLimit, reached: wipCount >= wipLimit },
    commitmentCount: commitments.length,
    reasons,
    deferCandidates,
    handoffCandidates,
    needsAttention: todayLoad.level === "over_capacity" || todayLoad.level === "tight" || weekLoad.level === "over_capacity" || weekLoad.level === "tight" || wipCount >= wipLimit
  };
}

function isActionable(task: Task, currentUserId: string, assignmentIds: Set<string>) {
  if (task.deleted_at || task.archived_at || ["done", "cancelled", "blocked", "waiting"].includes(task.status) || task.blocked_reason?.trim()) return false;
  return (task.owner_id ?? task.user_id) === currentUserId || assignmentIds.has(task.id);
}

function isUrgentToday(task: Task, today: string) {
  const risk = classifyDeadlineRisk({ dueDate: task.due_date, latestSafeStartDate: task.latest_safe_start_date, status: task.status }, today);
  return risk === "overdue" || risk === "high_risk" || (task.due_date !== null && task.due_date <= today);
}

function isDuringWeek(task: Task, today: string, weekEnd: string) {
  const date = task.due_date ?? task.planned_date ?? task.follow_up_date;
  return Boolean(date && date >= today && date <= weekEnd) || isUrgentToday(task, today);
}

function canDefer(task: Task, today: string) {
  if (task.status === "in_progress" || task.critical_path || task.safety_impact || task.child_impact || task.legal_impact || Number(task.revenue_impact ?? 0) > 0) return false;
  return classifyDeadlineRisk({ dueDate: task.due_date, latestSafeStartDate: task.latest_safe_start_date, status: task.status }, today) === "normal";
}

function sumMinutes(tasks: Task[]) { return tasks.reduce((total, task) => total + estimateMinutes(task), 0); }
function estimateMinutes(task: Task) {
  const value = Number(task.estimated_minutes);
  return Number.isFinite(value) && value > 0 ? Math.min(1440, Math.round(value)) : 25;
}
function bufferFor(capacity: CapacityCheckin | null, commitmentBuffer: number, daily: boolean) {
  const available = Math.max(0, capacity?.available_minutes ?? 0);
  if (!available) return commitmentBuffer;
  const ratio = capacity?.energy_level === "low" || capacity?.mode === "shift" || capacity?.essential_only ? 0.3 : 0.2;
  return Math.min(daily ? 120 : 240, Math.max(daily ? 10 : 30, Math.ceil(available * ratio)) + commitmentBuffer);
}
function weeklyBuffer(available: number | null, commitmentBuffer: number) {
  if (available === null || !Number.isFinite(available)) return commitmentBuffer;
  return Math.min(360, Math.max(30, Math.ceil(Math.max(0, available) * 0.15)) + commitmentBuffer);
}
function loadLevel(available: number | null, committed: number, buffer: number) {
  if (available === null || !Number.isFinite(available)) return { level: "unknown" as const, availableMinutes: null, committedMinutes: committed, bufferMinutes: buffer, overByMinutes: 0 };
  const minutes = Math.max(0, Math.round(available));
  const overBy = Math.max(0, committed + buffer - minutes);
  const level: CapacityLoadLevel = overBy > 0 ? "over_capacity" : minutes > 0 && (committed + buffer) / minutes >= 0.85 ? "tight" : "within_capacity";
  return { level, availableMinutes: minutes, committedMinutes: committed, bufferMinutes: buffer, overByMinutes: overBy };
}
function endOfWeek(date: string) {
  const value = new Date(`${date}T00:00:00.000Z`);
  const daysUntilSunday = (7 - value.getUTCDay()) % 7;
  value.setUTCDate(value.getUTCDate() + daysUntilSunday);
  return value.toISOString().slice(0, 10);
}
