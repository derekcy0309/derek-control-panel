"use client";

import { useMemo, useState } from "react";
import { ListChecks } from "lucide-react";
import { controlAction } from "@/lib/control-api";
import type { PlanningMetadata, Task } from "@/lib/types";

export function TodayTaskManager({
  tasks,
  planning,
  today,
  onChanged
}: {
  tasks: Task[];
  planning: PlanningMetadata[];
  today: string;
  onChanged: () => Promise<unknown>;
}) {
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState("");
  const included = useMemo(() => new Set(
    planning.filter((item) => item.resource_type === "task" && item.planned_date === today)
      .map((item) => item.resource_id)
  ), [planning, today]);
  const visible = tasks.filter((task) =>
    !query.trim() || task.title.toLowerCase().includes(query.trim().toLowerCase())
  );

  async function toggle(task: Task, next: boolean) {
    setBusyId(task.id);
    setMessage("");
    try {
      await controlAction("set_today_task", { taskId: task.id, included: next });
      await onChanged();
      setMessage(next ? "已手動加入 Today。" : "已由 Today 移除；任務本身仍然保留。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "未能更新 Today。");
    } finally {
      setBusyId("");
    }
  }

  return (
    <details className="panel p-5">
      <summary className="flex cursor-pointer list-none items-center gap-3">
        <span className="rounded-xl bg-indigo-50 p-2 text-indigo-700"><ListChecks className="h-5 w-5" /></span>
        <span><span className="block font-extrabold text-slate-900">手動加減 Today 任務</span><span className="mt-1 block text-sm text-slate-600">勾選任何任務加入今日；取消勾選只會移出 Today。</span></span>
      </summary>
      <div className="mt-4">
        <input className="field" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜尋任務…" aria-label="搜尋任務" />
        <div className="mt-3 max-h-80 space-y-2 overflow-y-auto">
          {visible.map((task) => (
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-white p-3" key={task.id}>
              <input className="mt-1 h-5 w-5 accent-indigo-600" type="checkbox" checked={included.has(task.id)} disabled={busyId === task.id} onChange={(event) => void toggle(task, event.target.checked)} />
              <span><span className="block font-bold text-slate-900">{task.title}</span><span className="mt-1 block text-xs text-slate-500">{task.due_date ? `限期 ${task.due_date}` : "未設限期"}</span></span>
            </label>
          ))}
          {!visible.length ? <p className="py-5 text-center text-sm text-slate-500">搵唔到符合的未完成任務。</p> : null}
        </div>
        {message ? <p className="mt-3 text-sm font-semibold text-slate-600" role="status">{message}</p> : null}
      </div>
    </details>
  );
}
