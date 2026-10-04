"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { controlAction } from "@/lib/control-api";
import { currentTaskStep } from "@/lib/task-steps";
import type { TaskStep, TaskStepStatus } from "@/lib/types";

const statusLabels: Record<TaskStepStatus, string> = {
  todo: "待做",
  waiting: "等待結果",
  later: "稍後處理",
  done: "已完成"
};

export function TaskStepPanel({ taskId, steps, canDelete, onChanged, closed = false, allowCreate = true }: {
  taskId: string;
  steps: TaskStep[];
  canDelete: boolean;
  onChanged: () => void;
  closed?: boolean;
  allowCreate?: boolean;
}) {
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [waitingForId, setWaitingForId] = useState<string | null>(null);
  const [waitingNote, setWaitingNote] = useState("");
  const [followUpDate, setFollowUpDate] = useState("");
  const current = currentTaskStep(steps);
  const doneCount = steps.filter((step) => step.status === "done").length;

  async function createStep() {
    const nextTitle = title.trim();
    if (!nextTitle || busy) return;
    setBusy(true);
    setError("");
    try {
      await controlAction("create_task_step", { taskId, title: nextTitle });
      setTitle("");
      onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "未能儲存細步驟；輸入內容仍在，請再試。");
    } finally {
      setBusy(false);
    }
  }

  async function changeStep(step: TaskStep, status: TaskStepStatus, options?: { waitingNote?: string; followUpDate?: string }) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await controlAction("update_task_step", {
        id: step.id,
        expectedUpdatedAt: step.updated_at,
        status,
        ...options
      });
      setWaitingForId(null);
      setWaitingNote("");
      setFollowUpDate("");
      onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "未能更新細步驟；請再試。");
    } finally {
      setBusy(false);
    }
  }

  async function renameStep(step: TaskStep) {
    const nextTitle = window.prompt("修改細步驟", step.title)?.trim();
    if (!nextTitle || nextTitle === step.title || busy) return;
    setBusy(true);
    setError("");
    try {
      await controlAction("update_task_step", { id: step.id, expectedUpdatedAt: step.updated_at, title: nextTitle });
      onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "未能修改細步驟；請再試。");
    } finally {
      setBusy(false);
    }
  }

  async function removeStep(step: TaskStep) {
    if (busy || !window.confirm("移除這個細步驟？原任務不會受影響。")) return;
    setBusy(true);
    setError("");
    try {
      await controlAction("delete_task_step", { id: step.id });
      onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "未能移除細步驟；請再試。");
    } finally {
      setBusy(false);
    }
  }

  function waitingForm(step: TaskStep) {
    if (waitingForId !== step.id) return null;
    return (
      <div className="mt-3 grid gap-2 rounded-xl bg-white p-3">
        <label className="text-sm font-semibold text-slate-700" htmlFor={`waiting-note-${step.id}`}>等緊甚麼結果？（可留空）</label>
        <input id={`waiting-note-${step.id}`} className="field" value={waitingNote} maxLength={1000} onChange={(event) => setWaitingNote(event.target.value)} placeholder="例如：等對方回覆後繼續" />
        <label className="text-sm font-semibold text-slate-700" htmlFor={`waiting-date-${step.id}`}>下次查看日期（可留空）</label>
        <input id={`waiting-date-${step.id}`} className="field" type="date" value={followUpDate} onChange={(event) => setFollowUpDate(event.target.value)} />
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={busy} onClick={() => void changeStep(step, "waiting", { waitingNote, followUpDate })}>儲存等待狀態</Button>
          <Button type="button" variant="ghost" onClick={() => setWaitingForId(null)}>取消</Button>
        </div>
      </div>
    );
  }

  function controls(step: TaskStep) {
    if (closed) return null;
    return (
      <div className="mt-3 flex flex-wrap gap-2">
        {step.status !== "done" ? <Button type="button" variant="success" disabled={busy} onClick={() => void changeStep(step, "done")}>完成這一步</Button> : null}
        {step.status !== "waiting" && step.status !== "done" ? <Button type="button" variant="secondary" disabled={busy} onClick={() => { setWaitingForId(step.id); setWaitingNote(""); setFollowUpDate(""); }}>等待結果</Button> : null}
        {step.status === "todo" || step.status === "waiting" ? <Button type="button" variant="secondary" disabled={busy} onClick={() => void changeStep(step, "later")}>稍後再做</Button> : null}
        {step.status === "waiting" || step.status === "later" || step.status === "done" ? <Button type="button" variant="secondary" disabled={busy} onClick={() => void changeStep(step, "todo")}>重新開始這一步</Button> : null}
        <Button type="button" variant="ghost" disabled={busy} onClick={() => void renameStep(step)}>改名</Button>
        {canDelete ? <Button type="button" variant="ghost" disabled={busy} onClick={() => void removeStep(step)}>移除</Button> : null}
      </div>
    );
  }

  return (
    <section className="mt-4 rounded-2xl border border-indigo-200 bg-indigo-50/70 p-4" aria-label="任務細步驟">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-lg font-extrabold text-slate-900">{allowCreate ? "把任務拆細" : "舊有細步驟"}</h3>
          <p className="mt-1 text-sm text-slate-600">{allowCreate ? "每步只需 5–25 分鐘；完成一步不會結束整項任務。" : "現有細步驟會保留；之後請用上方「新增子任務」拆解及指派。"}</p>
        </div>
        {steps.length ? <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-indigo-800">{doneCount}／{steps.length} 步已完成</span> : null}
      </div>
      {current ? (
        <div className="mt-4 rounded-xl border border-indigo-200 bg-white p-4">
          <p className="text-xs font-extrabold text-indigo-700">{current.status === "waiting" ? "等結果中，未到下一步" : "現在只做這一步"} · {statusLabels[current.status]}</p>
          <p className="mt-2 text-lg font-bold leading-7 text-slate-950">{current.title}</p>
          {current.status === "waiting" ? <p className="mt-2 text-sm text-slate-700">{current.waiting_note || "等結果後再繼續"}{current.follow_up_date ? ` · ${current.follow_up_date} 再查看` : ""}</p> : null}
          {controls(current)}
          {waitingForm(current)}
        </div>
      ) : steps.length ? <p className="mt-3 rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-900">所有細步驟已完成。原任務仍然開放；如整項任務已完成，請另外按「完成任務」。</p> : <p className="mt-3 text-sm text-slate-700">先寫第一個最容易開始的動作，例如「打開相關文件」。</p>}
      {!closed && allowCreate ? (
        <form className="mt-4 flex flex-col gap-2 sm:flex-row" onSubmit={(event) => { event.preventDefault(); void createStep(); }}>
          <label className="sr-only" htmlFor={`new-step-${taskId}`}>新增細步驟</label>
          <input id={`new-step-${taskId}`} className="field min-w-0 flex-1 bg-white" value={title} maxLength={250} onChange={(event) => setTitle(event.target.value)} placeholder="下一個最小動作是甚麼？" />
          <Button type="submit" disabled={busy || !title.trim() || steps.length >= 50}>{busy ? "儲存中…" : "加入細步驟"}</Button>
        </form>
      ) : null}
      {steps.length > 1 ? (
        <details className="mt-4 rounded-xl bg-white/80 p-3">
          <summary className="cursor-pointer text-sm font-bold text-slate-700">查看其他步驟（{steps.length - (current ? 1 : 0)}）</summary>
          <ol className="mt-3 space-y-2">
            {steps.filter((step) => step.id !== current?.id).map((step) => (
              <li className="rounded-lg border border-slate-200 bg-white p-3" key={step.id}>
                <p className="text-xs font-bold text-slate-500">{statusLabels[step.status]}</p>
                <p className="mt-1 text-sm font-semibold text-slate-800">{step.title}</p>
                {step.status === "waiting" && step.waiting_note ? <p className="mt-1 text-xs text-slate-600">{step.waiting_note}{step.follow_up_date ? ` · ${step.follow_up_date} 再查看` : ""}</p> : null}
                {controls(step)}
                {waitingForm(step)}
              </li>
            ))}
          </ol>
        </details>
      ) : null}
      {error ? <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm font-semibold text-amber-900" role="alert">{error}</p> : null}
    </section>
  );
}
