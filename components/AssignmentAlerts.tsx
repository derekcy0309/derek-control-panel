"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { controlAction, loadAssignmentAlerts } from "@/lib/control-api";
import { nextAssignmentAlert, type AssignmentAlert } from "@/lib/assignment-alerts";

export function AssignmentAlerts({ userId }: { userId: string | null }) {
  const [alert, setAlert] = useState<AssignmentAlert | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [seen, setSeen] = useState<Set<string>>(() => new Set());
  const [seenReady, setSeenReady] = useState(false);

  useEffect(() => {
    if (!userId) return;
    setSeenReady(false);
    try {
      const persistent = JSON.parse(localStorage.getItem(`dcp:assignment-alerts:v1:${userId}`) ?? "[]") as string[];
      const session = JSON.parse(sessionStorage.getItem(`dcp:assignment-alerts:v1:${userId}`) ?? "[]") as string[];
      setSeen(new Set([...persistent, ...session]));
    } catch { setSeen(new Set()); }
    setSeenReady(true);
  }, [userId]);

  const poll = useCallback(async () => {
    if (!userId || !seenReady || document.visibilityState === "hidden") return;
    try {
      const response = await loadAssignmentAlerts();
      if (response.currentUserId !== userId) return;
      if (response.quietModeUntil && Date.parse(response.quietModeUntil) > Date.now()) {
        setAlert(null);
        return;
      }
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
      setAlert(nextAssignmentAlert(response.assignments, userId, today, seen));
    } catch {
      // Assignment alerts are supplementary; task pages retain the full handoff state.
    }
  }, [userId, seen, seenReady]);

  useEffect(() => {
    void poll();
    const timer = window.setInterval(() => { void poll(); }, 20_000);
    const onVisible = () => { if (document.visibilityState === "visible") void poll(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [poll]);

  if (!alert || !userId) return null;
  const current = alert;
  function dismiss() {
    setSeen((previous) => new Set(previous).add(current.key));
    try {
      const storage = current.kind === "received" ? sessionStorage : localStorage;
      const key = `dcp:assignment-alerts:v1:${userId}`;
      const entries = JSON.parse(storage.getItem(key) ?? "[]") as string[];
      storage.setItem(key, JSON.stringify([...new Set([...entries, current.key])].slice(-500)));
    } catch { /* Storage can be disabled; the in-memory dismissal still works. */ }
    setAlert(null);
    setError("");
  }
  async function acknowledge() {
    setBusy(true);
    setError("");
    try {
      await controlAction("acknowledge_assignment", { id: current.assignmentId });
      dismiss();
      void poll();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "未能確認收到，請再試一次。");
    } finally {
      setBusy(false);
    }
  }

  const copy = current.kind === "received"
    ? { title: "有人交咗任務俾你", detail: "可先確認收到，之後再決定接受、要求補充或改期。" }
    : current.kind === "acknowledged"
      ? { title: "對方已確認收到", detail: "對方已見到交辦；仍可再決定是否接受跟進。" }
      : current.kind === "accepted"
        ? { title: "對方已接受跟進", detail: "你交出的任務已由對方接手。" }
      : { title: "已派任務接近限期", detail: `到期日：${current.dueDate ?? "未設定"}。可以向對方追問進度。` };
  return <aside className="fixed bottom-24 left-4 right-4 z-[80] rounded-2xl border-2 border-indigo-200 bg-white p-4 shadow-2xl sm:bottom-5 sm:left-auto sm:right-5 sm:w-96" role="status" aria-live="polite">
    <h2 className="text-lg font-extrabold text-slate-900">{copy.title}</h2>
    <p className="mt-1 text-sm leading-6 text-slate-700">{copy.detail}</p>
    <div className="mt-3 flex flex-wrap gap-2">
      {current.kind === "received" ? <Button type="button" disabled={busy} onClick={() => void acknowledge()}>{busy ? "確認中…" : "確認收到"}</Button> : null}
      <Link className="inline-flex min-h-11 items-center rounded-lg bg-slate-100 px-4 font-semibold text-slate-800" href={current.kind === "received" ? "/sharing?tab=pending" : `/tasks/${current.taskId}`} onClick={dismiss}>{current.kind === "received" ? "查看待確認交辦" : "查看任務"}</Link>
      <Button type="button" variant="ghost" onClick={dismiss}>{current.kind === "received" ? "稍後處理" : "知道了"}</Button>
    </div>
    {error ? <p className="mt-2 text-sm text-amber-900" role="alert">{error}</p> : null}
  </aside>;
}
