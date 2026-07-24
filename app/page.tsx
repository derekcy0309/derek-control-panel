"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, BatteryLow, CalendarClock, Check, Clock3, Plus, ShieldCheck, Sparkles, TimerReset, Zap } from "lucide-react";
import { AuthGate } from "@/components/AuthGate";
import { FocusMode } from "@/components/FocusMode";
import { LoadingState } from "@/components/LoadingState";
import { Modal } from "@/components/Modal";
import { TaskForm } from "@/components/forms/TaskForm";
import { Button } from "@/components/ui/Button";
import { controlAction } from "@/lib/control-api";
import { formatDate } from "@/lib/date";
import { activeWipCount, classifyDeadlineRisk, recommendTodayTasks } from "@/lib/planning";
import type { Assignment, Task } from "@/lib/types";
import { useControlData } from "@/hooks/useControlData";

export default function HomePage() { return <AuthGate><TodayCommandCenter /></AuthGate>; }

function TodayCommandCenter() {
  const { data, loading, error, reload } = useControlData();
  const [adding, setAdding] = useState(false);
  const [focusTask, setFocusTask] = useState<Task | null>(null);
  const [capacityOpen, setCapacityOpen] = useState(false);
  const [actionError, setActionError] = useState("");

  const recommendation = useMemo(() => data ? recommendTodayTasks({ tasks: data.tasks, assignments: data.assignments, currentUserId: data.currentUser.id, settings: data.settings, capacity: data.capacity }) : null, [data]);
  if (loading || error || !data || !recommendation) return <LoadingState error={error} />;

  const gentle = Boolean(data.settings.gentle_mode);
  const acceptedAssignments = new Set(data.assignments.filter((item) => item.assigned_to_id === data.currentUser.id && ["accepted","in_progress","blocked"].includes(item.status)).map((item) => item.resource_id));
  const quickWins = recommendation.all.filter((item) => (item.task.estimated_minutes ?? 999) <= 30).slice(0, 4);
  const pending = data.assignments.filter((item) => item.assigned_to_id === data.currentUser.id && item.status === "pending_acceptance");
  const wip = activeWipCount(data.tasks, data.assignments, data.currentUser.id);
  const wipLimit = data.settings.wip_limit ?? 3;

  async function respond(assignment: Assignment, response: "accept" | "decline") {
    setActionError("");
    try { await controlAction("assignment_response", { id: assignment.id, response, reason: response === "decline" ? "日期或容量不合適" : undefined }); await reload(); }
    catch (caught) { setActionError(caught instanceof Error ? caught.message : "未能處理指派。"); }
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      <section className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="eyebrow">Today Command Center</p><h1 className="page-title mt-1">{gentle ? "今日可以先處理這一步" : "今日行動中心"}</h1><p className="muted mt-2 max-w-2xl text-sm leading-6">{gentle ? "只顯示最重要和可開始的事項；需要時可以重新安排。" : "先完成唯一主要任務，再推進少量關鍵工作。"}</p></div>
        <div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={() => setCapacityOpen(true)}><BatteryLow className="h-5 w-5" />今日容量</Button><Button onClick={() => setAdding(true)}><Plus className="h-5 w-5" />快速新增</Button></div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(18rem,.7fr)]">
        <div className="relative overflow-hidden rounded-2xl border border-indigo-200 bg-white p-5 sm:p-7">
          <div className="pointer-events-none absolute right-[-3rem] top-[-5rem] h-56 w-56 rounded-full bg-indigo-100/70 blur-2xl" />
          <div className="relative">
            <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2 text-sm font-bold text-indigo-700"><Sparkles className="h-4 w-4" />今日唯一主要任務</div>{recommendation.primary ? <RiskPill risk={recommendation.primary.risk} gentle={gentle} /> : null}</div>
            {recommendation.primary ? <PrimaryTask item={recommendation.primary} assigned={acceptedAssignments.has(recommendation.primary.task.id)} onFocus={() => setFocusTask(recommendation.primary!.task)} onChanged={reload} gentle={gentle} /> : <EmptyState title="目前沒有今日主要任務" text="你可以從現有任務選擇，或新增一個清晰的下一步。" onAdd={() => setAdding(true)} />}
          </div>
        </div>
        <aside className="panel p-5">
          <div className="flex items-center justify-between"><div><p className="eyebrow">工作容量</p><h2 className="section-title mt-1">進行中 {wip} / {wipLimit}</h2></div><div className={`grid h-11 w-11 place-items-center rounded-xl ${wip > wipLimit ? "bg-amber-100 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>{wip > wipLimit ? <AlertTriangle className="h-5 w-5" /> : <ShieldCheck className="h-5 w-5" />}</div></div>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${wip > wipLimit ? "bg-amber-500" : "bg-indigo-500"}`} style={{ width: `${Math.min(100, (wip / Math.max(1, wipLimit)) * 100)}%` }} /></div>
          <p className="muted mt-3 text-sm leading-6">{wip > wipLimit ? "同時進行的工作較多。先完成、暫停或重新安排一項。" : gentle ? "今日容量可以隨時調低，不會視為失敗。" : "限制同時進行的工作，保留完成空間。"}</p>
          {data.capacity ? <div className="mt-4 rounded-xl bg-slate-50 p-3 text-sm"><p className="font-semibold">今日能量：{energyLabel[data.capacity.energy_level]}</p><p className="muted mt-1">{data.capacity.available_minutes ? `可用 ${data.capacity.available_minutes} 分鐘` : "未設定可用時間"}</p></div> : null}
        </aside>
      </section>

      {pending.length ? <section className="panel p-5"><div className="flex items-center justify-between gap-3"><div><p className="eyebrow">Pending Assignments</p><h2 className="section-title mt-1">等待你回應</h2></div><span className="rounded-full bg-indigo-50 px-3 py-1 text-sm font-bold text-indigo-700">{pending.length}</span></div><div className="mt-4 grid gap-3">{pending.map((assignment) => <PendingAssignment key={assignment.id} assignment={assignment} task={data.tasks.find((task) => task.id === assignment.resource_id)} actor={participantName(data, assignment.assigned_by_id)} onAccept={() => respond(assignment, "accept")} onDecline={() => respond(assignment, "decline")} />)}</div>{actionError ? <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700" role="alert">{actionError}</p> : null}</section> : null}

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="panel p-5"><div className="flex items-center justify-between"><div><p className="eyebrow">Progress</p><h2 className="section-title mt-1">今日推進事項</h2></div><span className="text-sm font-semibold text-slate-500">最多 {gentle ? 2 : 3} 項</span></div><div className="mt-4 space-y-3">{recommendation.progress.length ? recommendation.progress.map((item) => <CompactTask key={item.task.id} task={item.task} reason={item.reasons[0]} onFocus={() => setFocusTask(item.task)} gentle={gentle} />) : <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">目前沒有其他需要推進的事項。</p>}</div></div>
        <div className="panel p-5"><div className="flex items-center justify-between"><div><p className="eyebrow">Quick Wins</p><h2 className="section-title mt-1">低阻力小任務</h2></div><Zap className="h-5 w-5 text-amber-500" /></div><div className="mt-4 space-y-3">{quickWins.length ? quickWins.map((item) => <CompactTask key={item.task.id} task={item.task} reason={`${item.task.estimated_minutes ?? 15} 分鐘 · ${item.task.context || "任何地方"}`} onFocus={() => setFocusTask(item.task)} gentle={gentle} />) : <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">加入預計時間後，系統會在這裡顯示 Quick Wins。</p>}</div></div>
      </section>

      {adding ? <Modal title="快速新增任務" onClose={() => setAdding(false)}><TaskForm userId={data.currentUser.id} participants={data.participants} compact onSaved={() => { setAdding(false); void reload(); }} onCancel={() => setAdding(false)} /></Modal> : null}
      {capacityOpen ? <CapacityModal current={data.capacity} onClose={() => setCapacityOpen(false)} onSaved={() => { setCapacityOpen(false); void reload(); }} /> : null}
      {focusTask ? <FocusMode task={focusTask} defaultMinutes={data.settings.focus_minutes ?? 25} onClose={() => setFocusTask(null)} onChanged={reload} /> : null}
    </div>
  );
}

function PrimaryTask({ item, assigned, onFocus, onChanged, gentle }: { item: ReturnType<typeof recommendTodayTasks>["primary"] extends infer T ? Exclude<T, null> : never; assigned: boolean; onFocus: () => void; onChanged: () => void; gentle: boolean }) {
  const task = item.task;
  async function complete() { await controlAction("update_task", { id: task.id, changes: { status: "done" } }); onChanged(); }
  return <div className="mt-5"><div className="flex flex-wrap gap-2"><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">{areaLabel[task.area ?? (task.scope === "company" ? "work" : "family")]}</span>{assigned ? <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-bold text-indigo-700">已接受指派</span> : <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">私人</span>}</div><h2 className="mt-4 text-2xl font-bold leading-tight tracking-tight sm:text-4xl">{task.title}</h2><div className="mt-5 rounded-xl bg-slate-50 p-4"><p className="text-xs font-bold uppercase tracking-[.12em] text-slate-500">下一步</p><p className="mt-2 text-base font-semibold leading-7 sm:text-lg">{task.next_action || "先加入一個清晰、可見的下一步"}</p></div><div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-slate-600">{task.estimated_minutes ? <span className="flex items-center gap-1.5"><Clock3 className="h-4 w-4" />{task.estimated_minutes} 分鐘</span> : null}{task.due_date ? <span className="flex items-center gap-1.5"><CalendarClock className="h-4 w-4" />截止 {formatDate(task.due_date)}</span> : null}<span>{gentle ? "建議：" : "排序原因："}{item.reasons.slice(0, 2).join("、")}</span></div><div className="mt-6 flex flex-wrap gap-3"><Button onClick={onFocus}><ArrowRight className="h-5 w-5" />開始這一步</Button><Button variant="success" onClick={complete}><Check className="h-5 w-5" />完成</Button><Button variant="secondary" onClick={() => controlAction("update_task", { id: task.id, changes: { snoozed_until: new Date(Date.now() + 86400000).toISOString() } }).then(onChanged)}><TimerReset className="h-5 w-5" />{gentle ? "明天再處理" : "延後一天"}</Button></div></div>;
}

function CompactTask({ task, reason, onFocus, gentle }: { task: Task; reason: string; onFocus: () => void; gentle: boolean }) {
  return <button className="flex min-h-16 w-full items-center gap-3 rounded-xl border border-slate-200 p-3 text-left transition hover:border-indigo-200 hover:bg-indigo-50/40" onClick={onFocus}><div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-500"><ArrowRight className="h-4 w-4" /></div><div className="min-w-0 flex-1"><p className="truncate font-semibold text-slate-900">{task.title}</p><p className="mt-1 truncate text-xs text-slate-500">{gentle ? "可以先做：" : "推薦："}{task.next_action || reason}</p></div>{task.due_date ? <span className="shrink-0 text-xs font-semibold text-slate-500">{formatDate(task.due_date).slice(5)}</span> : null}</button>;
}

function PendingAssignment({ assignment, task, actor, onAccept, onDecline }: { assignment: Assignment; task?: Task; actor: string; onAccept: () => void; onDecline: () => void }) {
  return <article className="flex flex-col gap-3 rounded-xl border border-indigo-100 bg-indigo-50/40 p-4 sm:flex-row sm:items-center"><div className="min-w-0 flex-1"><p className="text-xs font-bold text-indigo-700">由 {actor} 指派 · 可更新狀態</p><h3 className="mt-1 font-bold">{task?.title || "一項已分享工作"}</h3><p className="muted mt-1 text-sm">{assignment.due_date ? `截止 ${formatDate(assignment.due_date)}` : "未設定截止日期"}</p></div><div className="flex gap-2"><Button onClick={onAccept}>接受</Button><Button variant="secondary" onClick={onDecline}>婉拒</Button></div></article>;
}

function RiskPill({ risk, gentle }: { risk: ReturnType<typeof classifyDeadlineRisk>; gentle: boolean }) { const map = { normal: "正常", attention: "需要留意", high_risk: gentle ? "此項目需要留意" : "高風險", overdue: gentle ? "需要重新安排" : "已逾期", waiting_external: "等待外部回覆" }; const tone = risk === "overdue" || risk === "high_risk" ? "bg-red-50 text-red-700" : risk === "attention" ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-600"; return <span className={`rounded-full px-3 py-1 text-xs font-bold ${tone}`}>{map[risk]}</span>; }
function EmptyState({ title, text, onAdd }: { title: string; text: string; onAdd: () => void }) { return <div className="py-8 text-center"><div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-indigo-50 text-indigo-600"><Sparkles className="h-5 w-5" /></div><h2 className="mt-4 text-xl font-bold">{title}</h2><p className="muted mx-auto mt-2 max-w-md text-sm leading-6">{text}</p><Button className="mt-5" onClick={onAdd}><Plus className="h-5 w-5" />新增任務</Button></div>; }

function CapacityModal({ current, onClose, onSaved }: { current: import("@/lib/types").CapacityCheckin | null; onClose: () => void; onSaved: () => void }) {
  const [energy, setEnergy] = useState(current?.energy_level ?? "medium"); const [minutes, setMinutes] = useState(String(current?.available_minutes ?? "")); const [mode, setMode] = useState(current?.mode ?? "normal"); const [essentialOnly, setEssentialOnly] = useState(current?.essential_only ?? false); const [saving, setSaving] = useState(false);
  async function save(event: React.FormEvent) { event.preventDefault(); setSaving(true); await controlAction("capacity_checkin", { energyLevel: energy, availableMinutes: minutes ? Number(minutes) : null, mode, essentialOnly }); setSaving(false); onSaved(); }
  return <Modal title="今日容量" onClose={onClose}><form className="grid gap-4" onSubmit={save}><fieldset><legend className="label">今日能量</legend><div className="mt-2 grid grid-cols-3 gap-2">{(["low","medium","high"] as const).map((value) => <button key={value} type="button" className={`min-h-11 rounded-xl border px-3 font-semibold ${energy === value ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-slate-200"}`} onClick={() => setEnergy(value)}>{energyLabel[value]}</button>)}</div></fieldset><label><span className="label">今日可用時間（分鐘）</span><input className="field mt-2" type="number" min="0" max="1440" value={minutes} onChange={(event) => setMinutes(event.target.value)} /></label><label><span className="label">今日模式</span><select className="field mt-2" value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}><option value="normal">一般</option><option value="gentle">Gentle Mode</option><option value="minimum_step">只做最小下一步</option><option value="shift">更表模式</option></select></label><label className="flex min-h-11 items-center gap-3 rounded-xl border border-slate-200 p-3"><input type="checkbox" checked={essentialOnly} onChange={(event) => setEssentialOnly(event.target.checked)} /><span className="font-semibold">今日只顯示必要事項</span></label><div className="flex gap-2"><Button type="submit" disabled={saving}>{saving ? "儲存中…" : "儲存今日容量"}</Button><Button type="button" variant="secondary" onClick={onClose}>取消</Button></div></form></Modal>;
}

const areaLabel = { work: "工作", family: "家庭", personal: "個人" } as const;
const energyLabel = { low: "低", medium: "中", high: "高" } as const;
function participantName(data: NonNullable<ReturnType<typeof useControlData>["data"]>, id: string) { return data.participants.find((item) => item.user_id === id)?.display_name || "對方"; }
