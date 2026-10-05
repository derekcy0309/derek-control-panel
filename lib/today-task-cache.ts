import type { Task, TodayData } from "./types.ts";

function upsert(tasks: Task[], task: Task) {
  const index = tasks.findIndex((item) => item.id === task.id);
  if (index < 0) return [task, ...tasks];
  return tasks.map((item, position) => position === index ? {
    ...task,
    current_step_title: task.current_step_title ?? item.current_step_title,
    current_step_status: task.current_step_status ?? item.current_step_status,
    follow_up_date: item.current_step_title ? item.follow_up_date : task.follow_up_date
  } : item);
}

export function withSavedTask(data: TodayData, task: Task): TodayData {
  const visible = !task.deleted_at && !task.archived_at;
  const active = visible && !["done", "cancelled", "blocked", "waiting"].includes(task.status);
  const catalogued = visible && !["done", "cancelled"].includes(task.status);
  const wasInToday = data.tasks.some((item) => item.id === task.id);

  return {
    ...data,
    tasks: active || wasInToday
      ? upsert(data.tasks, task)
      : data.tasks.filter((item) => item.id !== task.id),
    taskCatalog: catalogued
      ? upsert(data.taskCatalog, task)
      : data.taskCatalog.filter((item) => item.id !== task.id),
    taskQueueCatalog: visible
      ? upsert(data.taskQueueCatalog, task)
      : data.taskQueueCatalog.filter((item) => item.id !== task.id)
  };
}
