"use client";

import { useState } from "react";
import { CalendarClock, FilePenLine, Link2, Unlink } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { TaskHandoffControls } from "@/components/items/TaskHandoffControls";
import { RiskBadge, ScopeBadge, StatusBadge } from "@/components/ui/Badge";
import { formatDate, addDaysIso } from "@/lib/date";
import { sourceTypeLabels } from "@/lib/labels";
import { controlAction } from "@/lib/control-api";
import type { Assignment, HandoffNote, Task, TaskDependency } from "@/lib/types";

export function TaskCard({
  task,
  onChanged,
  onEdit,
  currentUserId,
  participants,
  assignments,
  handoffNotes,
  allTasks,
  taskDependencies,
  prominent = false
}: {
  task: Task;
  onChanged: () => void;
  onEdit?: (task: Task) => void;
  currentUserId: string;
  participants: Array<{ user_id: string; display_name: string }>;
  assignments: Assignment[];
  handoffNotes: HandoffNote[];
  allTasks: Task[];
  taskDependencies: TaskDependency[];
  prominent?: boolean;
}) {
  const activeHandoff = assignments.some((item) =>
    item.resource_type === "task"
    && item.resource_id === task.id
    && ["pending_acceptance","accepted","in_progress","waiting","blocked"].includes(item.status)
  );
  const incomingDependencies = taskDependencies.filter((item) => item.task_id === task.id);
  const blockedTasks = taskDependencies.filter((item) => item.depends_on_task_id === task.id);
  async function updateTask(values: Partial<Task>) {
    await controlAction("update_task", { id: task.id, changes: values });
    onChanged();
  }

  async function completeTask() {
    await updateTask({ status: "done", completed_at: new Date().toISOString() });
  }

  async function delay(days?: number) {
    const nextDate = days ? addDaysIso(days) : window.prompt("請輸入延後日期，例如 2026-07-01");
    if (!nextDate) return;
    await updateTask({ follow_up_date: nextDate });
  }

  return (
    <article className={prominent ? "rounded-2xl border-2 border-indigo-200 bg-white p-5 shadow-soft" : "panel-soft p-4"}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap gap-2">
            <ScopeBadge scope={task.scope} />
            <StatusBadge status={task.status} />
            <RiskBadge risk={task.risk} />
          </div>
          <h3 className="mt-3 text-xl font-bold text-ink">{task.title}</h3>
          <p className="mt-2 text-base font-semibold text-slate-600">{sourceTypeLabels[task.source_type]}</p>
        </div>
        {onEdit ? (
          <Button variant="secondary" onClick={() => onEdit(task)} title="修改">
            <FilePenLine className="h-5 w-5" />
            修改
          </Button>
        ) : null}
      </div>
      <TaskHandoffControls
        task={task}
        currentUserId={currentUserId}
        participants={participants}
        assignments={assignments}
        notes={handoffNotes}
        onChanged={onChanged}
      />
      <TaskDependencyPanel
        task={task}
        dependencies={incomingDependencies}
        blockedTasks={blockedTasks}
        allTasks={allTasks}
        currentUserId={currentUserId}
        onChanged={onChanged}
      />
      <div className="mt-4 grid gap-3 text-base text-slate-700 sm:grid-cols-2">
        <p className="flex items-center gap-2">
          <CalendarClock className="h-5 w-5 text-indigo-600" />
          到期：{formatDate(task.due_date)}
        </p>
        <p>跟進：{formatDate(task.follow_up_date)}</p>
        {task.completed_at ? <p>完成日期及時間：{formatDateTime(task.completed_at)}</p> : null}
        <p className="sm:col-span-2">
          <span className="font-semibold">下一步：</span>
          {task.next_action || "未設定"}
        </p>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {!activeHandoff ? <Button variant="success" onClick={completeTask}>完全完成任務</Button> : null}
        <Button variant="secondary" onClick={() => delay(1)}>
          延後 1 日
        </Button>
        <Button variant="secondary" onClick={() => delay(3)}>
          延後 3 日
        </Button>
        <Button variant="secondary" onClick={() => delay(7)}>
          延後 7 日
        </Button>
        <Button variant="secondary" onClick={() => delay()}>
          自訂日期
        </Button>
        <Button variant="danger" onClick={() => updateTask({ status: "blocked" })}>
          有問題
        </Button>
        <Button variant="ghost" onClick={() => updateTask({ status: "cancelled" })}>
          取消
        </Button>
        <Button variant="danger" onClick={() => window.confirm("任務會移到保留區，30 日後才永久刪除。確定？") && updateTask({ deleted_at: new Date().toISOString() })}>
          刪除
        </Button>
      </div>
    </article>
  );
}

function TaskDependencyPanel({
  task,
  dependencies,
  blockedTasks,
  allTasks,
  currentUserId,
  onChanged
}: {
  task: Task;
  dependencies: TaskDependency[];
  blockedTasks: TaskDependency[];
  allTasks: Task[];
  currentUserId: string;
  onChanged: () => void;
}) {
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const taskById = new Map(allTasks.map((item) => [item.id, item]));
  const ownerCanManage = (task.owner_id ?? task.user_id) === currentUserId;
  const availableTasks = allTasks.filter((item) =>
    item.id !== task.id
    && item.status !== "done"
    && !dependencies.some((dependency) => dependency.depends_on_task_id === item.id)
  );

  async function addDependency() {
    if (!selectedTaskId) return;
    setBusy(true);
    setError("");
    try {
      await controlAction("create_task_dependency", { taskId: task.id, dependsOnTaskId: selectedTaskId });
      setSelectedTaskId("");
      onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "未能新增依賴關係。請稍後再試。");
    } finally {
      setBusy(false);
    }
  }

  async function removeDependency(id: string) {
    setBusy(true);
    setError("");
    try {
      await controlAction("remove_task_dependency", { id });
      onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "未能移除依賴關係。請稍後再試。");
    } finally {
      setBusy(false);
    }
  }

  if (!dependencies.length && !blockedTasks.length && !ownerCanManage) return null;

  return (
    <section className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3" aria-label="任務依賴關係">
      <div className="flex items-center gap-2">
        <Link2 className="h-4 w-4 text-indigo-600" />
        <h4 className="text-sm font-extrabold text-slate-900">前後關係</h4>
      </div>
      {dependencies.length ? (
        <div className="mt-3 space-y-2">
          <p className="text-xs font-bold text-slate-600">此任務要先等：</p>
          {dependencies.map((dependency) => {
            const prerequisite = taskById.get(dependency.depends_on_task_id);
            const complete = prerequisite?.status === "done";
            return (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white px-3 py-2 text-sm" key={dependency.id}>
                <span className={complete ? "text-emerald-700" : "font-semibold text-amber-800"}>
                  {complete ? "已完成：" : "尚待："}{prerequisite?.title ?? "你沒有查看此任務的權限"}
                </span>
                {ownerCanManage ? <Button type="button" variant="ghost" disabled={busy} onClick={() => void removeDependency(dependency.id)}><Unlink className="h-4 w-4" />移除</Button> : null}
              </div>
            );
          })}
        </div>
      ) : null}
      {blockedTasks.length ? (
        <p className="mt-3 text-xs leading-5 text-slate-600">
          完成這一步後，可檢視 {blockedTasks.length} 項下一步工作；系統只會提示，不會自動變更它們。
        </p>
      ) : null}
      {ownerCanManage ? (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <select className="field min-w-0 flex-1 bg-white" value={selectedTaskId} onChange={(event) => setSelectedTaskId(event.target.value)} aria-label="選擇前置任務">
            <option value="">加入需要先完成的任務…</option>
            {availableTasks.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.title}</option>)}
          </select>
          <Button type="button" variant="secondary" disabled={busy || !selectedTaskId} onClick={() => void addDependency()}>
            {busy ? "處理中…" : "加入依賴"}
          </Button>
        </div>
      ) : null}
      {error ? <p className="mt-2 rounded-lg bg-amber-50 p-2 text-xs font-semibold text-amber-900" role="alert">{error}</p> : null}
    </section>
  );
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("zh-HK", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}
