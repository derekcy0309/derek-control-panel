"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, CirclePause, Clock3, FilePenLine, Play, X } from "lucide-react";
import { RestartCheckpointPanel } from "@/components/RestartCheckpointPanel";
import { FocusSessionHistory } from "@/components/FocusSessionHistory";
import { TaskResourcePack } from "@/components/TaskResourcePack";
import { Button } from "@/components/ui/Button";
import { hasCheckpointContent } from "@/lib/checkpoints";
import { controlAction } from "@/lib/control-api";
import type { Task, TaskCheckpoint } from "@/lib/types";
import { useTaskCheckpoint } from "@/hooks/useTaskCheckpoint";

type FocusModeProps = {
  task: Task;
  defaultMinutes?: number;
  participants?: Array<{ user_id: string; display_name: string }>;
  sharedTask?: boolean;
  onClose: () => void;
  onChanged: () => void;
};

export function FocusMode({
  task,
  defaultMinutes = 25,
  participants = [],
  sharedTask = false,
  onClose,
  onChanged
}: FocusModeProps) {
  const [duration, setDuration] = useState(defaultMinutes);
  const [secondsLeft, setSecondsLeft] = useState(defaultMinutes * 60);
  const [running, setRunning] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [message, setMessage] = useState("");
  const [blockedReason, setBlockedReason] = useState("缺資料");
  const [activeStep, setActiveStep] = useState(task.next_action ?? "");
  const [editorOpen, setEditorOpen] = useState(false);
  const [exitRequested, setExitRequested] = useState(false);
  const [busy, setBusy] = useState(false);
  const [historyVersion, setHistoryVersion] = useState(0);
  const notificationIdRef = useRef<string | null>(null);
  const focusSessionIdRef = useRef<string | null>(null);
  const focusClientSessionIdRef = useRef<string | null>(null);
  const checkpoint = useTaskCheckpoint(task.id);
  const { flushDraft, saveState } = checkpoint;

  useEffect(() => {
    if (!running || secondsLeft <= 0) return;
    const id = window.setInterval(() => setSecondsLeft((value) => Math.max(0, value - 1)), 1000);
    return () => clearInterval(id);
  }, [running, secondsLeft]);

  useEffect(() => {
    if (secondsLeft > 0 || !hasStarted) return;
    setRunning(false);
    void pauseFocusHistory();
    setEditorOpen(true);
    setMessage("這一節已完成。記下目前位置，讓下次可以直接接續。");
    void completeFocusReminder();
    // The transition only happens once when the timer reaches zero.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasStarted, secondsLeft]);

  useEffect(() => {
    function flushWhenHidden() {
      if (document.visibilityState === "hidden") void flushDraft();
    }
    function warnBeforeUnload(event: BeforeUnloadEvent) {
      if (!["pending", "saving", "error"].includes(saveState)) return;
      event.preventDefault();
      event.returnValue = "";
    }
    document.addEventListener("visibilitychange", flushWhenHidden);
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => {
      document.removeEventListener("visibilitychange", flushWhenHidden);
      window.removeEventListener("beforeunload", warnBeforeUnload);
    };
  }, [flushDraft, saveState]);

  const clock = useMemo(
    () => `${String(Math.floor(secondsLeft / 60)).padStart(2, "0")}:${String(secondsLeft % 60).padStart(2, "0")}`,
    [secondsLeft]
  );

  function changeDuration(minutes: number) {
    setDuration(minutes);
    setSecondsLeft(minutes * 60);
    setRunning(false);
  }

  async function start(requestedStep?: string) {
    const nextStep = requestedStep?.trim() || activeStep.trim() || task.next_action?.trim() || "";
    if (!nextStep) {
      setMessage("開始前先加入一個清晰、可見的下一步。");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const changes: Record<string, unknown> = { status: "in_progress", last_progress_at: new Date().toISOString() };
      if (!task.next_action?.trim()) changes.next_action = nextStep;
      await controlAction("update_task", { id: task.id, changes });
      const historyIssue = await startOrResumeFocusHistory();
      setActiveStep(nextStep);
      setHasStarted(true);
      setRunning(true);
      setEditorOpen(false);
      setExitRequested(false);
      await scheduleFocusReminder();
      if (historyIssue) setMessage(historyIssue);
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "未能開始專注時段。");
    } finally {
      setBusy(false);
    }
  }

  function elapsedMinutes() {
    const thisSession = Math.max(1, duration - Math.ceil(secondsLeft / 60));
    return Math.max(task.actual_minutes ?? 0, thisSession);
  }

  async function pause() {
    setRunning(false);
    void cancelFocusReminder();
    setExitRequested(false);
    setEditorOpen(true);
    setBusy(true);
    try {
      const [taskResult, historyResult] = await Promise.allSettled([
        controlAction("update_task", { id: task.id, changes: { actual_minutes: elapsedMinutes() } }),
        pauseFocusHistory()
      ]);
      if (taskResult.status === "rejected") throw taskResult.reason;
      onChanged();
      setMessage(historyResult.status === "rejected" ? "已暫停並記錄任務時間；專注歷史暫時未能更新。" : "已暫停並記錄這段實際時間。草稿會自動保存，你可以先記下目前位置。");
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "已暫停，但未能記錄這段實際時間。可在任務表單補回。");
    } finally {
      setBusy(false);
    }
  }

  function requestClose() {
    if (!hasStarted && !hasCheckpointContent(checkpoint.form)) {
      onClose();
      return;
    }
    setRunning(false);
    void pauseFocusHistory();
    void cancelFocusReminder();
    setExitRequested(true);
    setEditorOpen(true);
    setMessage("離開前留下 checkpoint，避免下次重新搜尋工作位置。");
  }

  async function saveCheckpointFromPanel() {
    setBusy(true);
    const shouldClose = exitRequested;
    const saved = await checkpoint.saveCheckpoint();
    setBusy(false);
    if (!saved) {
      setMessage("Checkpoint 尚未儲存，請保留此畫面並重試。");
      return;
    }
    setMessage("Checkpoint 已安全儲存。");
    setEditorOpen(false);
    setExitRequested(false);
    if (shouldClose) {
      const historyIssue = await finishFocusHistory("partial", saved.id);
      if (historyIssue) setMessage(historyIssue);
      onClose();
    }
  }

  async function complete() {
    setRunning(false);
    await cancelFocusReminder();
    setBusy(true);
    const saved = await checkpoint.saveCheckpoint({
      completedSummary: checkpoint.form.completedSummary || "已完成目前專注步驟",
      currentPosition: checkpoint.form.currentPosition || "已到達這一步的完成標準"
    });
    if (!saved) {
      setBusy(false);
      setEditorOpen(true);
      setMessage("Checkpoint 尚未儲存，所以任務未被標記完成。請重試。");
      return;
    }
    try {
      await controlAction("update_task", {
        id: task.id,
        changes: {
          status: "done",
          actual_minutes: elapsedMinutes()
        }
      });
      const historyIssue = await finishFocusHistory("completed", saved.id);
      if (historyIssue) setMessage(historyIssue);
      onChanged();
      onClose();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Checkpoint 已儲存，但未能更新任務狀態。");
      setBusy(false);
    }
  }

  async function block() {
    setRunning(false);
    await cancelFocusReminder();
    setBusy(true);
    const saved = await checkpoint.saveCheckpoint({
      currentPosition: checkpoint.form.currentPosition || "工作已暫停，等待處理阻塞",
      nextMinimumStep: checkpoint.form.nextMinimumStep || activeStep || task.next_action || "",
      blockedReason
    });
    if (!saved) {
      setBusy(false);
      setEditorOpen(true);
      setMessage("Checkpoint 尚未儲存，所以任務未被標記受阻。請重試。");
      return;
    }
    try {
      await controlAction("update_task", { id: task.id, changes: { status: "blocked", blocked_reason: blockedReason } });
      const historyIssue = await finishFocusHistory("interrupted", saved.id, blockedReason);
      if (historyIssue) setMessage(historyIssue);
      onChanged();
      onClose();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Checkpoint 已儲存，但未能更新任務狀態。");
      setBusy(false);
    }
  }

  function resumeFromCheckpoint(savedCheckpoint: TaskCheckpoint) {
    const nextStep = savedCheckpoint.next_minimum_step?.trim();
    if (!nextStep) return;
    setActiveStep(nextStep);
    void start(nextStep);
  }

  function authorName(authorId: string) {
    return participants.find((participant) => participant.user_id === authorId)?.display_name ?? "任務參與者";
  }

  async function startOrResumeFocusHistory() {
    try {
      if (focusSessionIdRef.current) {
        const resumed = await controlAction<{ session: { id: string; status: string } }>("resume_focus_session", { sessionId: focusSessionIdRef.current });
        if (resumed.session.status === "running") {
          setHistoryVersion((value) => value + 1);
          return "";
        }
        focusSessionIdRef.current = null;
        focusClientSessionIdRef.current = null;
      }
      focusClientSessionIdRef.current ??= crypto.randomUUID();
      const started = await controlAction<{ session: { id: string } }>("start_focus_session", {
        clientSessionId: focusClientSessionIdRef.current,
        taskId: task.id,
        plannedMinutes: duration
      });
      focusSessionIdRef.current = started.session.id;
      setHistoryVersion((value) => value + 1);
      return "";
    } catch {
      return "專注已開始；歷史記錄暫時未能開始，計時與任務不受影響。";
    }
  }

  async function pauseFocusHistory() {
    if (!focusSessionIdRef.current) return;
    const result = await controlAction("pause_focus_session", { sessionId: focusSessionIdRef.current });
    if (result) setHistoryVersion((value) => value + 1);
  }

  async function finishFocusHistory(status: "completed" | "partial" | "interrupted", checkpointId: string, blockReason?: string) {
    if (!focusSessionIdRef.current) return "";
    try {
      await controlAction("finish_focus_session", { sessionId: focusSessionIdRef.current, status, checkpointId, blockReason });
      focusSessionIdRef.current = null;
      focusClientSessionIdRef.current = null;
      setHistoryVersion((value) => value + 1);
      return "";
    } catch {
      return "Checkpoint 與任務已儲存；專注歷史暫時未能完成記錄。";
    }
  }

  async function scheduleFocusReminder() {
    await cancelFocusReminder();
    const sessionKey = crypto.randomUUID();
    const deliverAt = new Date(Date.now() + Math.max(1, secondsLeft) * 1000).toISOString();
    try {
      const result = await controlAction<{ deliveryId: string | null }>("schedule_focus_notification", {
        taskId: task.id,
        sessionKey,
        deliverAt
      });
      notificationIdRef.current = result.deliveryId;
    } catch {
      notificationIdRef.current = null;
      setMessage("專注時段已開始；伺服器提醒暫時未能安排，畫面計時仍會正常運作。");
    }
  }

  async function cancelFocusReminder() {
    const deliveryId = notificationIdRef.current;
    notificationIdRef.current = null;
    if (!deliveryId) return;
    await controlAction("cancel_focus_notification", { deliveryId }).catch(() => undefined);
  }

  async function completeFocusReminder() {
    const deliveryId = notificationIdRef.current;
    notificationIdRef.current = null;
    if (!deliveryId) return;
    try {
      const result = await controlAction<{ changed: boolean }>("complete_local_notification", { deliveryId });
      if (!result.changed || !("Notification" in window) || Notification.permission !== "granted" || !("serviceWorker" in navigator)) return;
      const registration = await navigator.serviceWorker.ready;
      await registration.showNotification("專注時段完成", {
        body: "時間到了，記下 checkpoint 方便下次接續",
        icon: "/icon",
        badge: "/icon",
        tag: `dcp-${deliveryId}`,
        data: { path: "/", deliveryId }
      });
    } catch {
      // Server-side dispatch remains the fallback if the local completion cannot be recorded.
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex min-h-[100dvh] flex-col overflow-y-auto bg-[#111318] text-white" role="dialog" aria-modal="true" aria-label="專注模式">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-white/10 bg-[#111318]/95 px-4 py-3 backdrop-blur sm:px-8">
        <div>
          <p className="text-xs font-bold uppercase tracking-[.16em] text-indigo-300">專注模式</p>
          <p className="mt-1 text-sm text-white/60">只處理眼前這一步</p>
        </div>
        <button className="grid min-h-11 min-w-11 place-items-center rounded-xl hover:bg-white/10" onClick={requestClose} aria-label="離開專注模式">
          <X className="h-5 w-5" />
        </button>
      </header>
      <main className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-8">
        <h1 className="text-2xl font-bold leading-tight sm:text-4xl">{task.title}</h1>

        <RestartCheckpointPanel
          latest={checkpoint.latest}
          history={checkpoint.history}
          form={checkpoint.form}
          loading={checkpoint.loading}
          loadError={checkpoint.loadError}
          saveError={checkpoint.saveError}
          saveState={checkpoint.saveState}
          busy={busy}
          editorOpen={editorOpen}
          exitRequested={exitRequested}
          sharedTask={sharedTask}
          authorName={authorName}
          onUpdate={checkpoint.updateField}
          onResume={resumeFromCheckpoint}
          onRetryLoad={() => void checkpoint.retryLoad()}
          onRetrySave={() => void checkpoint.flushDraft()}
          onSave={() => void saveCheckpointFromPanel()}
          onCancelExit={() => {
            setExitRequested(false);
            setMessage("你仍在專注模式；草稿會繼續自動保存。");
          }}
        />

        <TaskResourcePack taskId={task.id} focus />

        <div className="mt-7 flex flex-wrap gap-2">
          {[15, 25, 45].map((minutes) => (
            <button
              key={minutes}
              className={`min-h-11 rounded-xl px-4 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50 ${duration === minutes ? "bg-white text-slate-900" : "bg-white/8 text-white/70 hover:bg-white/12"}`}
              onClick={() => changeDuration(minutes)}
              disabled={running || busy}
            >
              {minutes} 分鐘
            </button>
          ))}
        </div>
        <p className="mt-5 font-mono text-5xl font-bold tabular-nums tracking-tight sm:text-7xl" aria-live="polite">{clock}</p>
        <section className="mt-6 rounded-2xl border border-white/10 bg-white/[.06] p-5">
          <p className="text-xs font-bold uppercase tracking-[.14em] text-indigo-300">現在做</p>
          <p className="mt-2 text-lg font-semibold leading-8">{activeStep || "請先返回任務加入下一步"}</p>
          {task.definition_of_done ? (
            <>
              <p className="mt-5 text-xs font-bold uppercase tracking-[.14em] text-white/45">完成定義</p>
              <p className="mt-2 leading-7 text-white/75">{task.definition_of_done}</p>
            </>
          ) : null}
        </section>
        {message ? <p className="mt-4 rounded-xl bg-amber-400/15 p-3 text-sm font-semibold text-amber-100" role="status">{message}</p> : null}
        <div className="mt-6 flex flex-wrap gap-3">
          {running ? (
            <Button variant="secondary" onClick={() => void pause()} disabled={busy}><CirclePause className="h-5 w-5" />暫停並記錄</Button>
          ) : (
            <Button onClick={() => void start()} disabled={busy}><Play className="h-5 w-5" />{secondsLeft < duration * 60 ? "繼續" : "開始"}</Button>
          )}
          <Button variant="secondary" onClick={() => { setEditorOpen(true); setExitRequested(false); }} disabled={busy}>
            <FilePenLine className="h-5 w-5" />記錄進度
          </Button>
          <Button variant="success" onClick={() => void complete()} disabled={busy}><Check className="h-5 w-5" />完成</Button>
        </div>
        <details className="mt-7 rounded-2xl border border-white/10 p-4">
          <summary className="flex min-h-11 cursor-pointer items-center text-sm font-bold text-white/65">遇到阻礙</summary>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <select className="field border-white/15 bg-white/10 text-white" value={blockedReason} onChange={(event) => setBlockedReason(event.target.value)}>
              <option className="text-slate-900">缺資料</option>
              <option className="text-slate-900">等人回覆</option>
              <option className="text-slate-900">不知道怎樣做</option>
              <option className="text-slate-900">任務太大</option>
              <option className="text-slate-900">沒有時間</option>
              <option className="text-slate-900">今日能量不足</option>
              <option className="text-slate-900">應該交辦</option>
              <option className="text-slate-900">其他</option>
            </select>
            <Button variant="secondary" onClick={() => void block()} disabled={busy}><Clock3 className="h-5 w-5" />記錄並標記受阻</Button>
          </div>
        </details>
        <FocusSessionHistory taskId={task.id} refreshKey={historyVersion} />
      </main>
    </div>
  );
}
