"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, CalendarClock, Check, ListPlus, Play, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { controlAction } from "@/lib/control-api";
import { formatDate } from "@/lib/date";
import { taskVisibleNextAction } from "@/lib/task-steps";
import { orderTodayPlan } from "@/lib/today-plan-order";
import { taskScheduledForDate } from "@/lib/task-work-schedule";
import { todayPickMatches } from "@/lib/today-pick-list";
import type { PlanningMetadata, Task } from "@/lib/types";

const roleLabel = { now: "現在做", later: "稍後做", quick_win: "Quick Win" } as const;

export function TodayAllTasks({
  tasks,
  availableTasks,
  planning,
  today,
  onChanged,
  onStart,
  onComplete,
  onBrowseTasks
}: {
  tasks: Task[];
  availableTasks: Task[];
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
  const [showPicker, setShowPicker] = useState(false);
  const [query, setQuery] = useState("");
  const includedIds = useMemo(() => new Set(planning
    .filter((item) => item.resource_type === "task" && item.planned_date === today)
    .map((item) => item.resource_id)), [planning, today]);
  const matches = useMemo(() => todayPickMatches(availableTasks, includedIds, query), [availableTasks, includedIds, query]);
  const entries = useMemo(() => {
    const byId = new Map(tasks.map((task) => [task.id, task]));
    return orderTodayPlan(planning
      .filter((item) => item.resource_type === "task" && item.planned_date === today && item.plan_role)
      .map((item) => ({ metadata: item, task: byId.get(item.resource_id) }))
      .filter((entry): entry is { metadata: PlanningMetadata & { plan_role: NonNullable<PlanningMetadata["plan_role"]> }; task: Task } => Boolean(entry.task && entry.metadata.plan_role && (entry.metadata.plan_source === "manual" || taskScheduledForDate(entry.task, today))))
      .map((entry) => ({ ...entry, plan_role: entry.metadata.plan_role, plan_position: entry.metadata.plan_position, plan_source: entry.metadata.plan_source, resource_id: entry.metadata.resource_id })))
      .sort((left, right) => {
        const leftDone = ["done", "cancelled"].includes(left.task.status) ? 1 : 0;
        const rightDone = ["done", "cancelled"].includes(right.task.status) ? 1 : 0;
        return leftDone - rightDone;
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

  async function add(task: Task) {
    if (busyId) return;
    setBusyId(task.id);
    setError("");
    setMessage("");
    try {
      await controlAction("set_today_task", { taskId: task.id, included: true });
      await onChanged();
      setMessage(`已將「${task.title}」加入今日。`);
      setQuery("");
      setShowPicker(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "未能加入今日，請再試一次。");
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

  async function move(taskId: string, direction: -1 | 1) {
    if (busyId) return;
    const active = entries.filter((entry) => !["done", "cancelled"].includes(entry.task.status));
    const index = active.findIndex((entry) => entry.task.id === taskId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= active.length) return;
    const ids = active.map((entry) => entry.task.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    setBusyId(taskId);
    setError("");
    setMessage("");
    try {
      await controlAction("reorder_today_tasks", { taskIds: ids });
      await onChanged();
      setMessage("今日任務已按你揀的次序排列。第一項會成為「現在做」。");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "未能更改次序；原本排列仍然保留。");
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
            <p className="muted mt-2 text-sm">由任務總表手動加入，再用上下按鈕自己排次序；第一項會顯示為「現在做」。不會同步到 Google Calendar。</p>
          </div>
          <Button onClick={() => setShowPicker((value) => !value)}><ListPlus className="h-5 w-5" />加入現有任務</Button>
        </div>
      </div>

      {message ? <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800" role="status">{message}</p> : null}
      {error ? <p className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-800" role="alert">{error}</p> : null}
      {showPicker ? <section className="panel space-y-3 p-4" aria-label="加入今日任務">
        <label className="block font-bold text-slate-900">搜尋要加入今日的任務
          <input className="field mt-2" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="輸入任務名稱" autoFocus />
        </label>
        <div className="space-y-2">
          {matches.map((task) => <div key={task.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3">
            <span className="min-w-0 font-semibold text-slate-900">{task.title}</span>
            <Button type="button" variant="secondary" disabled={Boolean(busyId)} onClick={() => void add(task)}>{busyId === task.id ? "加入中…" : "＋今日"}</Button>
          </div>)}
          {!matches.length ? <p className="py-3 text-sm text-slate-600">沒有符合的可處理任務；等待及阻塞中的任務不會加入今日。</p> : null}
        </div>
        {matches.length === 8 ? <p className="text-xs text-slate-500">只顯示首 8 項；輸入名稱可找其他任務。</p> : null}
        <Button type="button" variant="ghost" onClick={onBrowseTasks}>查看任務總表</Button>
      </section> : null}

      {entries.length ? (
        <div className="grid gap-3">
          {entries.map(({ metadata, task }, index) => {
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
                  {taskVisibleNextAction(task) ? <p className="mt-1 text-sm text-slate-600">下一步：{taskVisibleNextAction(task)}</p> : null}
                </div>
                <div className="no-print flex shrink-0 flex-wrap gap-2">
                  {!completed ? <button type="button" className="min-h-11 rounded-lg bg-slate-50 px-3 font-bold text-slate-700 disabled:opacity-40" disabled={Boolean(busyId) || index === 0} onClick={() => void move(task.id, -1)} aria-label={`將${task.title}移前`}><ArrowUp className="h-4 w-4" /></button> : null}
                  {!completed ? <button type="button" className="min-h-11 rounded-lg bg-slate-50 px-3 font-bold text-slate-700 disabled:opacity-40" disabled={Boolean(busyId) || index === entries.filter((entry) => !["done", "cancelled"].includes(entry.task.status)).length - 1} onClick={() => void move(task.id, 1)} aria-label={`將${task.title}移後`}><ArrowDown className="h-4 w-4" /></button> : null}
                  {!completed && task.current_step_status !== "waiting" ? <Button variant="secondary" disabled={busyId === task.id} onClick={() => onStart(task)}><Play className="h-4 w-4" />開始</Button> : null}
                  {!completed && task.current_step_status === "waiting" ? <Link className="inline-flex min-h-11 items-center rounded-lg bg-slate-50 px-4 font-semibold text-slate-700" href={`/tasks/${task.id}`}>查看等待進度</Link> : null}
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
          <p className="muted mx-auto mt-2 max-w-lg text-sm leading-6">可以直接搜尋並加入現有任務，或在「今日重點」確認系統建議。</p>
          <Button className="mt-5" onClick={() => setShowPicker(true)}>加入現有任務</Button>
        </div>
      )}
    </section>
  );
}
