import Link from "next/link";
import { ArrowRight, CalendarClock } from "lucide-react";
import { daylineDate } from "@/lib/dayline";
import { overdueTaskDays } from "@/lib/overdue-tasks";
import type { Task } from "@/lib/types";

const previewLimit = 3;

function pendingState(task: Task) {
  if (task.status === "blocked" || task.blocked_reason?.trim()) return "等解除阻塞";
  if (task.status === "waiting" || task.current_step_status === "waiting") return "等候回覆";
  return null;
}

export function OverdueTasks({ tasks, today, onShowAll }: {
  tasks: readonly Task[];
  today: string;
  onShowAll: () => void;
}) {
  // Ownership and order are supplied by the Dashboard. This view only
  // guards date/status so a fresh update never displays a finished task.
  const overdue = tasks.flatMap(task => {
    const days = overdueTaskDays(task, today);
    return days !== null && task.due_date ? [{ task, days, dueDate: task.due_date }] : [];
  });
  if (!overdue.length) return null;

  return <section className="dl-overdue-banner" aria-labelledby="dl-overdue-heading">
    <header className="dl-overdue-header">
      <div className="dl-overdue-title">
        <CalendarClock aria-hidden="true" />
        <h2 id="dl-overdue-heading">已過期</h2>
        <span className="dl-overdue-count">{overdue.length} 項</span>
        <span className="dl-overdue-action">必須立即處理</span>
      </div>
      {overdue.length > previewLimit ? <button type="button" className="dl-overdue-more" onClick={onShowAll}>
        查看所有已過期任務 <ArrowRight aria-hidden="true" />
      </button> : null}
    </header>
    <ul className="dl-overdue-list">
      {overdue.slice(0, previewLimit).map(({ task, days, dueDate }) => {
        const state = pendingState(task);
        return <li key={task.id}>
          <Link className="dl-overdue-row" href={`/tasks/${encodeURIComponent(task.id)}`}>
            <strong>{task.title}</strong>
            <span className="dl-overdue-meta">
              <span>限期 <time dateTime={dueDate}>{daylineDate(dueDate, dueDate.slice(0, 4) !== today.slice(0, 4))}</time></span>
              {state ? <span className="dl-overdue-state">{state}</span> : null}
              <span className="dl-overdue-delay">過期 {days} 日</span>
            </span>
          </Link>
        </li>;
      })}
    </ul>
  </section>;
}
