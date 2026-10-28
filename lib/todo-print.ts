import { orderTodayPlan } from "./today-plan-order.ts";
import { taskScheduledForDate } from "./task-work-schedule.ts";
import type { PlanningMetadata, Task, TaskDependency } from "./types.ts";

export function printableTaskPool(tasks: Task[], dependencies: TaskDependency[] = []): Task[] {
  const byId = new Map(tasks.map(task => [task.id, task]));
  const blocked = new Set(dependencies.filter(item => byId.get(item.depends_on_task_id)?.status !== "done").map(item => item.task_id));
  return [...byId.values()].filter(task => !task.archived_at && !task.deleted_at
    && !["done", "cancelled", "waiting", "blocked"].includes(task.status)
    && task.current_step_status !== "waiting" && !task.blocked_reason?.trim() && !blocked.has(task.id));
}

export function todayPrintableTasks(tasks: Task[], planning: PlanningMetadata[], userId: string, today: string): Task[] {
  const byId = new Map(tasks.map(task => [task.id, task]));
  const entries = orderTodayPlan(planning.filter(item => item.user_id === userId
    && item.resource_type === "task" && item.planned_date === today && item.plan_role
    && !item.hidden_from_today && (!item.snoozed_until || item.snoozed_until <= today)));
  const seen = new Set<string>();
  return entries.flatMap(item => {
    const task = byId.get(item.resource_id);
    if (!task || seen.has(task.id) || (item.plan_source !== "manual" && !taskScheduledForDate(task, today))) return [];
    seen.add(task.id);
    return [task];
  });
}
