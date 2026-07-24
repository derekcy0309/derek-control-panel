"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CheckCircle2, CirclePause, Play, UserRoundCheck, UsersRound, WifiOff } from "lucide-react";
import { AuthGate } from "@/components/AuthGate";
import { LoadingState } from "@/components/LoadingState";
import { RestartCheckpointPanel } from "@/components/RestartCheckpointPanel";
import { Button } from "@/components/ui/Button";
import { useTaskCheckpoint } from "@/hooks/useTaskCheckpoint";
import { controlAction, loadBodyDouble } from "@/lib/control-api";
import type { BodyDoubleData, BodyDoubleParticipant, BodyDoubleSession, BodyDoubleTaskOption, TaskCheckpoint } from "@/lib/types";

const durations = [15, 20, 25, 45] as const;

export default function BodyDoublePage() {
  return <AuthGate><BodyDoubleContent /></AuthGate>;
}

function BodyDoubleContent() {
  const [data, setData] = useState<BodyDoubleData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(true);
  const [now, setNow] = useState(() => Date.now());

  async function reload(sessionId?: string, quiet = false) {
    if (!quiet) setLoading(true);
    try {
      const next = await loadBodyDouble(sessionId);
      setData(next);
      setError("");
    } catch (caught) {
      if (!quiet) setError(caught instanceof Error ? caught.message : "未能讀取共用專注時段。");
    } finally {
      if (!quiet) setLoading(false);
    }
  }

  useEffect(() => {
    setOnline(navigator.onLine);
    const onOnline = () => { setOnline(true); void reload(data?.session?.id, true); };
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    void reload();
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
    // The initial load should happen once; later refreshes are driven by the session effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const session = data?.session;
    if (!session || !["waiting", "running"].includes(session.status)) return;
    const current = session.participants.find((participant) => participant.is_current_user);
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    const refresh = window.setInterval(() => {
      if (!navigator.onLine) return;
      if (session.status === "running" && current && !["completed", "left"].includes(current.status)) {
        void controlAction("body_double_heartbeat", { sessionId: session.id })
          .then(() => reload(session.id, true))
          .catch(() => undefined);
        return;
      }
      void reload(session.id, true);
    }, 10_000);
    return () => { window.clearInterval(tick); window.clearInterval(refresh); };
  }, [data?.session]);

  async function createSession(values: { partnerUserId: string; taskId: string; durationMinutes: number; shareTaskTitle: boolean }) {
    setBusy(true);
    setMessage("");
    try {
      const result = await controlAction<{ sessionId: string }>("create_body_double", values);
      await reload(result.sessionId);
      setMessage("已邀請對方。你已準備好自己的任務，等對方選好後即可同步開始。");
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "未能建立共用專注時段。");
    } finally {
      setBusy(false);
    }
  }

  async function prepareSession(values: { taskId: string; shareTaskTitle: boolean }) {
    if (!data?.session) return;
    setBusy(true);
    setMessage("");
    try {
      await controlAction("prepare_body_double", { sessionId: data.session.id, ...values });
      await reload(data.session.id, true);
      setMessage("已準備好。對方準備好後，任何一方都可按同步開始。");
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "未能更新準備狀態。");
    } finally {
      setBusy(false);
    }
  }

  async function startSession() {
    if (!data?.session) return;
    setBusy(true);
    setMessage("");
    try {
      await controlAction("start_body_double", { sessionId: data.session.id });
      await reload(data.session.id, true);
      setMessage("已同步開始。每人只處理自己的下一步，毋須比較產量。");
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "未能同步開始。");
    } finally {
      setBusy(false);
    }
  }

  async function updatePresence(status: "running" | "paused" | "left") {
    if (!data?.session) return;
    setBusy(true);
    setMessage("");
    try {
      await controlAction("body_double_presence", { sessionId: data.session.id, status });
      await reload(data.session.id, true);
      setMessage(status === "paused" ? "已暫停你的部分；對方可以繼續自己的時段。" : status === "left" ? "你已離開；對方仍可繼續，不會被中斷。" : "已回到自己的共用專注時段。");
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "未能更新狀態。");
    } finally {
      setBusy(false);
    }
  }

  async function completeSession() {
    if (!data?.session) return;
    setBusy(true);
    setMessage("");
    try {
      await controlAction("complete_body_double", { sessionId: data.session.id });
      await reload(data.session.id, true);
      setMessage("你的 checkpoint 已確認。對方可按自己的節奏繼續或完成。");
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "未能完成你的共用專注時段。");
    } finally {
      setBusy(false);
    }
  }

  async function cancelSession() {
    if (!data?.session) return;
    setBusy(true);
    setMessage("");
    try {
      await controlAction("cancel_body_double", { sessionId: data.session.id });
      await reload(undefined, true);
      setMessage("已取消尚未開始的邀請；沒有任務或 checkpoint 被改動。");
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "未能取消邀請。");
    } finally {
      setBusy(false);
    }
  }

  if (loading || error || !data) return <LoadingState error={error} />;
  const session = data.session;

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <section className="panel flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="eyebrow">Body Double</p>
          <h1 className="mt-1 text-2xl font-bold">同步專注，各自完成自己的小一步</h1>
          <p className="muted mt-2 max-w-3xl text-sm leading-6">這是陪伴式專注，不是排名或監察。兩人可選不同任務、同時開始；一方暫停、離線或提早完成時，另一方仍可繼續。</p>
        </div>
        <div className={`inline-flex min-h-11 items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold ${online ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}>
          {online ? <UserRoundCheck className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}{online ? "已連線" : "目前離線；本地計時仍會繼續"}
        </div>
      </section>

      {message ? <p className="rounded-2xl bg-slate-100 p-4 text-sm font-semibold text-slate-700" role="status">{message}</p> : null}

      {!session ? <CreateSession data={data} busy={busy} onCreate={createSession} /> : (
        <SessionRoom
          data={data}
          session={session}
          busy={busy}
          online={online}
          now={now}
          onPrepare={prepareSession}
          onStart={startSession}
          onPresence={updatePresence}
          onComplete={completeSession}
          onCancel={cancelSession}
        />
      )}
    </div>
  );
}

function CreateSession({ data, busy, onCreate }: { data: BodyDoubleData; busy: boolean; onCreate: (values: { partnerUserId: string; taskId: string; durationMinutes: number; shareTaskTitle: boolean }) => Promise<void> }) {
  const [partnerUserId, setPartnerUserId] = useState(data.participants[0]?.user_id ?? "");
  const [taskId, setTaskId] = useState(data.availableTasks[0]?.id ?? "");
  const [durationMinutes, setDurationMinutes] = useState<number>(25);
  const [shareTaskTitle, setShareTaskTitle] = useState(false);
  const selectedTask = data.availableTasks.find((task) => task.id === taskId);

  useEffect(() => {
    if (!data.participants.some((participant) => participant.user_id === partnerUserId)) setPartnerUserId(data.participants[0]?.user_id ?? "");
    if (!data.availableTasks.some((task) => task.id === taskId)) setTaskId(data.availableTasks[0]?.id ?? "");
  }, [data.availableTasks, data.participants, partnerUserId, taskId]);

  return (
    <section className="panel grid gap-5 p-5 sm:p-6">
      <div>
        <p className="eyebrow">建立一節</p>
        <h2 className="mt-1 text-xl font-bold">先選一位夥伴和一件自己要做的事</h2>
        <p className="muted mt-2 text-sm leading-6">建立邀請不會開始計時，也不會改變任務的狀態、負責人或分享權限。</p>
      </div>
      {!data.participants.length ? <p className="rounded-xl bg-amber-50 p-4 text-sm font-semibold text-amber-900">未找到可用的 Derek／Suki 信任夥伴。請先確認雙方帳戶已啟用並保留信任連線。</p> : null}
      {!data.availableTasks.length ? <p className="rounded-xl bg-slate-100 p-4 text-sm font-semibold text-slate-700">暫時沒有可專注的任務。先到「任務」建立或恢復一項有清晰下一步的工作。</p> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <label><span className="label">專注夥伴</span><select className="field mt-2" value={partnerUserId} onChange={(event) => setPartnerUserId(event.target.value)} disabled={!data.participants.length || busy}>{data.participants.map((participant) => <option key={participant.user_id} value={participant.user_id}>{participant.display_name}</option>)}</select></label>
        <label><span className="label">我的任務</span><select className="field mt-2" value={taskId} onChange={(event) => setTaskId(event.target.value)} disabled={!data.availableTasks.length || busy}>{data.availableTasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}</select></label>
      </div>
      {selectedTask ? <TaskHint task={selectedTask} /> : null}
      <fieldset><legend className="label">共同時長</legend><div className="mt-2 flex flex-wrap gap-2">{durations.map((minutes) => <button key={minutes} type="button" className={`min-h-11 rounded-xl px-4 text-sm font-bold ${durationMinutes === minutes ? "bg-indigo-600 text-white" : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`} onClick={() => setDurationMinutes(minutes)} disabled={busy}>{minutes} 分鐘</button>)}</div></fieldset>
      <label className="flex min-h-12 items-start gap-3 rounded-xl border border-slate-200 p-3"><input className="mt-1 h-4 w-4" type="checkbox" checked={shareTaskTitle} onChange={(event) => setShareTaskTitle(event.target.checked)} disabled={busy} /><span><span className="block font-semibold">這一節向對方顯示我的任務名稱</span><span className="muted mt-0.5 block text-xs leading-5">只分享名稱，不會分享文件、連結、notes 或 checkpoint 資源；不選擇時，對方只會看到「私人任務」。</span></span></label>
      <div className="flex flex-wrap gap-3"><Button disabled={busy || !partnerUserId || !taskId} onClick={() => void onCreate({ partnerUserId, taskId, durationMinutes, shareTaskTitle })}><UsersRound className="h-5 w-5" />{busy ? "建立中…" : "建立共用專注邀請"}</Button><Link className="inline-flex min-h-11 items-center justify-center rounded-lg px-4 py-2 font-semibold text-slate-700 hover:bg-slate-100" href="/tasks">查看任務</Link></div>
    </section>
  );
}

function SessionRoom({ data, session, busy, online, now, onPrepare, onStart, onPresence, onComplete, onCancel }: {
  data: BodyDoubleData;
  session: BodyDoubleSession;
  busy: boolean;
  online: boolean;
  now: number;
  onPrepare: (values: { taskId: string; shareTaskTitle: boolean }) => Promise<void>;
  onStart: () => Promise<void>;
  onPresence: (status: "running" | "paused" | "left") => Promise<void>;
  onComplete: () => Promise<void>;
  onCancel: () => Promise<void>;
}) {
  const self = session.participants.find((participant) => participant.is_current_user);
  const other = session.participants.find((participant) => !participant.is_current_user);
  const bothReady = session.participants.length === 2 && session.participants.every((participant) => participant.status === "ready");
  const secondsLeft = secondsRemaining(session, now);
  const timeFinished = session.status === "running" && secondsLeft === 0;
  const selfTask = data.availableTasks.find((task) => task.id === self?.task_id) ?? (self?.task_id ? { id: self.task_id, title: self.task_label ?? "我的任務", next_action: null, definition_of_done: null, estimated_minutes: null, status: "in_progress" } : null);

  return (
    <div className="space-y-5">
      <section className="panel overflow-hidden">
        <div className="border-b border-slate-200 p-5 sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><p className="eyebrow">共用專注時段</p><h2 className="mt-1 text-xl font-bold">{session.status === "waiting" ? "先各自準備好" : session.status === "running" ? "正在同步專注" : session.status === "ended" ? "這一節已完整結束" : "這個邀請已取消"}</h2><p className="muted mt-2 text-sm">{session.duration_minutes} 分鐘 · 建立於 {formatTime(session.created_at)}</p></div><div className="rounded-xl bg-indigo-50 px-4 py-3 text-center"><p className="text-xs font-bold text-indigo-700">共同計時</p><p className="mt-1 font-mono text-3xl font-bold tabular-nums text-indigo-950">{formatClock(secondsLeft)}</p></div></div>
          {session.status === "running" && timeFinished ? <p className="mt-4 rounded-xl bg-indigo-50 p-3 text-sm font-semibold text-indigo-900">時間已到。請先記下 checkpoint，再按「完成我的時段」；任務本身不會被自動完成。</p> : null}
          {!online ? <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm font-semibold text-amber-900">你目前離線。畫面會保留倒數和 checkpoint 草稿；回復連線後可安全同步狀態。</p> : null}
        </div>
        <div className="grid divide-y divide-slate-200 sm:grid-cols-2 sm:divide-x sm:divide-y-0">{session.participants.map((participant) => <ParticipantCard key={participant.user_id} participant={participant} now={now} />)}</div>
      </section>

      {session.status === "waiting" && self?.status === "invited" ? <PrepareTask tasks={data.availableTasks} busy={busy} otherName={other?.display_name ?? "對方"} onPrepare={onPrepare} /> : null}

      {session.status === "waiting" && self?.status === "ready" ? <section className="panel p-5"><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-bold">你已準備好</p><p className="muted mt-1 text-sm">{other?.status === "ready" ? "雙方已選好任務，任何一方都可以同步開始。" : `等待 ${other?.display_name ?? "對方"} 選好自己的任務。`}</p></div>{bothReady ? <Button disabled={busy || !online} onClick={() => void onStart()}><Play className="h-5 w-5" />同步開始</Button> : null}</div>{session.created_by_id === data.currentUser.id ? <Button className="mt-4" variant="ghost" disabled={busy} onClick={() => void onCancel()}>取消尚未開始的邀請</Button> : null}</section> : null}

      {session.status === "waiting" && self?.status === "invited" && session.created_by_id === data.currentUser.id ? <Button variant="ghost" disabled={busy} onClick={() => void onCancel()}>取消尚未開始的邀請</Button> : null}

      {session.status === "running" && self && !["completed", "left"].includes(self.status) ? <section className="panel flex flex-wrap gap-3 p-5"><Button variant="secondary" disabled={busy || !online} onClick={() => void onPresence(self.status === "paused" ? "running" : "paused")}><CirclePause className="h-5 w-5" />{self.status === "paused" ? "繼續我的部分" : "暫停我的部分"}</Button><Button variant="ghost" disabled={busy || !online} onClick={() => void onPresence("left")}>提早離開（對方可繼續）</Button>{selfTask ? <Link className="inline-flex min-h-11 items-center justify-center rounded-lg px-4 py-2 font-semibold text-slate-700 hover:bg-slate-100" href="/tasks">查看任務詳情</Link> : null}</section> : null}

      {session.status === "running" && selfTask && self && !["completed", "left"].includes(self.status) ? <CompletionCheckpoint task={selfTask} userId={data.currentUser.id} busy={busy} timeFinished={timeFinished} onComplete={onComplete} /> : null}

      {session.status === "running" && self?.status === "completed" ? <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-950"><div className="flex items-center gap-2 font-bold"><CheckCircle2 className="h-5 w-5" />你已完成自己的部分</div><p className="mt-2 text-sm leading-6">你的 checkpoint 已安全保存。{other?.status === "completed" ? "雙方都已完成，這一節會自動結束。" : "對方仍可按自己的節奏繼續。"}</p></section> : null}
      {session.status === "running" && self?.status === "left" ? <section className="rounded-2xl bg-slate-100 p-5 text-slate-800"><p className="font-bold">你已離開這一節</p><p className="muted mt-1 text-sm">對方的專注不會被中斷。你可在「任務」稍後繼續並留下 checkpoint。</p></section> : null}
      {session.status === "ended" ? <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-950"><div className="flex items-center gap-2 font-bold"><CheckCircle2 className="h-5 w-5" />雙方已完成自己的時段</div><p className="mt-2 text-sm">已保存各自的 checkpoint；任務沒有被系統自動完成或重新指派。</p></section> : null}
      {session.status === "cancelled" ? <section className="rounded-2xl bg-slate-100 p-5 text-slate-800"><p className="font-bold">邀請已取消</p><p className="muted mt-1 text-sm">沒有任務、分享設定或 checkpoint 被改動。</p></section> : null}
    </div>
  );
}

function PrepareTask({ tasks, busy, otherName, onPrepare }: { tasks: BodyDoubleTaskOption[]; busy: boolean; otherName: string; onPrepare: (values: { taskId: string; shareTaskTitle: boolean }) => Promise<void> }) {
  const [taskId, setTaskId] = useState(tasks[0]?.id ?? "");
  const [shareTaskTitle, setShareTaskTitle] = useState(false);
  useEffect(() => { if (!tasks.some((task) => task.id === taskId)) setTaskId(tasks[0]?.id ?? ""); }, [taskId, tasks]);
  return <section className="panel grid gap-4 p-5 sm:p-6"><div><p className="eyebrow">你的準備</p><h3 className="mt-1 text-xl font-bold">選好自己的任務再說「準備好」</h3><p className="muted mt-2 text-sm">{otherName} 已建立這一節；你選的內容不會改動任務狀態。</p></div><label><span className="label">我的任務</span><select className="field mt-2" value={taskId} onChange={(event) => setTaskId(event.target.value)} disabled={!tasks.length || busy}>{tasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}</select></label><label className="flex min-h-12 items-start gap-3 rounded-xl border border-slate-200 p-3"><input className="mt-1 h-4 w-4" type="checkbox" checked={shareTaskTitle} onChange={(event) => setShareTaskTitle(event.target.checked)} disabled={busy} /><span><span className="block font-semibold">在這一節向對方顯示任務名稱</span><span className="muted mt-0.5 block text-xs leading-5">不會分享 task 資源、notes、網址或 checkpoint。</span></span></label><div><Button disabled={busy || !taskId} onClick={() => void onPrepare({ taskId, shareTaskTitle })}><UserRoundCheck className="h-5 w-5" />{busy ? "準備中…" : "我準備好了"}</Button></div></section>;
}

function ParticipantCard({ participant, now }: { participant: BodyDoubleParticipant; now: number }) {
  const label = participant.is_current_user ? "我" : participant.display_name;
  const connection = participant.is_current_user ? "你的狀態" : partnerConnection(participant, now);
  const status = participantStatusLabel(participant.status);
  return <article className="p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[.14em] text-slate-400">{participant.is_current_user ? "我的任務" : "夥伴任務"}</p><h3 className="mt-1 text-lg font-bold">{label}</h3></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">{status}</span></div><p className="mt-4 min-h-12 rounded-xl bg-slate-50 p-3 text-sm font-semibold leading-6 text-slate-800">{participant.task_label ?? (participant.status === "invited" ? "尚未選擇任務" : "私人任務")}</p><p className="mt-3 text-xs font-semibold text-slate-500">{connection}</p>{participant.completed_at ? <p className="mt-2 text-xs font-semibold text-emerald-700">已於 {formatTime(participant.completed_at)} 記下 checkpoint</p> : null}</article>;
}

function CompletionCheckpoint({ task, userId, busy, timeFinished, onComplete }: { task: BodyDoubleTaskOption; userId: string; busy: boolean; timeFinished: boolean; onComplete: () => Promise<void> }) {
  const checkpoint = useTaskCheckpoint(task.id, userId);
  const [message, setMessage] = useState("");

  async function save() {
    const saved = await checkpoint.saveCheckpoint({
      completedSummary: checkpoint.form.completedSummary || (timeFinished ? "完成了這一節可處理的部分" : "提早完成了這一節可處理的部分"),
      currentPosition: checkpoint.form.currentPosition || "已記下目前位置，方便下次接續",
      nextMinimumStep: checkpoint.form.nextMinimumStep || task.next_action || ""
    });
    setMessage(saved ? "Checkpoint 已安全保存。現在可完成自己的共用專注時段。" : "Checkpoint 尚未保存，請保留這個畫面並重試。");
  }

  function resumeFromCheckpoint(savedCheckpoint: TaskCheckpoint) {
    if (savedCheckpoint.next_minimum_step) checkpoint.updateField("nextMinimumStep", savedCheckpoint.next_minimum_step);
  }

  return <section className="rounded-3xl bg-[#111318] p-1 text-white"><div className="px-5 pt-5 sm:px-7"><p className="text-xs font-bold uppercase tracking-[.14em] text-indigo-300">你的收尾</p><h3 className="mt-1 text-xl font-bold">先留下 checkpoint，再決定今節到此為止</h3><p className="mt-2 text-sm leading-6 text-white/65">不論是否完成整項任務，只要寫下目前位置，下次就能由這裡接續。這不會把任務標示為已完成。</p></div><div className="px-5 pb-5 sm:px-7"><RestartCheckpointPanel latest={checkpoint.latest} history={checkpoint.history} form={checkpoint.form} loading={checkpoint.loading} loadError={checkpoint.loadError} saveError={checkpoint.saveError} saveState={checkpoint.saveState} busy={busy} editorOpen exitRequested={false} sharedTask={false} authorName={() => "我"} onUpdate={checkpoint.updateField} onResume={resumeFromCheckpoint} onRetryLoad={() => void checkpoint.retryLoad()} onRetrySave={() => void checkpoint.flushDraft()} onSave={() => void save()} onCancelExit={() => undefined} />{message ? <p className="mt-4 rounded-xl bg-white/[.08] p-3 text-sm font-semibold text-white/80" role="status">{message}</p> : null}<div className="mt-5 flex flex-wrap gap-3"><Button className="bg-emerald-500 text-slate-950 hover:bg-emerald-400" disabled={busy || checkpoint.saveState === "saving"} onClick={() => void onComplete()}><CheckCircle2 className="h-5 w-5" />完成我的時段</Button><Link className="inline-flex min-h-11 items-center justify-center rounded-lg px-4 py-2 text-base font-semibold text-white/70 hover:bg-white/10" href="/tasks">稍後再處理</Link></div></div></section>;
}

function TaskHint({ task }: { task: BodyDoubleTaskOption }) {
  return <div className="rounded-xl bg-slate-50 p-4 text-sm"><p className="font-bold text-slate-800">這一節先做：{task.next_action || "請先在任務內補上清晰下一步"}</p>{task.definition_of_done ? <p className="muted mt-2 leading-6">完成標準：{task.definition_of_done}</p> : null}</div>;
}

function secondsRemaining(session: BodyDoubleSession, now: number) {
  if (!session.started_at) return session.duration_minutes * 60;
  return Math.max(0, Math.ceil((Date.parse(session.started_at) + session.duration_minutes * 60_000 - now) / 1000));
}

function formatClock(seconds: number) { return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`; }
function formatTime(value: string) { return new Intl.DateTimeFormat("zh-HK", { timeZone: "Asia/Hong_Kong", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value)); }
function participantStatusLabel(status: BodyDoubleParticipant["status"]) { return ({ invited: "待準備", ready: "已準備", running: "專注中", paused: "已暫停", completed: "已完成", left: "已離開" })[status]; }
function partnerConnection(participant: BodyDoubleParticipant, now: number) {
  if (participant.status === "completed") return "已完成自己的時段";
  if (participant.status === "left") return "已離開；你仍可繼續";
  if (!participant.last_seen_at || now - Date.parse(participant.last_seen_at) > 30_000) return "暫時未連線；你仍可繼續";
  return participant.status === "paused" ? "對方暫停了自己的部分" : "對方已連線";
}
