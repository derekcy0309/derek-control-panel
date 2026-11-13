"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, BellOff, CalendarDays, Check, CheckCircle2, Clock3, ListTodo, Play, Plus } from "lucide-react";
import { AuthGate } from "@/components/AuthGate";
import { ActionCenterTabs, type ActionCenterTab } from "@/components/ActionCenterTabs";
import { FocusMode } from "@/components/FocusMode";
import { LoadingState } from "@/components/LoadingState";
import { Modal } from "@/components/Modal";
import { TaskForm, type TaskSaveResult } from "@/components/forms/TaskForm";
import { TaskActionList } from "@/components/tasks/TaskActionList";
import { ReminderPanel } from "@/components/ReminderPanel";
import { TodayAllTasks } from "@/components/TodayAllTasks";
import { Button } from "@/components/ui/Button";
import { useTodayData } from "@/hooks/useTodayData";
import { controlAction } from "@/lib/control-api";
import { formatDate } from "@/lib/date";
import { hkDateIso } from "@/lib/planning";
import { isMyTask, simplePriorities, simplePriority, simpleToday, sortByPriority } from "@/lib/simple-mode";
import { taskVisibleNextAction } from "@/lib/task-steps";
import { shiftIsoDate } from "@/lib/due-priority";
import type { Task } from "@/lib/types";

export default function HomePage() { return <AuthGate><SimpleDashboard /></AuthGate>; }

function SimpleDashboard() {
  const { data, loading, error, reload, saveTaskLocally } = useTodayData();
  const [adding, setAdding] = useState(false);
  const [focusTask, setFocusTask] = useState<Task | null>(null);
  const [activeTab, setActiveTab] = useState<ActionCenterTab>("focus");
  const [selectedTag, setSelectedTag] = useState("");
  const [summary, setSummary] = useState<"waiting" | "week" | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const today = hkDateIso();

  useEffect(() => {
    const open = () => setAdding(true);
    const syncHash = () => { if (window.location.hash === "#task-action-list") setActiveTab("tasks"); };
    window.addEventListener("dcp:open-task-form", open);
    window.addEventListener("hashchange", syncHash);
    syncHash();
    const url = new URL(window.location.href);
    if (url.searchParams.get("newTask") === "1" || url.searchParams.get("quickTask") === "1") {
      open(); url.searchParams.delete("newTask"); url.searchParams.delete("quickTask");
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    }
    return () => { window.removeEventListener("dcp:open-task-form", open); window.removeEventListener("hashchange", syncHash); };
  }, []);

  function saved(result?: TaskSaveResult) {
    setAdding(false);
    if (!result) { void reload(); return; }
    saveTaskLocally(result.task);
    if (result.refreshRelated) void reload();
    setMessage("Task 已儲存。");
  }

  if (loading && !data) return <LoadingState />;
  if (!data) return <section className="panel space-y-4 p-6"><p role="alert">{error || "未能載入工作清單。"}</p><Button onClick={() => void reload()}>重新載入</Button></section>;
  const current = data;
  const ownTasks = current.taskQueueCatalog.filter((t) => isMyTask(t, current.currentUser.id, current.assignments));
  const plan = simpleToday({ tasks: [...new Map([...current.tasks, ...current.taskQueueCatalog].map((t) => [t.id, t])).values()], planning: current.planning,
    dependencies: current.taskDependencies, assignments: current.assignments, userId: current.currentUser.id, today });
  const activeTag = current.taskTags?.some((tag) => tag.id === selectedTag) ? selectedTag : "";
  const top = activeTag ? plan.ordered.filter((task) => task.personal_tag_ids?.includes(activeTag)).slice(0, 3) : plan.top;
  const plannedIds = new Set(plan.planned.map((t) => t.id));
  const completed = plan.planned.filter((t) => t.status === "done").length;
  const progress = plan.planned.length ? Math.round(completed / plan.planned.length * 100) : 0;
  const active = ownTasks.filter((t) => !["done", "cancelled"].includes(t.status));
  const waiting = sortByPriority(active.filter((t) => t.status === "waiting" || t.current_step_status === "waiting"));
  const upcoming = sortByPriority(active.filter((t) => t.due_date && t.due_date >= today && t.due_date <= shiftIsoDate(today, 7)));
  const pending = current.assignments.filter((a) => a.assigned_to_id === current.currentUser.id && a.status === "pending_acceptance");
  const decisions = active.filter((t) => t.needs_decision_from_id === current.currentUser.id && !t.decision_resolved_at);
  const quiet = Boolean(current.notificationPreferences?.quiet_mode_until && new Date(current.notificationPreferences.quiet_mode_until).getTime() > Date.now());

  async function start(task: Task) {
    if (busy) return;
    setBusy(true); setActionError("");
    try {
      if (!plannedIds.has(task.id)) { await controlAction("set_today_task", { taskId: task.id, included: true }); void reload(); }
      setFocusTask(task);
    } catch (caught) { setActionError(caught instanceof Error ? caught.message : "未能開始；請重試。"); }
    finally { setBusy(false); }
  }
  async function complete(task: Task) {
    if (busy) return;
    setBusy(true); setActionError("");
    try {
      const result = await controlAction<{ task: Task }>("update_task", { id: task.id, changes: { status: "done" } });
      saveTaskLocally(result.task);
      if (task.recurrence_rule_id) void reload();
      const next = plan.top.find((t) => t.id !== task.id);
      setMessage(`${task.recurrence_rule_id ? "今次已做完；之後會按重複設定繼續。" : "已做完。"}${next ? ` 下一件：${next.title}` : ""}`);
    } catch (caught) { setActionError(caught instanceof Error ? caught.message : "未能儲存完成狀態；請重試。"); }
    finally { setBusy(false); }
  }
  async function toggleQuiet() {
    if (busy) return;
    setBusy(true); setActionError("");
    try {
      await controlAction("set_quiet_mode", { until: quiet ? null : new Date(Date.now() + 8 * 3_600_000).toISOString() });
      await reload();
      setMessage(quiet ? "一般通知已恢復。" : "已開安靜模式 8 小時；非緊急通知留待摘要，其他人的設定不變。");
    } catch (caught) { setActionError(caught instanceof Error ? caught.message : "未能更改通知設定。"); }
    finally { setBusy(false); }
  }

  return <div className="simple-dashboard space-y-5">
    <header className="simple-dashboard-banner rounded-3xl px-5 py-5 text-white sm:px-7 sm:py-7">
      <p className="text-sm font-semibold text-indigo-100">{current.currentUser.displayName} · {formatDate(today)}</p>
      <div className="mt-2 flex items-center justify-between gap-3"><h1 className="text-2xl font-extrabold sm:text-4xl">今日做乜？</h1><Button className="simple-add-task min-h-11 shrink-0" onClick={() => setAdding(true)}><Plus className="h-5 w-5" />加 Task</Button></div>
      <p className="mt-2 text-sm text-indigo-100">按 Priority 排，一次做一件。</p>
    </header>
    <section className="grid grid-cols-3 gap-2 sm:gap-4" aria-label="我的工作概覽">
      <button type="button" className="simple-stat-card text-left" onClick={() => setActiveTab("today")}><span className="simple-stat-label"><CheckCircle2 className="h-4 w-4" />今日 Today</span><span className="simple-stat-number">{completed}<small>／{plan.planned.length}</small></span><span className="simple-progress-track"><span style={{ width: `${progress}%` }} /></span><span className="simple-stat-foot">已做完</span></button>
      <button type="button" className="simple-stat-card text-left" aria-pressed={summary === "waiting"} onClick={() => { setActiveTab("focus"); setSummary(summary === "waiting" ? null : "waiting"); }}><span className="simple-stat-label"><Clock3 className="h-4 w-4" />等回覆</span><span className="simple-stat-number">{waiting.length}</span><span className="simple-stat-foot">Waiting</span></button>
      <button type="button" className="simple-stat-card text-left" aria-pressed={summary === "week"} onClick={() => { setActiveTab("focus"); setSummary(summary === "week" ? null : "week"); }}><span className="simple-stat-label"><CalendarDays className="h-4 w-4" />未來 7 日</span><span className="simple-stat-number">{upcoming.length}</span><span className="simple-stat-foot">有 Deadline</span></button>
    </section>
    {error ? <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">同步未成功，保留上次畫面。{error}<button className="ml-2 min-h-11 underline" onClick={() => void reload()}>重試</button></p> : null}
    {message ? <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">{message}</p> : null}
    {actionError ? <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{actionError}</p> : null}
    <ActionCenterTabs active={activeTab} todayCount={plan.planned.length} taskCount={active.length} onChange={setActiveTab} />
    {activeTab === "focus" ? <section id="action-center-panel-focus" role="tabpanel" aria-labelledby="action-center-tab-focus" className="space-y-4">
      <div className="flex flex-wrap items-center gap-2"><div className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1" aria-label="Dashboard Tags"><button type="button" aria-pressed={!activeTag} className={`simple-tag-filter shrink-0 ${!activeTag ? "is-active" : ""}`} onClick={() => setSelectedTag("")}>全部</button>{(current.taskTags ?? []).map((tag) => <button key={tag.id} type="button" aria-pressed={activeTag === tag.id} className={`simple-tag-filter shrink-0 ${activeTag === tag.id ? "is-active" : ""}`} onClick={() => setSelectedTag(tag.id)}>{tag.name}</button>)}</div><button type="button" className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl px-3 text-sm font-semibold ${quiet ? "bg-indigo-100 text-indigo-900" : "bg-slate-100 text-slate-600"}`} disabled={busy} aria-pressed={quiet} onClick={() => void toggleQuiet()}><BellOff className="h-4 w-4" />{quiet ? "安靜中" : "安靜模式"}</button></div>
      {summary ? <section className="panel space-y-3 p-4" aria-label={summary === "waiting" ? "等回覆 Waiting" : "未來 7 日 Deadline"}><h2 className="font-extrabold">{summary === "waiting" ? "等回覆 Waiting" : "未來 7 日 Deadline"}</h2>{(summary === "waiting" ? waiting : upcoming).slice(0, 5).map((task) => <Link key={task.id} href={`/tasks/${task.id}`} className="flex min-h-12 items-center justify-between gap-3 rounded-xl bg-slate-50 p-3 text-sm font-semibold"><span className="min-w-0 break-words">{task.title}{summary === "waiting" && task.waiting_for ? <span className="mt-1 block text-xs font-normal text-slate-500">等 {task.waiting_for} · {task.waiting_on || "回覆"}</span> : null}</span><span className="shrink-0 text-xs text-slate-500">{formatDate(summary === "waiting" ? task.follow_up_date : task.due_date)}</span></Link>)}{!(summary === "waiting" ? waiting : upcoming).length ? <p className="text-sm text-slate-500">暫時冇相關工作。</p> : null}<button type="button" className="min-h-11 text-sm font-bold text-indigo-700" onClick={() => { setActiveTab("tasks"); setSummary(null); }}>打開完整清單 →</button></section> : null}
      <div className="flex items-end justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wider text-indigo-600">最多三件 · One at a time</p><h2 className="mt-1 text-xl font-extrabold">{plan.isSuggestion ? "按 Priority 建議" : "今日重點"}</h2></div><button type="button" className="min-h-11 text-sm font-bold text-indigo-700" onClick={() => setActiveTab("today")}>自己排今日 →</button></div>
      {!top.length ? <section className="panel p-7 text-center"><ListTodo className="mx-auto h-8 w-8 text-indigo-300" /><p className="mt-3 font-bold">{activeTag ? "呢個 Tag 暫時冇今日重點。" : completed && completed === plan.planned.length ? "今日已排的工作做晒。" : "暫時冇可開始的工作。"}</p><p className="mt-1 text-sm text-slate-500">需要時可以加 Task，或者去「今日全部」查看安排。</p></section> : null}
      {top.map((task, index) => <SimpleTaskCard key={task.id} task={task} index={index} inToday={plannedIds.has(task.id)} busy={busy} onStart={() => void start(task)} onComplete={() => void complete(task)} />)}
      {pending.length ? <details className="panel p-4"><summary className="min-h-11 cursor-pointer py-2 font-bold">新交接（{pending.length}）</summary><p className="mt-2 text-sm text-slate-500">接受後先加入你的工作建議。</p>{pending.slice(0, 3).map((a) => <Link key={a.id} className="mt-2 flex min-h-12 items-center justify-between gap-2 rounded-xl bg-indigo-50 p-3 text-sm font-semibold text-indigo-900" href={`/tasks/${a.resource_id}`}><span>{current.taskCatalog.find((t) => t.id === a.resource_id)?.title || "新工作交接"}</span><span className="shrink-0">查看／接受 →</span></Link>)}<Link href="/sharing" className="mt-2 inline-flex min-h-11 items-center text-sm font-bold text-indigo-700">查看全部交接 →</Link></details> : null}
      {decisions.length ? <details className="panel p-4"><summary className="min-h-11 cursor-pointer py-2 font-bold">等我決定（{decisions.length}）</summary>{decisions.slice(0, 3).map((task) => <Link key={task.id} className="mt-2 flex min-h-12 items-center justify-between rounded-xl bg-slate-50 p-3 text-sm font-semibold" href={`/tasks/${task.id}`}>{task.title}<ArrowRight className="h-4 w-4" /></Link>)}</details> : null}
      <details className="panel p-4"><summary className="min-h-11 cursor-pointer py-2 font-bold text-slate-600">提醒及活動</summary><ReminderPanel reminders={current.reminders} participants={current.participants} currentUserId={current.currentUser.id} onChanged={reload} /></details>
    </section> : null}
    {activeTab === "today" ? <TodayAllTasks tasks={current.tasks} availableTasks={sortByPriority(current.taskQueueCatalog)} planning={current.planning} today={today} onChanged={reload} onStart={(task) => void start(task)} onComplete={complete} onBrowseTasks={() => setActiveTab("tasks")} /> : null}
    {activeTab === "tasks" ? <div id="action-center-panel-tasks" role="tabpanel" aria-labelledby="action-center-tab-tasks"><TaskActionList data={current} onChanged={reload} onTaskSaved={saved} /></div> : null}
    {adding ? <Modal title="加 Task" onClose={() => setAdding(false)}><TaskForm userId={current.currentUser.id} participants={current.participants} onSaved={saved} onCancel={() => setAdding(false)} /></Modal> : null}
    {focusTask ? <FocusMode task={focusTask} defaultMinutes={current.settings.focus_minutes ?? 25} currentUserId={current.currentUser.id} participants={current.participants} sharedTask={Boolean(focusTask.visibility && focusTask.visibility !== "private")} onClose={() => setFocusTask(null)} onChanged={() => void reload()} /> : null}
  </div>;
}

function SimpleTaskCard({ task, index, inToday, busy, onStart, onComplete }: { task: Task; index: number; inToday: boolean; busy: boolean; onStart: () => void; onComplete: () => void }) {
  return <article className={`simple-focus-card ${index === 0 ? "is-now" : ""}`} aria-label={`${index === 0 ? "而家做" : "之後做"}：${task.title}`}>
    <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-extrabold uppercase tracking-wider text-indigo-600">{index === 0 ? "而家做 Now" : `之後做 Next ${index}`}</p><span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-bold text-indigo-700">{simplePriorities.find((p) => p.value === simplePriority(task.requested_priority))?.label}</span></div>
    <Link href={`/tasks/${task.id}`} className={`mt-3 block break-words font-extrabold text-slate-950 hover:text-indigo-700 ${index === 0 ? "text-2xl sm:text-3xl" : "text-lg"}`}>{task.title}</Link>
    <p className="mt-3 break-words text-sm leading-6 text-slate-600">{taskVisibleNextAction(task) || "先打開 Task；要拆細時先用 AI 拆步驟。"}</p>
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500"><span>Deadline：{task.due_date ? formatDate(task.due_date) : "未定"}</span><span>{task.custom_status_label || (task.status === "in_progress" ? "做緊" : "未開始")}</span>{!inToday ? <span>建議，未加入今日</span> : null}</div>
    <div className="mt-5 flex flex-wrap items-center gap-2"><Button disabled={busy} onClick={onStart}><Play className="h-4 w-4" />{index === 0 ? "開始做 Start" : "做呢件"}</Button><Button variant="secondary" disabled={busy} onClick={onComplete}><Check className="h-4 w-4" />{task.recurrence_rule_id ? "今次做完" : "做完 Done"}</Button><Link href={`/tasks/${task.id}`} className="ml-auto inline-flex min-h-11 items-center gap-1 px-2 text-sm font-semibold text-slate-600">詳情<ArrowRight className="h-4 w-4" /></Link></div>
  </article>;
}
