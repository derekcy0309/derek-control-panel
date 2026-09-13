"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CalendarClock, Check, ListPlus, Play, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { controlAction } from "@/lib/control-api";
import { formatDate } from "@/lib/date";
import type { PlanningMetadata, Task } from "@/lib/types";

const roleOrder = { now: 0, later: 1, quick_win: 2 } as const;
const roleLabel = { now: "現在做", later: "稍後做", quick_win: "Quick Win" } as const;

export function TodayAllTasks({
  tasks,
  planning,
  today,
  onChanged,
  onStart,
  onComplete,
  onBrowseTasks
}: {
  tasks: Task[];
  planning: PlanningMetadata[];
  today: string;
  onChanged: () => Promise<unknown>;
  onStart: (task: Task) => void;
  onComplete: (task: Task) => Promise<void>;
  onBrowseTasks: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const entries = useMemo(() => {
    const byId = new Map(tasks.map((task) => [task.id, task]));
    return planning
      .filter((item) => item.resource_type === "task" && item.planned_date === today && item.plan_role)
      .map((item) => ({ metadata: item, task: byId.get(item.resource_id) }))
      .filter((entry): entry is { metadata: PlanningMetadata & { plan_role: NonNullable<PlanningMetadata["plan_role"]> }; task: Task } => Boolean(entry.task && entry.metadata.plan_role))
      .sort((left, right) => {
        const leftDone = ["done", "cancelled"].includes(left.task.status) ? 1 : 0;
        const rightDone = ["done", "cancelled"].includes(right.task.status) ? 1 : 0;
        return leftDone - rightDone || roleOrder[left.metadata.plan_role] - roleOrder[right.metadata.plan_role];
      });
  }, [planning, tasks, today]);

  async function remove(task: Task) {
    if (busyId) return;
    setBusyId(task.id);
    setError("");
    setMessage("");
    try {
      await controlAction("set_today_task", { taskId: task.id, included: false });
      await onChanged();
      setMessage(`已將「${task.title}」移出今日；原本任務及到期日沒有改動。`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "未能移出今日。");
    } finally {
      setBusyId(null);
    }
  }

  async function complete(task: Task) {
    if (busyId) return;
    setBusyId(task.id);
    setError("");
    try {
      await onComplete(task);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section
      id="action-center-panel-today"
      role="tabpanel"
      aria-labelledby="action-center-tab-today"
      className="space-y-4"
    >
      <div className="section-hero relative overflow-hidden rounded-2xl border border-sky-200 bg-gradient-to-br from-sky-50 via-white to-amber-50 p-5 sm:p-6">
        <div className="relative z-10 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <p className="eyebrow">Today list</p>
            <h2 className="section-title mt-1">今日全部任務</h2>
            <p className="muted mt-2 text-sm">只顯示已確認加入今日的項目；不會同步到 Google Calendar。</p>
          </div>
          <Button onClick={onBrowseTasks}><ListPlus className="h-5 w-5" />由任務總表加入</Button>
        </div>
      </div>

      {message ? <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800" role="status">{message}</p> : null}
      {error ? <p className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-800" role="alert">{error}</p> : null}

      {entries.length ? (
        <div className="grid gap-3">
          {entries.map(({ metadata, task }) => {
            const completed = ["done", "cancelled"].includes(task.status);
            return (
              <article key={task.id} className={`panel flex flex-col gap-4 p-4 sm:flex-row sm:items-center ${completed ? "opacity-65" : ""}`}>
                <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${completed ? "bg-emerald-100 text-emerald-700" : metadata.plan_role === "now" ? "bg-indigo-600 text-white" : "bg-sky-100 text-sky-700"}`}>
                  {completed ? <Check className="h-5 w-5" /> : <span className="text-sm font-black">{metadata.plan_role === "now" ? "1" : "•"}</span>}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-extrabold text-indigo-700">{roleLabel[metadata.plan_role]}</span>
                    {task.due_date ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600"><CalendarClock className="h-3.5 w-3.5" />{formatDate(task.due_date)}</span> : null}
                  </div>
                  <Link href={`/tasks/${task.id}`} className={`mt-2 block font-extrabold leading-6 text-slate-950 hover:text-indigo-700 hover:underline ${completed ? "line-through" : ""}`}>{task.title}</Link>
                  {task.next_action ? <p className="mt-1 text-sm text-slate-600">下一步：{task.next_action}</p> : null}
                </div>
                <div className="no-print flex shrink-0 flex-wrap gap-2">
                  {!completed ? <Button variant="secondary" disabled={busyId === task.id} onClick={() => onStart(task)}><Play className="h-4 w-4" />開始</Button> : null}
                  {!completed ? <Button disabled={busyId === task.id} onClick={() => void complete(task)}><Check className="h-4 w-4" />完成</Button> : null}
                  <Button variant="ghost" disabled={busyId === task.id} onClick={() => void remove(task)}><X className="h-4 w-4" />移出今日</Button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="panel p-8 text-center sm:p-10">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-sky-50 text-sky-700"><ListPlus className="h-6 w-6" /></div>
          <h3 className="mt-4 text-lg font-extrabold text-slate-900">今日清單仍然是空的</h3>
          <p className="muted mx-auto mt-2 max-w-lg text-sm leading-6">到「任務總表」按＋今日，或在「今日重點」確認系統建議。</p>
          <Button className="mt-5" onClick={onBrowseTasks}>前往任務總表</Button>
        </div>
      )}
    </section>
  );
}
