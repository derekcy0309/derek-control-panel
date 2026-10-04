import type { Task, TaskStep } from "@/lib/types";

export function currentTaskStep(steps: TaskStep[]): TaskStep | null {
  return [...steps]
    .filter((step) => step.status !== "done")
    .sort((a, b) => Number(a.status === "later") - Number(b.status === "later") || a.sort_order - b.sort_order)[0] ?? null;
}

export function taskVisibleNextAction(task: Pick<Task, "current_step_title" | "current_step_status" | "next_action">): string | null {
  if (task.current_step_status === "all_done") return "細步驟已做完；確認是否可結案";
  if (task.current_step_title?.trim()) {
    return task.current_step_status === "waiting" ? `等待結果：${task.current_step_title.trim()}` : task.current_step_title.trim();
  }
  return task.next_action?.trim() || null;
}
