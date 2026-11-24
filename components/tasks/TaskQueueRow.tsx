"use client";

import { useState, type CSSProperties } from "react";
import Link from "next/link";
import { ArrowRight, CalendarClock, Check, ChevronDown, Leaf, ListPlus, Pencil } from "lucide-react";
import { controlAction } from "@/lib/control-api";
import { formatDate } from "@/lib/date";
import { taskVisibleNextAction } from "@/lib/task-steps";
import type { Task } from "@/lib/types";

type Tone = "overdue" | "soon" | "upcoming" | "neutral" | "urgent" | "semi" | "calm" | "waiting" | "blocked";

export function TaskQueueRow({
  task,
  tagNames,
  tagColors,
  tone = "neutral",
  completed = false,
  inToday = false,
  bulkMode = false,
  selected = false,
  todayBusy = false,
  onChanged,
  onEdit,
  onSelect,
  onAddToday
}: {
  task: Task;
  tagNames: ReadonlyMap<string, string>;
  tagColors: ReadonlyMap<string, CSSProperties>;
  tone?: Tone;
  completed?: boolean;
  inToday?: boolean;
  bulkMode?: boolean;
  selected?: boolean;
  todayBusy?: boolean;
  onChanged: () => void;
  onEdit: (task: Task) => void;
  onSelect?: (task: Task, selected: boolean) => void;
  onAddToday?: (task: Task) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [justCompleted, setJustCompleted] = useState(false);
  const nextAction = taskVisibleNextAction(task);
  const canAddToday = !completed && !["waiting", "blocked", "done", "cancelled"].includes(task.status) && task.current_step_status !== "waiting" && !task.blocked_reason?.trim();

  async function complete() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await controlAction("update_task", {
        id: task.id,
        changes: { status: "done", completed_at: new Date().toISOString() }
      });
      setJustCompleted(true);
      await new Promise((resolve) => window.setTimeout(resolve, 420));
      onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "未能完成任務。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className={`task-queue-row task-queue-row-${tone} dl-queue-task ${justCompleted ? "is-completing" : ""}`}>
      {bulkMode && canAddToday && !inToday ? (
        <label className="no-print grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-lg bg-white ring-1 ring-slate-200" aria-label={`選擇加入今日：${task.title}`}>
          <input type="checkbox" checked={selected} onChange={(event) => onSelect?.(task, event.target.checked)} />
        </label>
      ) : null}
      <details>
        <summary>
          <span className="min-w-0"><strong>{task.title}</strong>
            <span className="dl-queue-meta">
              {task.due_date ? <span className="inline-flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />{formatDate(task.due_date)}</span> : null}
              {(task.personal_tag_ids ?? []).map(id => {
                const label = tagNames.get(id);
                return label ? <span className="task-tag-color min-w-0 max-w-full break-words rounded-full px-2 py-0.5 font-semibold" data-tag-id={id} key={id} style={tagColors.get(id)}>{label}</span> : null;
              })}
              {task.custom_status_label ? <span>{task.custom_status_label}</span> : null}
              {task.status === "in_progress" && !task.custom_status_label ? <span>進行中</span> : null}
              {task.parent_task_id ? <span>子任務</span> : null}
              {completed ? <span>{task.status === "cancelled" ? "已取消" : "已完成"}</span> : null}
              {!completed && inToday ? <span>已在今日</span> : null}
            </span>
          </span>
          <ChevronDown className="dl-queue-arrow h-5 w-5 shrink-0" aria-hidden="true"/>
        </summary>
        <div className="dl-queue-detail">
          {nextAction ? <p className="break-words text-sm text-slate-700">下一步：{nextAction}</p> : null}
          <div className="dl-queue-moves no-print">
          <Link className="inline-flex min-h-11 items-center gap-1 px-1 text-sm font-semibold text-indigo-700 hover:underline" href={`/tasks/${task.id}`} aria-label={task.title}>任務詳情 <ArrowRight className="h-4 w-4" aria-hidden="true"/></Link>
          {!completed ? <button type="button" className="task-complete-button icon-button" onClick={() => void complete()} disabled={busy} aria-label={`完成任務：${task.title}`}><Check className="h-4 w-4" aria-hidden="true" /></button> : null}
        {!completed && canAddToday && !inToday && !bulkMode ? (
          <button
            type="button"
            className="inline-flex min-h-10 shrink-0 items-center gap-1 rounded-lg bg-indigo-50 px-3 text-xs font-extrabold text-indigo-700 hover:bg-indigo-100 disabled:opacity-60"
            disabled={todayBusy}
            onClick={() => onAddToday?.(task)}
            aria-label={`加入今日：${task.title}`}
          >
            <ListPlus className="h-4 w-4" />
            {todayBusy ? "加入中" : "＋今日"}
          </button>
        ) : null}
        <button type="button" className="icon-button" onClick={() => onEdit(task)} aria-label={`修改任務：${task.title}`}>
          <Pencil className="h-4 w-4" />
        </button>
          </div>
          {error ? <p className="mt-1 text-xs font-semibold text-rose-700" role="alert">{error}</p> : null}
        </div>
      </details>
      {justCompleted ? <span className="task-completion-feedback" role="status"><Leaf className="h-4 w-4" />完成一步</span> : null}
    </article>
  );
}
