"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarClock, Check, Pencil } from "lucide-react";
import { controlAction } from "@/lib/control-api";
import { formatDate } from "@/lib/date";
import { undatedUrgencyFor } from "@/lib/task-queue";
import type { Task } from "@/lib/types";

type Tone = "overdue" | "soon" | "upcoming" | "neutral" | "urgent" | "semi" | "calm" | "waiting" | "blocked";

export function TaskQueueRow({
  task,
  tone = "neutral",
  completed = false,
  onChanged,
  onEdit
}: {
  task: Task;
  tone?: Tone;
  completed?: boolean;
  onChanged: () => void;
  onEdit: (task: Task) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const urgency = !task.due_date ? undatedUrgencyFor(task) : null;

  async function complete() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await controlAction("update_task", {
        id: task.id,
        changes: { status: "done", completed_at: new Date().toISOString() }
      });
      onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "未能完成任務。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className={`task-queue-row task-queue-row-${tone}`}>
      {completed ? (
        <span className="task-complete-button bg-slate-100 text-slate-500 no-print" aria-hidden="true"><Check className="h-4 w-4" /></span>
      ) : (
        <button
          type="button"
          className="task-complete-button no-print"
          onClick={() => void complete()}
          disabled={busy}
          aria-label={`完成任務：${task.title}`}
        >
          {busy ? <span className="h-2 w-2 animate-pulse rounded-full bg-current" /> : <Check className="h-4 w-4" />}
        </button>
      )}
      <div className="min-w-0 flex-1">
        <Link className="block font-bold leading-6 text-slate-950 hover:text-indigo-700 hover:underline" href={`/tasks/${task.id}`}>
          {task.title}
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-semibold text-slate-600">
          {task.due_date ? (
            <span className="inline-flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" />{formatDate(task.due_date)}</span>
          ) : urgency ? (
            <span>{urgency === "urgent" ? "Urgent" : urgency === "semi_urgent" ? "Semi-urgent" : "Non-urgent"}</span>
          ) : null}
          {task.status === "in_progress" ? <span className="text-indigo-700">進行中</span> : null}
          {completed ? <span>{task.status === "cancelled" ? "已取消" : "已完成"}</span> : null}
          {task.next_action ? <span className="hidden truncate sm:inline">下一步：{task.next_action}</span> : null}
        </div>
        {error ? <p className="mt-1 text-xs font-semibold text-rose-700" role="alert">{error}</p> : null}
      </div>
      <button type="button" className="icon-button no-print" onClick={() => onEdit(task)} aria-label={`修改任務：${task.title}`}>
        <Pencil className="h-4 w-4" />
      </button>
    </article>
  );
}
