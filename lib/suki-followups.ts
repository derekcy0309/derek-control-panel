import type { Task } from "@/lib/types";

export type SukiFollowupCategory = "waiting" | "due_soon" | "rearrange" | "overdue";

export const sukiFollowupCategoryLabels: Record<SukiFollowupCategory, string> = {
  waiting: "等待別人",
  due_soon: "接近期限",
  rearrange: "需要重新安排",
  overdue: "需要重新安排"
};

export type SukiFollowupItem = {
  task: Task;
  categories: SukiFollowupCategory[];
  effectiveDate: string | null;
};

export function buildSukiFollowupSummary(tasks: Task[], today = hongKongDate()) {
  const items = tasks
    .filter((task) => !task.deleted_at && !task.archived_at && !["done", "cancelled"].includes(task.status))
    .map((task) => ({
      task,
      categories: taskFollowupCategories(task, today),
      effectiveDate: earliestDate(task.due_date, task.follow_up_date, task.planned_date)
    }))
    .filter((item) => item.categories.length)
    .sort((left, right) => {
      const leftUrgent = left.categories.includes("overdue") ? 0 : 1;
      const rightUrgent = right.categories.includes("overdue") ? 0 : 1;
      return leftUrgent - rightUrgent
        || (left.effectiveDate ?? "9999-12-31").localeCompare(right.effectiveDate ?? "9999-12-31")
        || left.task.title.localeCompare(right.task.title, "zh-HK");
    });
  const counts = Object.fromEntries(
    (Object.keys(sukiFollowupCategoryLabels) as SukiFollowupCategory[])
      .map((category) => [category, items.filter((item) => item.categories.includes(category)).length])
  ) as Record<SukiFollowupCategory, number>;
  return { items, counts, totalTasks: items.length };
}

export function taskFollowupCategories(task: Task, today = hongKongDate()) {
  const categories: SukiFollowupCategory[] = [];
  const effectiveDate = earliestDate(task.due_date, task.follow_up_date, task.planned_date);
  if (effectiveDate && effectiveDate < today) categories.push("overdue");
  if (task.status === "waiting") categories.push("waiting");
  if (task.status === "blocked") categories.push("rearrange");
  if (effectiveDate && effectiveDate >= today && effectiveDate <= addDays(today, 3)) categories.push("due_soon");
  return categories;
}

export function hongKongDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
}

function earliestDate(...values: Array<string | null | undefined>) {
  const dates = values.filter((value): value is string => Boolean(value)).sort();
  return dates[0] ?? null;
}

function addDays(iso: string, days: number) {
  const date = new Date(`${iso}T12:00:00+08:00`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
