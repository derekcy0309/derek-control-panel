import type { Area, Scope, Task } from "@/lib/types";

export type TaskCategory = "personal" | "family" | "sec" | "wecare";

export const taskCategoryOptions: ReadonlyArray<{ value: TaskCategory; label: string }> = [
  { value: "personal", label: "個人" },
  { value: "family", label: "家庭" },
  { value: "sec", label: "SEC" },
  { value: "wecare", label: "Wecare" }
];

export function taskCategoryFor(task: Pick<Task, "area" | "scope">): TaskCategory {
  if (!task.area) return task.scope === "company" ? "wecare" : "family";
  if (task.area === "personal") return "personal";
  if (task.area === "family") return "family";
  return task.scope === "home" ? "sec" : "wecare";
}

export function taskCategoryFields(category: TaskCategory): { area: Area; scope: Scope } {
  switch (category) {
    case "personal": return { area: "personal", scope: "home" };
    case "family": return { area: "family", scope: "home" };
    case "sec": return { area: "work", scope: "home" };
    case "wecare": return { area: "work", scope: "company" };
  }
}

export function taskCategoryValue(value: unknown): TaskCategory | null {
  return typeof value === "string" && ["personal", "family", "sec", "wecare"].includes(value) ? value as TaskCategory : null;
}
