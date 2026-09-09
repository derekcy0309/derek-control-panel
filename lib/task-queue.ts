import type { Task } from "./types.ts";

export type UndatedUrgency = "urgent" | "semi_urgent" | "non_urgent";

export type TaskQueueBuckets = {
  overdue: Task[];
  dueWithin7Days: Task[];
  dueWithin14Days: Task[];
  dueLater: Task[];
  urgent: Task[];
  semiUrgent: Task[];
  nonUrgent: Task[];
  waiting: Task[];
  blocked: Task[];
  completed: Task[];
};

export function undatedUrgencyFor(task: Pick<Task, "requested_priority">): UndatedUrgency {
  const priority = task.requested_priority ?? 3;
  if (priority <= 2) return "urgent";
  if (priority <= 4) return "semi_urgent";
  return "non_urgent";
}

export function taskQueueBuckets(tasks: Task[], today: string): TaskQueueBuckets {
  const day7 = shiftIsoDate(today, 7);
  const day14 = shiftIsoDate(today, 14);
  const buckets: TaskQueueBuckets = {
    overdue: [],
    dueWithin7Days: [],
    dueWithin14Days: [],
    dueLater: [],
    urgent: [],
    semiUrgent: [],
    nonUrgent: [],
    waiting: [],
    blocked: [],
    completed: []
  };

  for (const task of tasks) {
    if (task.status === "done" || task.status === "cancelled") {
      buckets.completed.push(task);
      continue;
    }
    if (task.status === "waiting") {
      buckets.waiting.push(task);
      continue;
    }
    if (task.status === "blocked") {
      buckets.blocked.push(task);
      continue;
    }
    if (task.due_date) {
      if (task.due_date < today) buckets.overdue.push(task);
      else if (task.due_date <= day7) buckets.dueWithin7Days.push(task);
      else if (task.due_date <= day14) buckets.dueWithin14Days.push(task);
      else buckets.dueLater.push(task);
      continue;
    }

    const urgency = undatedUrgencyFor(task);
    if (urgency === "urgent") buckets.urgent.push(task);
    else if (urgency === "semi_urgent") buckets.semiUrgent.push(task);
    else buckets.nonUrgent.push(task);
  }

  buckets.overdue.sort(compareDatedTasks);
  buckets.dueWithin7Days.sort(compareDatedTasks);
  buckets.dueWithin14Days.sort(compareDatedTasks);
  buckets.dueLater.sort(compareDatedTasks);
  buckets.urgent.sort(compareUndatedTasks);
  buckets.semiUrgent.sort(compareUndatedTasks);
  buckets.nonUrgent.sort(compareUndatedTasks);
  buckets.waiting.sort(compareFollowUpTasks);
  buckets.blocked.sort(compareUndatedTasks);
  buckets.completed.sort((left, right) => (right.completed_at ?? right.updated_at).localeCompare(left.completed_at ?? left.updated_at));
  return buckets;
}

function compareDatedTasks(left: Task, right: Task) {
  return progressRank(left) - progressRank(right)
    || (left.due_date ?? "9999-12-31").localeCompare(right.due_date ?? "9999-12-31")
    || priority(left) - priority(right)
    || left.created_at.localeCompare(right.created_at);
}

function compareUndatedTasks(left: Task, right: Task) {
  return progressRank(left) - progressRank(right)
    || impactRank(right) - impactRank(left)
    || priority(left) - priority(right)
    || (left.last_progress_at ?? left.created_at).localeCompare(right.last_progress_at ?? right.created_at)
    || left.created_at.localeCompare(right.created_at);
}

function compareFollowUpTasks(left: Task, right: Task) {
  return (left.follow_up_date ?? left.due_date ?? "9999-12-31").localeCompare(right.follow_up_date ?? right.due_date ?? "9999-12-31")
    || compareUndatedTasks(left, right);
}

function progressRank(task: Task) {
  return task.status === "in_progress" ? 0 : 1;
}

function priority(task: Task) {
  return task.requested_priority ?? 3;
}

function impactRank(task: Task) {
  return Number(Boolean(task.safety_impact)) * 5
    + Number(Boolean(task.legal_impact)) * 4
    + Number(Boolean(task.child_impact)) * 3
    + Number(Boolean(task.critical_path)) * 2
    + Number((task.revenue_impact ?? 0) > 0);
}

function shiftIsoDate(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
