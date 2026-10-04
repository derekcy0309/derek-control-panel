"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { controlAction } from "@/lib/control-api";
import { taskCategoryFor } from "@/lib/task-categories";
import type { TaskBreakdown } from "@/lib/ai/schemas";
import type { Task } from "@/lib/types";

type Suggestion = {
  id: string;
  title: string;
  minutes: number;
  selected: boolean;
  attempted: boolean;
  createdTaskId: string | null;
  error: string;
};

type Prepared = { prompt: string; chatGPTUrl: string; privacyMessage: string };

export function AIBreakdownPanel({ parent, childTasks, onCreated }: {
  parent: Task;
  childTasks: Task[];
  onCreated: (task: Task) => void;
}) {
  const [open, setOpen] = useState(false);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [responseText, setResponseText] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [eventId, setEventId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function prepare() {
    setOpen(true);
    if (prepared || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const body = await requestAssistant<Prepared>({ action: "prepare_breakdown", taskId: parent.id });
      if (!body.prompt || !body.chatGPTUrl) throw new Error("拆解指令不完整，請重試。");
      setPrepared(body);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "未能準備拆解指令，請重試。");
    } finally {
      setBusy(false);
    }
  }

  async function copyAndOpen() {
    if (!prepared) return;
    const chatWindow = window.open(prepared.chatGPTUrl, "_blank", "noopener,noreferrer");
    try {
      await navigator.clipboard.writeText(prepared.prompt);
      setMessage(chatWindow ? "Prompt 已複製。請在 ChatGPT 貼上並傳送，然後把回覆貼返嚟。" : "Prompt 已複製；請自行開啟 ChatGPT 並貼上。");
    } catch {
      setMessage("瀏覽器未允許複製；請在下方手動複製 Prompt。");
    }
  }

  async function importResponse(value = responseText) {
    if (!value.trim() || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const body = await requestAssistant<{ breakdown: TaskBreakdown; eventId: string; message: string }>({
        action: "import_breakdown", taskId: parent.id, responseText: value
      });
      if (!body.breakdown?.steps?.length || !body.eventId) throw new Error("AI 回覆資料不完整，請重試。");
      const existing = new Set(childTasks.map((child) => child.title.trim().toLocaleLowerCase()));
      setSuggestions(body.breakdown.steps.map((step) => ({
        id: crypto.randomUUID(), title: step.title, minutes: step.minutes,
        selected: !existing.has(step.title.trim().toLocaleLowerCase()),
        attempted: false, createdTaskId: null, error: ""
      })));
      setEventId(body.eventId);
      setMessage("已產生可修改的子任務草稿；未建立任何任務。相同名稱的現有子任務已預設不勾選。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "未能讀取 AI 回覆，請檢查格式再試。");
    } finally {
      setBusy(false);
    }
  }

  async function pasteFromClipboard() {
    try {
      const value = await navigator.clipboard.readText();
      setResponseText(value);
      await importResponse(value);
    } catch {
      setMessage("瀏覽器未允許讀取剪貼簿，請手動貼上回覆。");
    }
  }

  function updateSuggestion(id: string, changes: Partial<Suggestion>) {
    setSuggestions((current) => current.map((step) => step.id === id ? { ...step, ...changes } : step));
  }

  async function createSelected() {
    if (busy) return;
    const pending = suggestions.filter((step) => step.selected && !step.createdTaskId);
    if (!pending.length) { setMessage("請先勾選至少一項尚未建立的子任務。"); return; }
    if (pending.some((step) => !step.title.trim())) { setMessage("請先填妥已勾選的子任務名稱。"); return; }
    const existing = new Set(childTasks.map((child) => child.title.trim().toLocaleLowerCase()));
    const titles = pending.map((step) => step.title.trim().toLocaleLowerCase());
    if (titles.some((title) => existing.has(title)) || new Set(titles).size !== titles.length) {
      setMessage("已有同名子任務，請修改名稱或取消勾選，避免重複建立。");
      return;
    }
    setBusy(true);
    setMessage("");
    let createdCount = 0;
    let failed = false;
    for (const step of pending) {
      updateSuggestion(step.id, { attempted: true, error: "" });
      try {
        const result = await controlAction<{ task: Task }>("create_task", {
          clientRequestId: step.id,
          parentTaskId: parent.id,
          title: step.title.trim(),
          taskCategory: taskCategoryFor(parent),
          sourceType: parent.source_type,
          dueDate: parent.source_type === "duty_request" ? parent.due_date : null,
          estimatedMinutes: step.minutes
        });
        updateSuggestion(step.id, { createdTaskId: result.task.id });
        onCreated(result.task);
        createdCount += 1;
      } catch (error) {
        updateSuggestion(step.id, { error: error instanceof Error ? error.message : "未能建立，請重試。" });
        failed = true;
        break;
      }
    }
    if (createdCount && eventId) {
      await fetch("/api/chatgpt/task-assistant", {
        method: "PATCH", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId })
      }).catch(() => null);
    }
    setMessage(failed
      ? `已建立 ${createdCount} 項；有一項未能建立。請查看下方錯誤，再按確認重試；已建立的項目不會重複。`
      : `已建立 ${createdCount} 項子任務。原任務仍然保留。`);
    setBusy(false);
  }

  return <div className="mt-4 rounded-xl border border-violet-200 bg-violet-50/60 p-4">
    <Button type="button" onClick={() => open ? setOpen(false) : void prepare()} disabled={busy && !open}>
      {open ? "收起 AI 拆解" : "AI 幫我拆細"}
    </Button>
    {open ? <div className="mt-4 space-y-4">
      <p className="text-sm text-slate-700">AI 先建議細步驟；你可以改名、取消勾選，再確認建立。現有任務不會被改動。</p>
      {prepared ? <>
        <p className="rounded-lg bg-white p-3 text-xs text-slate-600">{prepared.privacyMessage} 只會處理這一項任務，不會送出整個工作清單。</p>
        <div className="flex flex-wrap items-center gap-3"><Button type="button" variant="secondary" onClick={() => void copyAndOpen()}>複製指令並開啟 ChatGPT</Button><a className="text-sm font-semibold text-indigo-700 underline" href={prepared.chatGPTUrl} target="_blank" rel="noreferrer">手動開啟 ChatGPT</a></div>
        <details className="rounded-lg border border-slate-200 bg-white p-3"><summary className="cursor-pointer text-sm font-semibold">送出前檢查／手動複製指令</summary><textarea className="field mt-2 min-h-32 text-xs" readOnly value={prepared.prompt} aria-label="給 ChatGPT 的拆解指令" /></details>
        <div className="rounded-lg bg-white p-3">
          <label className="label" htmlFor={`ai-breakdown-response-${parent.id}`}>貼回 ChatGPT 的 JSON 回覆</label>
          <textarea id={`ai-breakdown-response-${parent.id}`} className="field mt-2 min-h-28" value={responseText} onChange={(event) => setResponseText(event.target.value)} placeholder="在這裏貼上 AI 回覆" />
          <div className="mt-2 flex flex-wrap gap-2"><Button type="button" variant="secondary" disabled={busy} onClick={() => void pasteFromClipboard()}>從剪貼簿貼入</Button><Button type="button" variant="secondary" disabled={busy || !responseText.trim()} onClick={() => void importResponse()}>{busy ? "檢查中…" : "預覽建議"}</Button></div>
        </div>
      </> : <p className="text-sm text-slate-600">{busy ? "準備中…" : "未能準備指令。"} {!busy ? <button type="button" className="font-bold text-indigo-700 underline" onClick={() => void prepare()}>重試</button> : null}</p>}
      {suggestions.length ? <div className="rounded-lg bg-white p-3">
        <p className="font-bold text-slate-900">揀選要建立的子任務</p>
        <p className="mt-1 text-xs text-slate-600">每項預設由你跟進；之後可在子任務內再交俾其他人。一般子任務不另設到期日，以免重複提醒。</p>
        <ul className="mt-3 space-y-3">{suggestions.map((step, index) => <li key={step.id} className="rounded-lg border border-slate-200 p-3">
          <label className="flex min-h-11 items-center gap-2 text-sm font-semibold"><input type="checkbox" className="h-5 w-5" checked={step.selected} disabled={busy || Boolean(step.createdTaskId)} onChange={(event) => updateSuggestion(step.id, { selected: event.target.checked })} />第 {index + 1} 步 {step.createdTaskId ? "— 已建立" : ""}</label>
          <input className="field mt-2" aria-label={`第 ${index + 1} 項子任務名稱`} value={step.title} maxLength={250} disabled={busy || step.attempted || Boolean(step.createdTaskId)} onChange={(event) => updateSuggestion(step.id, { title: event.target.value })} />
          <span className="mt-1 block text-xs text-slate-500">AI 建議約 {step.minutes} 分鐘；建立前可修改名稱。</span>
          {step.error ? <p className="mt-2 text-xs text-amber-800" role="alert">{step.error}；為防重複，請直接重試。若要改名，可建立後在任務內修改。</p> : null}
        </li>)}</ul>
        <Button className="mt-3" type="button" disabled={busy || !suggestions.some((step) => step.selected && !step.createdTaskId)} onClick={() => void createSelected()}>{busy ? "建立中…" : "確認建立已勾選子任務"}</Button>
      </div> : null}
      {message ? <p className="rounded-lg bg-white p-3 text-sm text-slate-700" role="status">{message}</p> : null}
    </div> : null}
  </div>;
}

async function requestAssistant<T>(payload: Record<string, unknown>): Promise<T> {
  const response = await fetch("/api/chatgpt/task-assistant", {
    method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || "AI 拆解暫時不可用，請稍後重試。");
  return body;
}
