"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { TaskQueueRow } from "@/components/tasks/TaskQueueRow";
import type { Task } from "@/lib/types";

type Tone = "overdue" | "soon" | "upcoming" | "neutral" | "urgent" | "semi" | "calm" | "waiting" | "blocked";

export function TaskQueueSection({
  title,
  description,
  tasks,
  tone = "neutral",
  defaultOpen = false,
  previewLimit,
  completed = false,
  onChanged,
  onEdit
}: {
  title: string;
  description: string;
  tasks: Task[];
  tone?: Tone;
  defaultOpen?: boolean;
  previewLimit?: number;
  completed?: boolean;
  onChanged: () => void;
  onEdit: (task: Task) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [showAll, setShowAll] = useState(false);
  const visibleTasks = previewLimit && !showAll ? tasks.slice(0, previewLimit) : tasks;

  return (
    <section className={`task-queue-section task-queue-section-${tone}`}>
      <button
        type="button"
        className="flex min-h-14 w-full items-center justify-between gap-3 px-4 py-3 text-left sm:px-5"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
      >
        <span className="min-w-0">
          <span className="flex items-center gap-2">
            {tone === "overdue" && tasks.length ? <span className="overdue-pulse-dot" aria-hidden="true" /> : null}
            <span className="block font-extrabold text-slate-950">{title}</span>
          </span>
          <span className="mt-0.5 block text-xs font-semibold text-slate-600">{description}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <span className="rounded-full bg-white/80 px-2.5 py-1 text-xs font-extrabold text-slate-700 ring-1 ring-slate-200">{tasks.length}</span>
          {open ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
        </span>
      </button>
      {open ? (
        <div className="border-t border-black/5 px-3 py-3 sm:px-4">
          {tasks.length ? (
            <div className="grid gap-2 [content-visibility:auto]">
              {visibleTasks.map((task) => <TaskQueueRow key={task.id} task={task} tone={tone} completed={completed} onChanged={onChanged} onEdit={onEdit} />)}
            </div>
          ) : <p className="px-2 py-3 text-sm font-semibold text-slate-500">暫時沒有項目。</p>}
          {previewLimit && tasks.length > previewLimit ? (
            <button
              type="button"
              className="mt-3 min-h-11 w-full rounded-xl bg-white/80 px-3 text-sm font-extrabold text-indigo-700 ring-1 ring-slate-200 hover:bg-white"
              onClick={() => setShowAll((current) => !current)}
            >
              {showAll ? `收起，只顯示首 ${previewLimit} 項` : `顯示全部（共 ${tasks.length} 項）`}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
