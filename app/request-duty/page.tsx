"use client";

import { useMemo, useState } from "react";
import { CalendarDays, CheckCircle2, ClipboardCheck, Clock3, Plus } from "lucide-react";
import { AuthGate } from "@/components/AuthGate";
import { LoadingState } from "@/components/LoadingState";
import { Button } from "@/components/ui/Button";
import { useControlData } from "@/hooks/useControlData";
import { controlAction } from "@/lib/control-api";
import { daysFromToday, formatDate, todayIso } from "@/lib/date";
import type { Task } from "@/lib/types";

export default function RequestDutyPage() {
  return (
    <AuthGate>
      <RequestDutyContent />
    </AuthGate>
  );
}

function RequestDutyContent() {
  const { data, loading, error, reload } = useControlData();
  const [date, setDate] = useState(todayIso());
  const [item, setItem] = useState("");
  const [saving, setSaving] = useState(false);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const [message, setMessage] = useState("");

  const requests = useMemo(() => {
    if (!data) return [];
    return data.tasks
      .filter((task) => task.source_type === "duty_request" && task.status !== "cancelled")
      .sort(compareRequestDutyTasks);
  }, [data]);
  const pending = requests.filter((task) => task.status !== "done");
  const completed = requests.filter((task) => task.status === "done");
  const dueSoon = pending.filter((task) => {
    const days = daysFromToday(task.due_date);
    return days !== null && days >= 0 && days <= 3;
  }).length;
  const overdue = pending.filter((task) => (daysFromToday(task.due_date) ?? 0) < 0).length;

  if (loading || error || !data) return <LoadingState error={error} />;

  async function createRequest(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!item.trim() || !date) return;
    setSaving(true);
    setMessage("");
    try {
      await controlAction("create_task", {
        area: "work",
        taskCategory: "sec",
        sourceType: "duty_request",
        taskType: "Request Duty",
        title: item.trim(),
        dueDate: date,
        status: "not_started",
        nextAction: `提出 duty request：${item.trim()}`,
        definitionOfDone: "已正式提出 duty request",
        estimatedMinutes: 5,
        energyLevel: "low",
        context: "phone",
        risk: "low"
      });
      setItem("");
      setMessage("已加入 Request Duty 提示。完成 request 後剔選即可。");
      await reload();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "未能加入提示，請再試一次。");
    } finally {
      setSaving(false);
    }
  }

  async function setCompleted(task: Task, completedState: boolean) {
    setBusyTaskId(task.id);
    setMessage("");
    try {
      await controlAction("update_task", {
        id: task.id,
        changes: {
          status: completedState ? "done" : "not_started",
          completed_at: completedState ? new Date().toISOString() : null
        }
      });
      setMessage(completedState ? `「${task.title}」已標記為完成。` : `「${task.title}」已重新開啟。`);
      await reload();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "未能更新狀態，請再試一次。");
    } finally {
      setBusyTaskId(null);
    }
  }

  return (
    <div className="space-y-5">
      <section className="ai-planner-card panel overflow-hidden p-5 sm:p-6">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
          <div>
            <p className="eyebrow">Work Reminder</p>
            <h1 className="page-title mt-1">Request Duty</h1>
            <p className="muted mt-2 max-w-2xl text-sm leading-6">
              只需記錄提醒日期及事項。完成 request 後剔選，系統會將原有 Task 標記為已完成並保留紀錄。
            </p>
          </div>
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-indigo-600 text-white shadow-lg shadow-indigo-200/60">
            <ClipboardCheck className="h-6 w-6" />
          </div>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        <Metric icon={<Clock3 className="h-5 w-5" />} label="未 Request" value={pending.length} tone="indigo" />
        <Metric icon={<CalendarDays className="h-5 w-5" />} label="三日內" value={dueSoon} tone="amber" />
        <Metric icon={<CheckCircle2 className="h-5 w-5" />} label="已完成" value={completed.length} tone="green" />
      </section>

      <section className="panel p-4 sm:p-5">
        <div className="mb-4">
          <h2 className="section-title">新增提示</h2>
          <p className="muted mt-1 text-sm">Request Duty 預設歸入 SEC 工作並保持私人。</p>
        </div>
        <form className="grid gap-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto] sm:items-end" onSubmit={createRequest}>
          <label>
            <span className="label">提醒日期</span>
            <input className="field mt-2" type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
          </label>
          <label>
            <span className="label">事項</span>
            <input
              className="field mt-2"
              value={item}
              onChange={(event) => setItem(event.target.value)}
              maxLength={500}
              placeholder="例如：Request 10 月週末 duty"
              required
            />
          </label>
          <Button type="submit" disabled={saving || !item.trim() || !date}>
            <Plus className="h-5 w-5" />
            {saving ? "加入中…" : "加入提示"}
          </Button>
        </form>
        {message ? <p className="mt-4 rounded-xl bg-indigo-50 p-3 text-sm font-semibold text-indigo-800" role="status">{message}</p> : null}
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="section-title">待處理</h2>
            <p className="muted mt-1 text-sm">剔選「已 request」後會立即完成該 Task。</p>
          </div>
          {completed.length ? (
            <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl px-3 text-sm font-semibold text-slate-600 hover:bg-slate-100">
              <input className="h-5 w-5 accent-indigo-600" type="checkbox" checked={showCompleted} onChange={(event) => setShowCompleted(event.target.checked)} />
              顯示已完成（{completed.length}）
            </label>
          ) : null}
        </div>

        {overdue ? (
          <p className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-800" role="status">
            有 {overdue} 項已過提醒日期，先處理最早一項。
          </p>
        ) : null}

        <div className="grid gap-3">
          {pending.length ? pending.map((task) => (
            <RequestDutyRow key={task.id} task={task} busy={busyTaskId === task.id} onChange={(checked) => void setCompleted(task, checked)} />
          )) : (
            <div className="panel p-7 text-center">
              <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-600" />
              <p className="mt-3 font-bold text-slate-800">目前沒有待處理 Request Duty。</p>
              <p className="muted mt-1 text-sm">有新事項時，在上面輸入日期及事項即可。</p>
            </div>
          )}
          {showCompleted ? completed.map((task) => (
            <RequestDutyRow key={task.id} task={task} busy={busyTaskId === task.id} onChange={(checked) => void setCompleted(task, checked)} />
          )) : null}
        </div>
      </section>
    </div>
  );
}

function RequestDutyRow({ task, busy, onChange }: { task: Task; busy: boolean; onChange: (checked: boolean) => void }) {
  const completed = task.status === "done";
  const days = daysFromToday(task.due_date);
  const dateTone = completed
    ? "bg-emerald-50 text-emerald-700"
    : days !== null && days < 0
      ? "bg-rose-50 text-rose-700"
      : days !== null && days <= 3
        ? "bg-amber-50 text-amber-800"
        : "bg-slate-100 text-slate-600";
  const dateLabel = completed ? "已完成" : days !== null && days < 0 ? "已過期" : days === 0 ? "今日" : formatDate(task.due_date);

  return (
    <article className={`panel flex items-start gap-4 p-4 sm:p-5 ${completed ? "opacity-70" : ""}`}>
      <input
        className="mt-0.5 h-6 w-6 shrink-0 cursor-pointer accent-emerald-600"
        type="checkbox"
        checked={completed}
        disabled={busy}
        aria-label={`${completed ? "重新開啟" : "已 request"}：${task.title}`}
        onChange={(event) => onChange(event.target.checked)}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className={`font-bold text-slate-900 ${completed ? "line-through" : ""}`}>{task.title}</h3>
          <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${dateTone}`}>{dateLabel}</span>
        </div>
        <p className="muted mt-2 text-sm">
          提醒日期：{formatDate(task.due_date)}{busy ? " · 更新中…" : completed && task.completed_at ? ` · 完成於 ${formatDate(task.completed_at)}` : ""}
        </p>
      </div>
      {!completed ? <span className="hidden text-sm font-semibold text-slate-500 sm:block">已 request</span> : null}
    </article>
  );
}

function Metric({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number; tone: "indigo" | "amber" | "green" }) {
  const colours = {
    indigo: "bg-indigo-50 text-indigo-700",
    amber: "bg-amber-50 text-amber-700",
    green: "bg-emerald-50 text-emerald-700"
  };
  return (
    <div className="panel flex items-center gap-3 p-4">
      <div className={`grid h-10 w-10 place-items-center rounded-xl ${colours[tone]}`}>{icon}</div>
      <div><p className="muted text-xs font-semibold">{label}</p><p className="text-xl font-bold">{value}</p></div>
    </div>
  );
}

function compareRequestDutyTasks(left: Task, right: Task) {
  const leftCompleted = left.status === "done" ? 1 : 0;
  const rightCompleted = right.status === "done" ? 1 : 0;
  if (leftCompleted !== rightCompleted) return leftCompleted - rightCompleted;
  if (leftCompleted) return (right.completed_at ?? right.updated_at).localeCompare(left.completed_at ?? left.updated_at);
  return (left.due_date ?? "9999-12-31").localeCompare(right.due_date ?? "9999-12-31") || left.created_at.localeCompare(right.created_at);
}
