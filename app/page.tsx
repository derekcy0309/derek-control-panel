"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, BellOff, CalendarDays, Check, CheckCircle2, Clock3, ListChecks, Plus, Play } from "lucide-react";
import { AuthGate } from "@/components/AuthGate";
import { ActionCenterTabs, type ActionCenterTab } from "@/components/ActionCenterTabs";
import { FocusMode } from "@/components/FocusMode";
import { LoadingState } from "@/components/LoadingState";
import { TaskForm, type TaskSaveResult } from "@/components/forms/TaskForm";
import { TaskActionList } from "@/components/tasks/TaskActionList";
import { ReminderPanel } from "@/components/ReminderPanel";
import { TodayAllTasks } from "@/components/TodayAllTasks";
import { CalendarBriefPanel } from "@/components/CalendarBriefPanel";
import { Button } from "@/components/ui/Button";
import { useTodayData } from "@/hooks/useTodayData";
import { controlAction } from "@/lib/control-api";
import { formatDate } from "@/lib/date";
import { useDaylineDate } from "@/hooks/useDaylineDate";
import { daylineDate, daylineWeek } from "@/lib/dayline";
import { DaylineNow, DaylineNext } from "@/components/dayline/TodayCards";
import { WeatherStrip } from "@/components/dayline/WeatherStrip";
import { HomeLinks } from "@/components/dayline/HomeLinks";
import { PersonalInformation, useInfoChoices } from "@/components/dayline/InfoChoices";
import { isMyTask, simpleToday, sortByPriority } from "@/lib/simple-mode";
import { createTaskPriorityProjection, type TaskPriorityProjection } from "@/lib/upcoming-task-priority";
import { isOverdueTask } from "@/lib/overdue-tasks";
import { OverdueTasks } from "@/components/dayline/OverdueTasks";
import { taskVisibleNextAction } from "@/lib/task-steps";
import { taskTagColors } from "@/lib/task-tag-colors";
import { activeTaskTagFilter, allTaskTags, isAllTaskTagFilter, isTaskTagFilterSelected, matchesTaskTagFilter, selectAllTaskTags, toggleTaskTagFilter, type TaskTagFilter } from "@/lib/task-tag-filter";
import { starterSteps } from "@/lib/work-guide";
import { shiftIsoDate } from "@/lib/due-priority";
import type { Task } from "@/lib/types";
import "./dayline-editorial-work.css";
import "./dayline-overdue.css";

export default function HomePage() { return <AuthGate><SimpleDashboard /></AuthGate>; }

const taskListOrderKey = (userId: string) => `dcp:my-tasks-sort:v1:${userId}`;
type TaskListOrder = "grade" | "status";

function SimpleDashboard() {
  const { data, loading, error, detailsReady, reload, saveTaskLocally } = useTodayData(true);
  const info=useInfoChoices(data?.currentUser?.id??null);
  const [focusCapture, setFocusCapture] = useState(false);
  const [focusTask, setFocusTask] = useState<Task | null>(null);
  const [activeTab, setActiveTab] = useState<ActionCenterTab>("focus");
  const [showOverdue, setShowOverdue] = useState(false);
  const [taskListOrder, setTaskListOrder] = useState<{ userId: string; order: TaskListOrder } | null>(null);
  const taskListOrderOwner = data?.currentUser.id;
  const taskListGradeOrder = taskListOrder?.userId === taskListOrderOwner && taskListOrder?.order === "grade";
  const [selectedTags, setSelectedTags] = useState<TaskTagFilter>(allTaskTags);
  const today = useDaylineDate();
  const catalogue = data?.taskTags;
  const focusTasks = data?.tasks, queueTasks = data?.taskQueueCatalog;
  const priority = useMemo(() => createTaskPriorityProjection(catalogue ?? [], [...(focusTasks ?? []), ...(queueTasks ?? [])], today), [catalogue,focusTasks,queueTasks,today]);
  const tagColors = useMemo(() => taskTagColors(priority.catalog), [priority]);
  const knownTagIds = useMemo(() => priority.catalog.map(tag => tag.id), [priority]);
  const tagFilter = useMemo(() => activeTaskTagFilter(selectedTags, knownTagIds), [selectedTags, knownTagIds]);
  const [summary, setSummary] = useState<"waiting" | "week" | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const lastDate=useRef(today);
  useEffect(()=>{if(lastDate.current!==today){lastDate.current=today;void reload();window.dispatchEvent(new Event("dcp:calendar-changed"));}},[today,reload]);
  const [captureOpen,setCaptureOpen]=useState(false);
  useEffect(()=>{window.dispatchEvent(new CustomEvent("dayline:tab",{detail:activeTab}));},[activeTab]);

  useEffect(() => {
    if (!taskListOrderOwner) return;
    let order: TaskListOrder = "status";
    try {
      if (localStorage.getItem(taskListOrderKey(taskListOrderOwner)) === "grade") order = "grade";
    } catch { /* Storage may be unavailable; manual sorting still works in this visit. */ }
    setTaskListOrder({ userId: taskListOrderOwner, order });
  }, [taskListOrderOwner]);

  useEffect(() => {
    const open = () => {setCaptureOpen(true);setFocusCapture(true);};
    const overview=()=>{setShowOverdue(false);setActiveTab("focus");}, tasks=()=>{setShowOverdue(false);setActiveTab("tasks");};
    window.addEventListener("dayline:overview",overview);window.addEventListener("dayline:tasks",tasks);
    const syncHash = () => { if (window.location.hash === "#dayline-start") overview(); if (window.location.hash === "#task-action-list") tasks(); if(window.location.hash==="#today-order") {setShowOverdue(false);setActiveTab("today");} };
    window.addEventListener("dcp:open-task-form", open);
    window.addEventListener("hashchange", syncHash);
    syncHash();
    const url = new URL(window.location.href);
    if (url.searchParams.get("newTask") === "1" || url.searchParams.get("quickTask") === "1") {
      open(); url.searchParams.delete("newTask"); url.searchParams.delete("quickTask");
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    }
    return () => { window.removeEventListener("dayline:overview",overview);window.removeEventListener("dayline:tasks",tasks);window.removeEventListener("dcp:open-task-form", open); window.removeEventListener("hashchange", syncHash); };
  }, []);
  useEffect(()=>{if(focusCapture && data){document.getElementById("dashboard-task-name")?.focus();setFocusCapture(false);}},[focusCapture,data]);
  useEffect(() => {
    if (activeTab !== "tasks" || !showOverdue || !detailsReady) return;
    const region = document.getElementById("task-overdue");
    region?.focus({ preventScroll: true });
    region?.scrollIntoView({ block: "start" });
  }, [activeTab, showOverdue, detailsReady]);

  function saved(result?: TaskSaveResult) {
    if (!result) { void reload(); return; }
    saveTaskLocally(result.task);
    window.dispatchEvent(new Event("dcp:calendar-changed"));
    if (result.refreshRelated) void reload();
    setMessage("Task 已儲存。");
  }

  if (loading && !data) return <LoadingState />;
  if (!data) return <section className="panel space-y-4 p-6"><p role="alert">{error || "未能載入工作清單。"}</p><Button onClick={() => void reload()}>重新載入</Button></section>;
  const current = data;
  const ownTasks = (detailsReady ? current.taskQueueCatalog : current.tasks).filter((t) => isMyTask(t, current.currentUser.id, current.assignments));
  // The bounded Today read model includes dependency checks; the full queue is for browsing only.
  const plan = simpleToday({ tasks: current.tasks, planning: current.planning,
    dependencies: current.taskDependencies, assignments: current.assignments, userId: current.currentUser.id, today, priorityRank: priority.rank });
  const showingAllTags = isAllTaskTagFilter(tagFilter);
  const allTagsChecked = tagFilter === selectAllTaskTags;
  const matches = (showingAllTags ? plan.top : plan.ordered.filter(task => matchesTaskTagFilter(priority.ids(task), tagFilter))).slice(0,3);
  const plannedIds = new Set(plan.planned.map((t) => t.id));
  const completed = plan.planned.filter((t) => t.status === "done").length;
  const progress = plan.planned.length ? Math.round(completed / plan.planned.length * 100) : 0;
  const active = ownTasks.filter((t) => !t.archived_at && !t.deleted_at && !["done", "cancelled"].includes(t.status));
  const waiting = sortByPriority(active.filter((t) => t.status === "waiting" || t.current_step_status === "waiting"), priority.rank);
  const upcomingThrough = shiftIsoDate(today, 14);
  const upcoming = active.filter((t) => t.due_date && t.due_date >= today && t.due_date <= upcomingThrough)
    .sort((a,b) => a.due_date!.localeCompare(b.due_date!) || priority.rank(a)-priority.rank(b));
  const overdue = active.filter(task => isOverdueTask(task,today))
    .sort((a,b) => a.due_date!.localeCompare(b.due_date!) || priority.rank(a)-priority.rank(b) || a.id.localeCompare(b.id));
  const pending = current.assignments.filter((a) => a.assigned_to_id === current.currentUser.id && a.status === "pending_acceptance");
  const decisions = active.filter((t) => t.needs_decision_from_id === current.currentUser.id && !t.decision_resolved_at);
  const quiet = Boolean(current.notificationPreferences?.quiet_mode_until && new Date(current.notificationPreferences.quiet_mode_until).getTime() > Date.now());

  function toggleTaskListOrder() {
    const userId = current.currentUser.id;
    const order: TaskListOrder = taskListGradeOrder ? "status" : "grade";
    setTaskListOrder({ userId, order });
    try { localStorage.setItem(taskListOrderKey(userId), order); } catch { /* Apply the view choice without saving. */ }
  }

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
      window.dispatchEvent(new Event("dcp:calendar-changed"));
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

  const weekNames={almond:"暖杏",mist:"霧藍",mint:"薄荷",mauve:"淡紫"};
  const nav=<ActionCenterTabs active={activeTab} todayCount={plan.planned.length} taskCount={detailsReady?active.length:null} onChange={tab=>{setShowOverdue(false);setActiveTab(tab);}}/>;
  const detailsSpare=<p className="panel p-4" role="status">{error?"完整任務資料未能載入。":"讀取完整任務資料中…"}{error?<button type="button" className="ml-2 min-h-11 underline" onClick={()=>void reload()}>重試</button>:null}</p>;
  return <>
    <header className="dl-intro dl-editorial-intro"><div><div className="dl-calendarline"><span className="dl-miniline"/>{activeTab==="focus"?<time dateTime={today}>{daylineDate(today,true)}</time>:<span>WORK LIST</span>}</div><h1>{activeTab==="focus"?"今日總覽":activeTab==="today"?"今日工作":"我的任務"}</h1>{activeTab==="focus"?<p className="dl-editorial-welcome">一次做一件。先由眼前一步開始。</p>:null}</div>
      <button type="button" className="dl-add" aria-expanded={captureOpen} aria-controls="dayline-add" onClick={()=>{setCaptureOpen(!captureOpen);setFocusCapture(!captureOpen);}}><Plus aria-hidden="true"/>加 Task</button></header>
    <div id="dayline-add" hidden={!captureOpen} className="dl-capture">{captureOpen?<TaskForm key={current.currentUser.id} inline userId={current.currentUser.id} knownTags={current.taskTags} participants={current.participants} onSaved={saved}/>:null}</div>
    {error ? <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">同步未成功，保留上次畫面。{error}<button className="ml-2 min-h-11 underline" onClick={() => void reload()}>重試</button></p> : null}
    {message ? <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">{message}</p> : null}
    {actionError ? <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{actionError}</p> : null}
    {activeTab==="focus"?<div id="action-center-panel-focus" role="tabpanel" aria-labelledby="action-center-tab-focus">
      <OverdueTasks tasks={overdue} today={today} onShowAll={()=>{setShowOverdue(true);setActiveTab("tasks");}}/>
      <div className="dl-board dl-editorial-board">
        <DaylineNow key={current.currentUser.id+":"+(plan.top[0]?.id??"empty")} userId={current.currentUser.id} task={plan.top[0]} priority={priority} tagColors={tagColors} suggestion={plan.isSuggestion} completed={Boolean(completed&&completed===plan.planned.length)} onOrder={()=>setActiveTab("today")}/>
        <DaylineNext tasks={plan.top.slice(1)} priority={priority} tagColors={tagColors} suggestion={plan.isSuggestion} onOrder={()=>setActiveTab("today")}/>
        <CalendarBriefPanel key={current.currentUser.id} userId={current.currentUser.id}/>
        <figure className="dl-harbour-figure">
          <figcaption><span>維港晨光</span><em lang="en">Harbour Morning</em></figcaption>
          <div className="dl-harbour-illustration" aria-hidden="true"/>
          <WeatherStrip/>
        </figure>
      </div>
      <PersonalInformation key={current.currentUser.id} model={info}/>
      <HomeLinks key={current.currentUser.id} userId={current.currentUser.id}/>
      {pending.length ? <details className="panel p-4"><summary className="min-h-11 cursor-pointer py-2 font-bold">新交接（{pending.length}）</summary><p className="mt-2 text-sm text-slate-500">接受後先加入你的工作建議。</p>{pending.slice(0, 3).map((a) => <Link key={a.id} className="mt-2 flex min-h-12 items-center justify-between gap-2 rounded-xl bg-indigo-50 p-3 text-sm font-semibold text-indigo-900" href={`/tasks/${a.resource_id}`}><span>{current.taskCatalog.find((t) => t.id === a.resource_id)?.title || "新工作交接"}</span><span className="shrink-0">查看／接受 →</span></Link>)}<Link href="/sharing" className="mt-2 inline-flex min-h-11 items-center text-sm font-bold text-indigo-700">查看全部交接 →</Link></details> : null}
      {decisions.length ? <details className="panel p-4"><summary className="min-h-11 cursor-pointer py-2 font-bold">等我決定（{decisions.length}）</summary>{decisions.slice(0, 3).map((task) => <Link key={task.id} className="mt-2 flex min-h-12 items-center justify-between rounded-xl bg-slate-50 p-3 text-sm font-semibold" href={`/tasks/${task.id}`}>{task.title}<ArrowRight className="h-4 w-4" /></Link>)}</details> : null}
    </div>:null}
    <div className="dl-tabtools">{nav}</div>
    {activeTab==="focus"?<details className="dl-support"><summary><ListChecks aria-hidden="true"/>任務工具、提醒同篩選</summary>{detailsReady?<div className="dl-support-body">
    <section className="grid grid-cols-3 gap-2 sm:gap-4" aria-label="我的工作概覽">
      <button type="button" className="simple-stat-card text-left" onClick={() => setActiveTab("today")}><span className="simple-stat-label"><CheckCircle2 className="h-4 w-4" />今日 Today</span><span className="simple-stat-number">{completed}<small>／{plan.planned.length}</small></span><span className="simple-progress-track"><span style={{ width: `${progress}%` }} /></span><span className="simple-stat-foot">已做完</span></button>
      <button type="button" className="simple-stat-card text-left" aria-pressed={summary === "waiting"} onClick={() => { setActiveTab("focus"); setSummary(summary === "waiting" ? null : "waiting"); }}><span className="simple-stat-label"><Clock3 className="h-4 w-4" />等回覆</span><span className="simple-stat-number">{waiting.length}</span><span className="simple-stat-foot break-words">{waiting[0] ? [waiting[0].waiting_for && `等 ${waiting[0].waiting_for}`,waiting[0].title].filter(Boolean).join(" · ") : "暫時冇等緊嘅工作"}</span></button>
      <button type="button" className="simple-stat-card text-left" aria-pressed={summary === "week"} onClick={() => { setActiveTab("focus"); setSummary(summary === "week" ? null : "week"); }}><span className="simple-stat-label"><CalendarDays className="h-4 w-4" />即將到期 · 14 日</span><span className="simple-stat-number">{upcoming.length}</span><span className="simple-stat-foot break-words">{upcoming[0] ? `${formatDate(upcoming[0].due_date)} · ${upcoming[0].title}` : "暫時冇即將到期嘅 Task"}</span></button>
    </section>
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1 basis-60">
          <p className="dl-tools-muted">Tags 可多選，符合其中一個就會顯示。</p>
          <div className="mt-1 flex min-w-0 gap-2 overflow-x-auto p-1" role="group" aria-label="Dashboard Tags">
            <button type="button" aria-pressed={allTagsChecked} className={`simple-tag-filter shrink-0 gap-1 ${allTagsChecked ? "is-active" : ""}`} onClick={() => setSelectedTags(selectAllTaskTags)}>
              {allTagsChecked ? <Check aria-hidden="true" className="h-3.5 w-3.5 shrink-0" /> : null}全部
            </button>
            {priority.catalog.map(tag => {
              const selected = isTaskTagFilterSelected(tagFilter, tag.id);
              return <button key={tag.id} type="button" aria-pressed={selected} data-tag-id={tag.id} className="simple-tag-filter task-tag-color shrink-0 gap-1" style={tagColors.get(tag.id)} onClick={() => setSelectedTags(previous => toggleTaskTagFilter(activeTaskTagFilter(previous, knownTagIds), tag.id, knownTagIds))}>
                <Check aria-hidden="true" className={`h-3.5 w-3.5 shrink-0 ${selected ? "" : "invisible"}`} />{tag.name}
              </button>;
            })}
            <button type="button" aria-pressed={tagFilter === "untagged"} className={`simple-tag-filter shrink-0 gap-1 ${tagFilter === "untagged" ? "is-active" : ""}`} onClick={() => setSelectedTags(previous => previous === "untagged" ? allTaskTags : "untagged")}>
              {tagFilter === "untagged" ? <Check aria-hidden="true" className="h-3.5 w-3.5 shrink-0" /> : null}未分類
            </button>
          </div>
        </div>
        <button type="button" className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl px-3 text-sm font-semibold ${quiet ? "bg-indigo-100 text-indigo-900" : "bg-slate-100 text-slate-600"}`} disabled={busy} aria-pressed={quiet} onClick={() => void toggleQuiet()}><BellOff className="h-4 w-4" />{quiet ? "安靜中" : "安靜模式"}</button>
      </div>
      {summary ? <section className="panel space-y-3 p-4" aria-label={summary === "waiting" ? "等回覆 Waiting" : "即將到期 · 14 日"}><h2 className="font-extrabold">{summary === "waiting" ? "等回覆 Waiting" : "即將到期 · 14 日"}</h2>{(summary === "waiting" ? waiting : upcoming).slice(0, 5).map((task) => {
        const promoted = summary === "week" ? priority.promotedTag(task) : undefined;
        return <Link key={task.id} href={`/tasks/${task.id}`} className="flex min-h-12 flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 p-3 text-sm font-semibold">
          <span className="min-w-0 break-words">{task.title}{summary === "waiting" && task.waiting_for ? <span className="mt-1 block text-xs font-normal text-slate-500">等 {task.waiting_for} · {task.waiting_on || "回覆"}</span> : null}</span>
          <span className="flex flex-wrap items-center gap-2 text-xs text-slate-500">{promoted ? <span data-tag-id={promoted.id} className="task-tag-color rounded-full px-2 py-0.5 font-bold" style={tagColors.get(promoted.id)}>自動升級 · {promoted.name}</span> : null}{formatDate(summary === "waiting" ? task.follow_up_date : task.due_date)}</span>
        </Link>;
      })}{!(summary === "waiting" ? waiting : upcoming).length ? <p className="text-sm text-slate-500">暫時冇相關工作。</p> : null}<button type="button" className="min-h-11 text-sm font-bold text-indigo-700" onClick={() => { setActiveTab("tasks"); setSummary(null); }}>打開完整清單 →</button></section> : null}
      {matches.map((task,i)=><SimpleTaskCard key={task.id} task={task} priority={priority} tagColors={tagColors} index={i} inToday={plannedIds.has(task.id)} busy={busy} onStart={()=>void start(task)} onComplete={()=>void complete(task)}/>)}
      {!showingAllTags&&!matches.length?<p className="dl-tools-muted">暫時冇符合所揀 Tags、可以開始嘅工作。</p>:null}
      <details className="panel p-4"><summary className="min-h-11 cursor-pointer py-2 font-bold text-slate-600">提醒及活動</summary><ReminderPanel reminders={current.reminders} participants={current.participants} currentUserId={current.currentUser.id} onChanged={reload} /></details>
    </div>:detailsSpare}</details>:null}
    {activeTab === "today" ? (detailsReady?<TodayAllTasks tasks={current.tasks} availableTasks={current.taskQueueCatalog} priorityRank={priority.rank} planning={current.planning} today={today} onChanged={reload} onStart={(task) => void start(task)} onComplete={complete} onBrowseTasks={() => setActiveTab("tasks")} />:detailsSpare) : null}
    {activeTab === "tasks" ? <div id="action-center-panel-tasks" role="tabpanel" aria-labelledby="action-center-tab-tasks">{detailsReady?<TaskActionList data={current} onChanged={reload} onTaskSaved={saved} showOverdue={showOverdue} onExitOverdue={()=>setShowOverdue(false)} sortByGrade={taskListGradeOrder} onToggleGradeSort={toggleTaskListOrder} />:detailsSpare}</div> : null}
    {focusTask ? <FocusMode task={focusTask} defaultMinutes={current.settings.focus_minutes ?? 25} currentUserId={current.currentUser.id} participants={current.participants} sharedTask={Boolean(focusTask.visibility && focusTask.visibility !== "private")} onClose={() => setFocusTask(null)} onChanged={() => void reload()} /> : null}
    <footer className="dl-footer"><span>日序 Dayline · 香港時間</span><span><i aria-hidden="true"/>今週配色：{weekNames[daylineWeek(today)]}</span></footer>
  </>;
}

function SimpleTaskCard({ task, priority, tagColors, index, inToday, busy, onStart, onComplete }: { task: Task; priority: TaskPriorityProjection; tagColors: ReturnType<typeof taskTagColors>; index: number; inToday: boolean; busy: boolean; onStart: () => void; onComplete: () => void }) {
  return <article className={`simple-focus-card ${index === 0 ? "is-now" : ""}`} aria-label={`${index === 0 ? "而家做" : "之後做"}：${task.title}`}>
    <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-extrabold uppercase tracking-wider text-indigo-600">{index === 0 ? "而家做 Now" : `之後做 Next ${index}`}</p><div className="flex min-w-0 flex-wrap gap-1">{priority.labels(task).slice(0,2).map(tag=><span key={tag.id} data-tag-id={tag.id} className="task-tag-color max-w-full break-words rounded-full px-3 py-1 text-xs font-bold" style={tagColors.get(tag.id)}>{tag.name}</span>)}</div></div>
    <Link href={`/tasks/${task.id}`} className={`mt-3 block break-words font-extrabold text-slate-950 hover:text-indigo-700 ${index === 0 ? "text-2xl sm:text-3xl" : "text-lg"}`}>{task.title}</Link>
    <p className="mt-3 break-words text-sm leading-6 text-slate-600">{taskVisibleNextAction(task) || starterSteps(task.title)[0]}</p>
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500"><span>Deadline：{task.due_date ? formatDate(task.due_date) : "未定"}</span><span>{task.custom_status_label || (task.status === "in_progress" ? "做緊" : "未開始")}</span>{!inToday ? <span>建議，未加入今日</span> : null}</div>
    <div className="mt-5 flex flex-wrap items-center gap-2"><Button disabled={busy} onClick={onStart}><Play className="h-4 w-4" />{index === 0 ? "開始做 Start" : "做呢件"}</Button><Button variant="secondary" disabled={busy} onClick={onComplete}><Check className="h-4 w-4" />{task.recurrence_rule_id ? "今次做完" : "做完 Done"}</Button><Link href={`/tasks/${task.id}`} className="ml-auto inline-flex min-h-11 items-center gap-1 px-2 text-sm font-semibold text-slate-600">詳情<ArrowRight className="h-4 w-4" /></Link></div>
  </article>;
}
