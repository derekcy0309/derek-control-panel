"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { CalendarClock, ChevronDown, FilePenLine, Link2, Unlink } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { TaskHandoffControls } from "@/components/items/TaskHandoffControls";
import { TaskAIAnalysisPanel } from "@/components/TaskAIAnalysisPanel";
import { TaskCheckpointNotesPanel } from "@/components/TaskCheckpointNotesPanel";
import { TaskResourcePack } from "@/components/TaskResourcePack";
import { RiskBadge, ScopeBadge, StatusBadge } from "@/components/ui/Badge";
import { formatDate, addDaysIso } from "@/lib/date";
import { sourceTypeLabels } from "@/lib/labels";
import { controlAction } from "@/lib/control-api";
import type { Assignment, HandoffNote, OperatingItem, Task, TaskDependency, TaskRecurrenceRule } from "@/lib/types";

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
  taskRecurrenceRules,
  operatingItems = [],
  prominent = false,
  detailLink = true
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
  taskRecurrenceRules: TaskRecurrenceRule[];
  operatingItems?: Array<Pick<OperatingItem, "id" | "title" | "item_type">>;
  prominent?: boolean;
  detailLink?: boolean;
}) {
  const detailsId = useId();
  const [expanded, setExpanded] = useState(prominent);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const activeHandoff = assignments.some((item) =>
    item.resource_type === "task"
    && item.resource_id === task.id
    && ["pending_acceptance","accepted","in_progress","waiting","blocked"].includes(item.status)
  );
  const incomingDependencies = taskDependencies.filter((item) => item.task_id === task.id);
  const blockedTasks = taskDependencies.filter((item) => item.depends_on_task_id === task.id);
  const recurrenceRule = task.recurrence_rule_id
    ? taskRecurrenceRules.find((rule) => rule.id === task.recurrence_rule_id) ?? null
    : null;
  const isOngoingRecurrence = Boolean(recurrenceRule?.is_active);
  async function updateTask(values: Partial<Task>) {
    if (actionBusy) return false;
    setActionBusy(true);
    setActionError("");
    try {
      await controlAction("update_task", { id: task.id, changes: values });
      onChanged();
      return true;
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "未能更新任務，請再試一次。");
      return false;
    } finally {
      setActionBusy(false);
    }
  }

  async function completeTask() {
    await updateTask({ status: "done", completed_at: new Date().toISOString() });
  }

  async function confirmDecision() {
    if (actionBusy) return;
    setActionBusy(true);
    setActionError("");
    try {
      await controlAction("resolve_task_decision", { taskId: task.id });
      onChanged();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "未能確認這項決定。");
    } finally {
      setActionBusy(false);
    }
  }

  async function delay(days?: number) {
    const nextDate = days ? addDaysIso(days) : window.prompt("請輸入延後日期，例如 2026-07-01");
    if (!nextDate) return;
    await updateTask({ follow_up_date: nextDate });
  }

  async function splitIntoSmallTask() {
    const nextAction = window.prompt("輸入一個 5–25 分鐘可以開始的最小步驟");
    if (!nextAction?.trim() || actionBusy) return;
    setActionBusy(true);
    setActionError("");
    try {
      await controlAction("create_task", {
        clientRequestId: crypto.randomUUID(),
        area: task.area ?? (task.scope === "company" ? "work" : "personal"),
        sourceType: task.source_type,
        title: `${task.title}：${nextAction.trim().slice(0, 60)}`,
        description: `由原有工作「${task.title}」拆出。`,
        nextAction: nextAction.trim(),
        dueDate: task.due_date,
        status: "not_started",
        risk: "low",
        projectId: task.project_id ?? null
      });
      onChanged();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "未能拆出小任務，原有工作沒有改動。");
    } finally {
      setActionBusy(false);
    }
  }

  return (
    <article className={prominent ? "overflow-hidden rounded-2xl border-2 border-indigo-200 bg-white shadow-soft" : "panel-soft overflow-hidden"}>
      <button
        type="button"
        className={`flex min-h-24 w-full items-start justify-between gap-4 p-4 text-left transition hover:bg-slate-50 ${prominent ? "sm:p-5" : ""}`}
        aria-expanded={expanded}
        aria-controls={detailsId}
        onClick={() => setExpanded((current) => !current)}
      >
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap gap-2">
            <ScopeBadge scope={task.scope} />
            <StatusBadge status={task.status} />
            <RiskBadge risk={task.risk} />
            {isOngoingRecurrence ? <span className="rounded-full bg-indigo-100 px-2.5 py-1 text-xs font-bold text-indigo-800">恆常工作</span> : null}
          </span>
          <span className="mt-3 block text-xl font-bold text-ink">{task.title}</span>
          <span className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm font-semibold text-slate-600">
            <span className="inline-flex items-center gap-2">
              <CalendarClock className="h-4 w-4 text-indigo-600" />
              到期：{formatDate(task.due_date)}
            </span>
            {task.follow_up_date ? <span>跟進：{formatDate(task.follow_up_date)}</span> : null}
          </span>
        </span>
        <span className="inline-flex shrink-0 items-center gap-1 pt-1 text-sm font-bold text-indigo-700">
          <span className="hidden sm:inline">{expanded ? "收起詳情" : "展開詳情"}</span>
          <ChevronDown className={`h-5 w-5 transition-transform ${expanded ? "rotate-180" : ""}`} aria-hidden="true" />
        </span>
      </button>
      {expanded ? (
        <div id={detailsId} className={`border-t border-slate-200 p-4 ${prominent ? "sm:p-5" : ""}`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-base font-semibold text-slate-600">{sourceTypeLabels[task.source_type]}</p>
            <div className="flex flex-wrap gap-2">
          {detailLink ? <Link className="inline-flex min-h-11 items-center justify-center rounded-lg bg-white px-4 py-2 font-semibold text-slate-800 ring-1 ring-slate-200 hover:bg-slate-50" href={`/tasks/${task.id}`}>查看詳情</Link> : null}
          {onEdit ? (
            <Button variant="secondary" onClick={() => onEdit(task)} title="修改">
              <FilePenLine className="h-5 w-5" />
              修改
            </Button>
          ) : null}
            </div>
          </div>
      <TaskHandoffControls
        task={task}
        currentUserId={currentUserId}
        participants={participants}
        assignments={assignments}
        notes={handoffNotes}
        onChanged={onChanged}
      />
      {!["done", "cancelled"].includes(task.status) ? (
        <TaskAIAnalysisPanel task={task} currentUserId={currentUserId} onChanged={onChanged} />
      ) : null}
      <TaskDependencyPanel
        task={task}
        dependencies={incomingDependencies}
        blockedTasks={blockedTasks}
        allTasks={allTasks}
        currentUserId={currentUserId}
        onChanged={onChanged}
      />
      <TaskRecurrencePanel
        task={task}
        rule={recurrenceRule}
        currentUserId={currentUserId}
        onChanged={onChanged}
      />
      <TaskResourcePack taskId={task.id} currentUserId={currentUserId} availableItems={operatingItems} editable />
      <TaskCheckpointNotesPanel taskId={task.id} participants={participants} />
      {task.description || task.notes || task.definition_of_done ? (
        <section className="mt-4 grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4" aria-label="任務背景與完成條件">
          {task.description ? <div><h4 className="text-sm font-extrabold text-slate-900">背景及原始交接內容</h4><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-700">{task.description}</p></div> : null}
          {task.definition_of_done ? <div><h4 className="text-sm font-extrabold text-slate-900">完成條件</h4><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-700">{task.definition_of_done}</p></div> : null}
          {task.notes ? <div><h4 className="text-sm font-extrabold text-slate-900">備註</h4><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-700">{task.notes}</p></div> : null}
        </section>
      ) : null}
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
        {task.status === "waiting" && task.waiting_for ? <p><span className="font-semibold">等待誰：</span>{task.waiting_for}</p> : null}
        {task.status === "waiting" && task.waiting_on ? <p><span className="font-semibold">等待甚麼：</span>{task.waiting_on}</p> : null}
      </div>
      {task.needs_decision_from_id && !task.decision_resolved_at ? (
        <div className="mt-4 flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div><p className="font-extrabold text-amber-950">等待指定人員決定／確認</p><p className="mt-1 text-sm text-amber-900">系統只會記錄確認，不會自行更改或完成任務。</p></div>
          {task.needs_decision_from_id === currentUserId ? <Button disabled={actionBusy} onClick={() => void confirmDecision()}>確認已決定</Button> : null}
        </div>
      ) : task.decision_resolved_at ? <p className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-900">這項決定已由指定人員確認。</p> : null}
      <div className="mt-4 flex flex-wrap gap-2">
        {!activeHandoff ? <Button variant="success" onClick={() => void completeTask()} disabled={actionBusy}>{actionBusy ? "正在交差…" : isOngoingRecurrence ? "今次已完成" : "完成任務"}</Button> : null}
        <Button variant="secondary" onClick={() => void delay(1)} disabled={actionBusy}>
          稍後處理（明日）
        </Button>
        <Button variant="secondary" onClick={() => void delay(3)} disabled={actionBusy}>
          延後 3 日
        </Button>
        <Button variant="secondary" onClick={() => void delay(7)} disabled={actionBusy}>
          下星期處理
        </Button>
        <Button variant="secondary" onClick={() => void delay()} disabled={actionBusy}>
          重新安排
        </Button>
        <Button variant="secondary" onClick={() => void splitIntoSmallTask()} disabled={actionBusy}>
          拆成小任務
        </Button>
        <Button variant="secondary" onClick={() => void updateTask({ status: "blocked" })} disabled={actionBusy}>
          需要重新安排
        </Button>
        <Button variant="ghost" onClick={() => void updateTask({ status: "cancelled" })} disabled={actionBusy}>
          取消
        </Button>
        <Button variant="danger" onClick={() => { if (window.confirm("任務會移到保留區，30 日後才永久刪除。確定？")) void updateTask({ deleted_at: new Date().toISOString() }); }} disabled={actionBusy}>
          刪除
        </Button>
      </div>
      {actionError ? <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm font-semibold text-amber-900" role="alert">未能交差／更新任務：{actionError}</p> : null}
        </div>
      ) : null}
    </article>
  );
}

function TaskRecurrencePanel({
  task,
  rule,
  currentUserId,
  onChanged
}: {
  task: Task;
  rule: TaskRecurrenceRule | null;
  currentUserId: string;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ownerCanManage = (task.owner_id ?? task.user_id) === currentUserId;
  if (!rule) return null;
  const recurrenceRule: TaskRecurrenceRule = rule;

  async function setActive(isActive: boolean) {
    setBusy(true);
    setError("");
    try {
      await controlAction("set_task_recurrence_active", { id: recurrenceRule.id, isActive });
      onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "未能更新重複工作。請稍後再試。");
    } finally {
      setBusy(false);
    }
  }

  async function setDeadlineMode(deadlineMode: "scheduled" | "none") {
    setBusy(true);
    setError("");
    try {
      await controlAction("set_task_recurrence_deadline_mode", { id: recurrenceRule.id, deadlineMode });
      onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "未能更新期限模式。請稍後再試。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-4 rounded-xl border border-indigo-200 bg-indigo-50/70 p-3" aria-label="重複工作">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-extrabold text-slate-900">重複工作</h4>
          <p className="mt-1 text-xs leading-5 text-slate-700">{recurrenceSummary(recurrenceRule)}</p>
        </div>
        <span className={`rounded-full px-2 py-1 text-xs font-bold ${recurrenceRule.is_active ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-700"}`}>
          {recurrenceRule.is_active ? "已啟用" : "已暫停"}
        </span>
      </div>
      <p className="mt-2 text-xs leading-5 text-slate-600">
        {recurrenceRule.is_active ? "這是一項持續處理的恆常工作。「今次已完成」只記錄這一次，並會按設定建立下一項提醒，不代表結案。" : "規則已暫停；完成目前任務不會再建立下一項。"}
        {recurrenceRule.last_generated_for ? ` 最近一次安排：${formatDate(recurrenceRule.last_generated_for)}。` : ""}
      </p>
      <p className="mt-2 rounded-lg bg-white px-3 py-2 text-xs font-semibold leading-5 text-slate-700">
        {recurrenceRule.deadline_mode === "none"
          ? "沒有期限：週期只作提示日期；今次工作會一直保留，直至你完成、延後或暫停重複工作。"
          : "每次有到期日：下一個週期日期會當作該次到期日。"}
      </p>
      {ownerCanManage ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" variant={recurrenceRule.deadline_mode === "none" ? "secondary" : "success"} disabled={busy || recurrenceRule.deadline_mode === "none"} onClick={() => void setDeadlineMode("none")}>
            沒有期限，只提示
          </Button>
          <Button type="button" variant={recurrenceRule.deadline_mode === "scheduled" ? "secondary" : "success"} disabled={busy || recurrenceRule.deadline_mode === "scheduled"} onClick={() => void setDeadlineMode("scheduled")}>
            每次有到期日
          </Button>
          <Button type="button" variant={recurrenceRule.is_active ? "secondary" : "success"} disabled={busy} onClick={() => void setActive(!recurrenceRule.is_active)}>
            {busy ? "處理中…" : recurrenceRule.is_active ? "暫停重複工作" : "恢復重複工作"}
          </Button>
        </div>
      ) : null}
      {error ? <p className="mt-2 rounded-lg bg-amber-50 p-2 text-xs font-semibold text-amber-900" role="alert">{error}</p> : null}
    </section>
  );
}

function recurrenceSummary(rule: TaskRecurrenceRule) {
  if (rule.night_shift_pattern) {
    return `夜更週期：工作 ${rule.night_shift_on_days ?? 0} 日，休息 ${rule.night_shift_off_days ?? 0} 日`;
  }
  if (rule.frequency === "daily") return rule.business_days_only ? "每個工作日" : "每日";
  if (rule.frequency === "monthly") return rule.business_days_only ? "每月同一日（遇週末順延）" : "每月同一日";
  if (rule.frequency === "custom") return `每隔 ${rule.custom_interval_days ?? 0} 日`;
  const weekdayLabels = ["日", "一", "二", "三", "四", "五", "六"];
  const days = rule.weekdays.map((day) => `週${weekdayLabels[day] ?? "?"}`).join("、");
  return `每星期：${days || "未設定"}`;
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
