"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, CirclePause, Clock3, Play, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { controlAction } from "@/lib/control-api";
import type { Task } from "@/lib/types";

export function FocusMode({ task, defaultMinutes = 25, onClose, onChanged }: { task: Task; defaultMinutes?: number; onClose: () => void; onChanged: () => void }) {
  const [duration, setDuration] = useState(defaultMinutes);
  const [secondsLeft, setSecondsLeft] = useState(defaultMinutes * 60);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("");
  const [blockedReason, setBlockedReason] = useState("缺資料");

  useEffect(() => { if (!running || secondsLeft <= 0) return; const id = window.setInterval(() => setSecondsLeft((value) => value - 1), 1000); return () => clearInterval(id); }, [running, secondsLeft]);
  const clock = useMemo(() => `${String(Math.floor(secondsLeft / 60)).padStart(2, "0")}:${String(secondsLeft % 60).padStart(2, "0")}`, [secondsLeft]);

  function changeDuration(minutes: number) { setDuration(minutes); setSecondsLeft(minutes * 60); setRunning(false); }

  async function start() {
    if (!task.next_action?.trim()) { setMessage("開始前先加入一個清晰、可見的下一步。"); return; }
    await controlAction("update_task", { id: task.id, changes: { status: "in_progress", last_progress_at: new Date().toISOString() } });
    setRunning(true); onChanged();
  }

  async function complete() {
    await controlAction("update_task", { id: task.id, changes: { status: "done", actual_minutes: Math.max(1, duration - Math.ceil(secondsLeft / 60)) } });
    onChanged(); onClose();
  }

  async function block() {
    await controlAction("update_task", { id: task.id, changes: { status: "blocked", blocked_reason: blockedReason } });
    onChanged(); onClose();
  }

  return (
    <div className="fixed inset-0 z-[80] flex min-h-[100dvh] flex-col bg-[#111318] text-white" role="dialog" aria-modal="true" aria-label="專注模式">
      <header className="flex items-center justify-between border-b border-white/10 px-4 py-3 sm:px-8"><div><p className="text-xs font-bold uppercase tracking-[.16em] text-indigo-300">專注模式</p><p className="mt-1 text-sm text-white/60">只處理眼前這一步</p></div><button className="grid min-h-11 min-w-11 place-items-center rounded-xl hover:bg-white/10" onClick={onClose} aria-label="離開專注模式"><X className="h-5 w-5" /></button></header>
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-5 py-8 sm:px-8">
        <div className="mb-5 flex flex-wrap gap-2">{[15,25,45].map((minutes) => <button key={minutes} className={`min-h-11 rounded-xl px-4 text-sm font-bold ${duration === minutes ? "bg-white text-slate-900" : "bg-white/8 text-white/70 hover:bg-white/12"}`} onClick={() => changeDuration(minutes)}>{minutes} 分鐘</button>)}</div>
        <p className="font-mono text-5xl font-bold tabular-nums tracking-tight sm:text-7xl" aria-live="polite">{clock}</p>
        <h1 className="mt-8 text-2xl font-bold leading-tight sm:text-4xl">{task.title}</h1>
        <section className="mt-6 rounded-2xl border border-white/10 bg-white/[.06] p-5"><p className="text-xs font-bold uppercase tracking-[.14em] text-indigo-300">現在做</p><p className="mt-2 text-lg font-semibold leading-8">{task.next_action || "請先返回任務加入下一步"}</p>{task.definition_of_done ? <><p className="mt-5 text-xs font-bold uppercase tracking-[.14em] text-white/45">完成定義</p><p className="mt-2 leading-7 text-white/75">{task.definition_of_done}</p></> : null}</section>
        {message ? <p className="mt-4 rounded-xl bg-amber-400/15 p-3 text-sm font-semibold text-amber-100" role="alert">{message}</p> : null}
        <div className="mt-6 flex flex-wrap gap-3">{running ? <Button variant="secondary" onClick={() => setRunning(false)}><CirclePause className="h-5 w-5" />暫停</Button> : <Button onClick={start}><Play className="h-5 w-5" />{secondsLeft < duration * 60 ? "繼續" : "開始"}</Button>}<Button variant="success" onClick={complete}><Check className="h-5 w-5" />完成</Button></div>
        <details className="mt-7 rounded-2xl border border-white/10 p-4"><summary className="cursor-pointer text-sm font-bold text-white/65">遇到阻礙</summary><div className="mt-4 flex flex-col gap-3 sm:flex-row"><select className="field border-white/15 bg-white/10 text-white" value={blockedReason} onChange={(event) => setBlockedReason(event.target.value)}><option className="text-slate-900">缺資料</option><option className="text-slate-900">等人回覆</option><option className="text-slate-900">不知道怎樣做</option><option className="text-slate-900">任務太大</option><option className="text-slate-900">沒有時間</option><option className="text-slate-900">今日能量不足</option><option className="text-slate-900">應該交辦</option><option className="text-slate-900">其他</option></select><Button variant="danger" onClick={block}><Clock3 className="h-5 w-5" />標記受阻</Button></div></details>
      </main>
    </div>
  );
}
