import { orderTodayPlan } from "./today-plan-order.ts";
import { taskScheduledForDate } from "./task-work-schedule.ts";
import type { Assignment, PlanningMetadata, Task, TaskDependency } from "./types.ts";

export const simplePriorities = [
  { value: 1, label: "P1 高 High" },
  { value: 3, label: "P2 一般 Normal" },
  { value: 5, label: "P3 低 Low" }
] as const;

export function simplePriority(value?: number) {
  return (value ?? 3) <= 2 ? 1 : (value ?? 3) <= 4 ? 3 : 5;
}

export function sortByPriority<T extends Pick<Task, "requested_priority">>(tasks: T[]): T[] {
  // Stable ties keep the source/manual order. No energy, date, risk or duration scoring.
  return [...tasks].sort((a, b) => simplePriority(a.requested_priority) - simplePriority(b.requested_priority));
}

export function isMyTask(task: Task, userId: string, assignments: Assignment[]) {
  const active = assignments.filter((a) => a.resource_type === "task" && a.resource_id === task.id
    && ["pending_acceptance", "accepted", "in_progress", "waiting", "blocked"].includes(a.status));
  if (active.length) return active.some((a) => a.assigned_to_id === userId && a.status !== "pending_acceptance");
  return (task.owner_id ?? task.user_id) === userId;
}

export function actionableTask(task: Task, dependencies: TaskDependency[], allTasks: Task[]) {
  if (task.deleted_at || task.archived_at || ["done", "cancelled", "waiting", "blocked"].includes(task.status)
    || task.current_step_status === "waiting" || task.blocked_reason?.trim()) return false;
  return !dependencies.some((d) => d.task_id === task.id
    && !allTasks.some((prerequisite) => prerequisite.id === d.depends_on_task_id && prerequisite.status === "done"));
}

// Snoozes created by the planner are Hong Kong calendar days stored as timestamps.
function snoozedPastToday(value:string|null|undefined,today:string) {
  if(!value)return false;
  if(/^\d{4}-\d{2}-\d{2}$/.test(value))return value>today;
  const ms=Date.parse(value);
  return Number.isFinite(ms) && new Date(ms+8*3_600_000).toISOString().slice(0,10)>today;
}

export function simpleToday(input: {
  tasks: Task[]; planning: PlanningMetadata[]; dependencies: TaskDependency[];
  assignments: Assignment[]; userId: string; today: string;
}) {
  const { tasks, planning, dependencies, assignments, userId, today } = input;
  const own = tasks.filter((t) => isMyTask(t, userId, assignments));
  const myPlanning = planning.filter((p) => p.user_id === userId && p.resource_type === "task");
  const plans = orderTodayPlan(myPlanning.filter((p) => p.planned_date === today && p.plan_role
    && !p.hidden_from_today && !snoozedPastToday(p.snoozed_until,today)));
  const planned = plans.flatMap((p) => {
    const task = own.find((t) => t.id === p.resource_id);
    return task && (p.plan_source === "manual" || taskScheduledForDate(task, today)) ? [task] : [];
  });
  const ready = (task: Task) => actionableTask(task, dependencies, tasks) && !snoozedPastToday(task.snoozed_until,today);
  const suggestions = own.filter((t) => ready(t) && taskScheduledForDate(t, today)
    && !myPlanning.some((p) => p.resource_id === t.id && (p.hidden_from_today || snoozedPastToday(p.snoozed_until,today)))
    && !planned.some((p) => p.id === t.id)).sort((a,b) => simplePriority(a.requested_priority)-simplePriority(b.requested_priority)
      || (a.due_date || "9999").localeCompare(b.due_date || "9999"));
  // A manual plan always wins. Completing one reveals the next in that same order.
  const active = planned.filter(ready);
  const ordered = planned.length ? active : suggestions;
  return { planned, ordered, top: ordered.slice(0, 3), suggestions, isSuggestion: planned.length === 0 };
}

export function taskTagNameError(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return "請輸入 Tag 名稱。";
  if (value.trim().length > 40) return "Tag 名稱最多 40 個字。";
  return null;
}
