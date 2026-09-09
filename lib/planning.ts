import type { Assignment, CapacityCheckin, PlanningMetadata, Task, TaskDependency, UserSettings } from "./types.ts";

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
  planning?: PlanningMetadata[];
  dependencies?: TaskDependency[];
  today?: string;
  minimumDay?: boolean;
  preference?: "balanced" | "easier";
  excludeNowTaskIds?: string[];
}) {
  const today = input.today ?? hkDateIso();
  const nowIso = new Date().toISOString();
  const activeAssignmentStatuses = new Set(["accepted", "in_progress"]);
  const assignmentByResource = new Map<string, Assignment>();
  for (const assignment of input.assignments) {
    if (assignment.resource_type !== "task") continue;
    const existing = assignmentByResource.get(assignment.resource_id);
    if (!existing || activeAssignmentStatuses.has(assignment.status)) {
      assignmentByResource.set(assignment.resource_id, assignment);
    }
  }
  const planningByResource = new Map(
    (input.planning ?? [])
      .filter((item) => item.resource_type === "task")
      .map((item) => [item.resource_id, item])
  );
  const taskById = new Map(input.tasks.map((task) => [task.id, task]));
  const dependencyBlockedTaskIds = new Set(
    (input.dependencies ?? [])
      .filter((dependency) => taskById.get(dependency.depends_on_task_id)?.status !== "done")
      .map((dependency) => dependency.task_id)
  );
  const wipCount = activeWipCount(input.tasks, input.assignments, input.currentUserId);
  const wipLimitReached = wipCount >= (input.settings.wip_limit ?? 3);
  const candidates = input.tasks.filter((task) => {
    if (["done","cancelled"].includes(task.status) || task.deleted_at || task.archived_at) return false;
    if (["blocked", "waiting"].includes(task.status) || Boolean(task.blocked_reason?.trim())) return false;
    if (dependencyBlockedTaskIds.has(task.id)) return false;
    const owned = (task.owner_id ?? task.user_id) === input.currentUserId;
    const assignment = assignmentByResource.get(task.id);
    const assigned = Boolean(
      assignment
      && assignment.assigned_to_id === input.currentUserId
      && activeAssignmentStatuses.has(assignment.status)
    );
    if (!owned && !assigned) return false;
    const personal = planningByResource.get(task.id);
    if (personal?.hidden_from_today) return false;
    if (personal?.snoozed_until && personal.snoozed_until > nowIso) return false;
    if (task.snoozed_until && task.snoozed_until > nowIso) return false;
    const recurrencePromptReady = Boolean(task.recurrence_rule_id && task.planned_date && task.planned_date <= today);
    if (wipLimitReached && task.status !== "in_progress" && assignment?.status !== "in_progress" && !recurrencePromptReady) return false;
    return true;
  });
  const energy = input.capacity?.energy_level;
  const minimumDay = Boolean(input.minimumDay);
  const preference = input.preference ?? "balanced";
  const excludedNow = new Set(input.excludeNowTaskIds ?? []);
  const scored = candidates.map((task) => {
    const due = task.due_date;
    const latest = task.latest_safe_start_date || calculateLatestSafeStart(due, task.estimated_duration_days ?? 0, task.buffer_days ?? 0);
    const risk = classifyDeadlineRisk({ dueDate: due, latestSafeStartDate: latest, status: task.status, waitingExternal: task.status === "waiting" }, today);
    const minutes = estimatedTaskMinutes(task, minimumDay);
    const personal = planningByResource.get(task.id);
    let score = 0;
    const reasons: string[] = [];
    if (risk === "overdue") { score += 1100; reasons.push("需要重新安排的限期"); }
    if (risk === "high_risk") { score += 1000; reasons.push("已到安全開始時間"); }
    if (risk === "attention") { score += 650; reasons.push("限期接近"); }
    if (task.safety_impact) { score += 900; reasons.push("涉及安全"); }
    if (task.child_impact) { score += 800; reasons.push("涉及子女"); }
    if (task.legal_impact) { score += 750; reasons.push("涉及法律或牌照"); }
    if (task.critical_path) { score += 600; reasons.push("關鍵路徑"); }
    if ((task.revenue_impact ?? 0) > 0) { score += Math.min(500, Number(task.revenue_impact) / 100); reasons.push("影響收入"); }
    if (task.status === "in_progress") { score += 240; reasons.push("已經開始"); }
    score += (6 - (task.requested_priority ?? 3)) * 75;
    const assignment = assignmentByResource.get(task.id);
    if (assignment?.assigned_to_id === input.currentUserId) { score += 160; reasons.push("已接受指派"); }
    if (task.recurrence_rule_id && task.planned_date && task.planned_date <= today) { score += 260; reasons.push("定期工作已到提示時段"); }
    else if (task.planned_date === today || personal?.planned_date === today) { score += 260; reasons.push("已安排今日"); }
    if (personal) score += (6 - personal.personal_priority) * 35;
    if (energy && task.energy_level === energy) { score += 130; reasons.push("配合今日能量"); }
    if (energy === "low" && minutes <= 15) { score += 220; reasons.push("低阻力小步驟"); }
    if (energy === "low" && task.energy_level === "high") score -= 500;
    if (input.capacity?.mode === "shift" && isShiftFriendly(task.context)) {
      score += 120;
      reasons.push("配合更表模式");
    }
    if (preference === "easier") {
      score += Math.max(0, 360 - minutes * 12);
      if (minutes <= 15) reasons.unshift("較容易開始");
    }
    if (input.capacity?.essential_only && risk === "normal" && !task.safety_impact && !task.child_impact && !task.legal_impact) score -= 900;
    return {
      task,
      score,
      risk,
      minutes,
      reasons: reasons.length ? unique(reasons).slice(0, 3) : ["下一個可執行項目"]
    };
  }).sort((a, b) => b.score - a.score
    || a.minutes - b.minutes
    || (a.task.due_date ?? "9999").localeCompare(b.task.due_date ?? "9999")
    || a.task.id.localeCompare(b.task.id));

  const availableMinutes = Math.max(0, input.capacity?.available_minutes ?? (minimumDay ? 30 : 90));
  const bufferMinutes = availableMinutes === 0
    ? 0
    : Math.min(minimumDay ? 10 : 45, Math.max(minimumDay ? 5 : 10, Math.ceil(availableMinutes * 0.2)));
  const workBudget = Math.max(0, availableMinutes - bufferMinutes);
  const selected = new Set<string>();
  const pickFirstFitting = (items: typeof scored, remaining: number) =>
    items.find((item) => !selected.has(item.task.id) && item.minutes <= remaining);
  const nowCandidates = scored.filter((item) =>
    !excludedNow.has(item.task.id)
    && (!minimumDay || item.minutes <= 25)
  );
  const now = pickFirstFitting(nowCandidates, workBudget) ?? null;
  let usedMinutes = 0;
  if (now) {
    selected.add(now.task.id);
    usedMinutes += now.minutes;
  }

  const quickLimit = minimumDay ? 2 : 3;
  const quickMaxMinutes = minimumDay ? 10 : 30;
  const quickWins: typeof scored = [];
  const quickCandidates = scored.filter((item) =>
    item.minutes <= quickMaxMinutes
    && (!minimumDay || item.task.energy_level !== "high")
  );
  const firstQuick = pickFirstFitting(quickCandidates, workBudget - usedMinutes);
  if (firstQuick) {
    quickWins.push(firstQuick);
    selected.add(firstQuick.task.id);
    usedMinutes += firstQuick.minutes;
  }

  const later: typeof scored = [];
  if (!minimumDay) {
    for (const item of scored) {
      if (later.length >= 2) break;
      if (selected.has(item.task.id) || item.minutes > workBudget - usedMinutes) continue;
      later.push(item);
      selected.add(item.task.id);
      usedMinutes += item.minutes;
    }
  }

  for (const item of quickCandidates) {
    if (quickWins.length >= quickLimit) break;
    if (selected.has(item.task.id) || item.minutes > workBudget - usedMinutes) continue;
    quickWins.push(item);
    selected.add(item.task.id);
    usedMinutes += item.minutes;
  }

  const eligibleMinutes = scored.reduce((sum, item) => sum + item.minutes, 0);
  const excludedBlocked = input.tasks.filter((task) =>
    !["done", "cancelled"].includes(task.status)
    && (["blocked", "waiting"].includes(task.status) || Boolean(task.blocked_reason?.trim()) || dependencyBlockedTaskIds.has(task.id))
  ).length;
  const unplannedMinutes = Math.max(0, eligibleMinutes - usedMinutes);
  return {
    now,
    later,
    quickWins,
    primary: now,
    progress: later,
    all: scored,
    availableMinutes,
    bufferMinutes,
    estimatedTotalMinutes: usedMinutes,
    remainingMinutes: Math.max(0, workBudget - usedMinutes),
    overCapacityMinutes: Math.max(0, eligibleMinutes - workBudget),
    hasCapacityOverflow: eligibleMinutes > workBudget,
    unplannedCount: Math.max(0, scored.length - selected.size),
    unplannedMinutes,
    excludedBlocked,
    dependencyBlocked: dependencyBlockedTaskIds.size,
    wipLimitReached
  };
}

export function suggestSmallerStep(task: Task) {
  const source = task.next_action?.trim() || task.title.trim();
  const shortened = source.length > 72 ? `${source.slice(0, 69)}…` : source;
  return {
    minutes: 10,
    text: task.next_action?.trim()
      ? `只做「${shortened}」的第一個可見動作`
      : `先打開需要的頁面或文件，寫下「${shortened}」的第一步`
  };
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
function estimatedTaskMinutes(task: Task, minimumDay: boolean) {
  const value = Number(task.estimated_minutes);
  if (Number.isFinite(value) && value > 0) return Math.min(14_400, Math.round(value));
  return minimumDay ? 15 : 25;
}
function isShiftFriendly(context: string | null | undefined) {
  return /夜|night|屋企|home|online|電腦|任何|any/i.test(context ?? "");
}
function unique(values: string[]) { return [...new Set(values)]; }
