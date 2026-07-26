"use client";

import { useEffect, useState } from "react";
import {
  Brain,
  Check,
  ChevronDown,
  ChevronUp,
  Clipboard,
  ClipboardPaste,
  ExternalLink,
  ShieldCheck,
  Sparkles
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { controlAction } from "@/lib/control-api";
import type { TaskAnalysis } from "@/lib/ai/schemas";
import type { Task } from "@/lib/types";

type PreparedPackage = {
  chatGPTUrl: string;
  prompt: string;
  privacyMessage: string;
  quickSuggestion: TaskAnalysis;
};

export function TaskAIAnalysisPanel({
  task,
  currentUserId,
  onChanged
}: {
  task: Task;
  currentUserId: string;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [prepared, setPrepared] = useState<PreparedPackage | null>(null);
  const [analysis, setAnalysis] = useState<TaskAnalysis | null>(null);
  const [analysisEventId, setAnalysisEventId] = useState("");
  const [responseText, setResponseText] = useState("");
  const [preparing, setPreparing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const owner = (task.owner_id ?? task.user_id) === currentUserId;

  useEffect(() => {
    if (!open || prepared) return;
    const controller = new AbortController();

    async function loadPackage() {
      setPreparing(true);
      setMessage("");
      try {
        const response = await fetch("/api/chatgpt/task-assistant", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "prepare", taskId: task.id }),
          signal: controller.signal
        });
        const body = await response.json().catch(() => ({})) as Partial<PreparedPackage> & { error?: string };
        if (!response.ok || !body.prompt || !body.chatGPTUrl || !body.quickSuggestion) {
          throw new Error(body.error || "未能準備 ChatGPT 分析內容。");
        }
        setPrepared({
          chatGPTUrl: body.chatGPTUrl,
          prompt: body.prompt,
          privacyMessage: body.privacyMessage || "請在送出前快速檢查內容。",
          quickSuggestion: body.quickSuggestion
        });
      } catch (error) {
        if (!controller.signal.aborted) {
          setMessage(error instanceof Error ? error.message : "未能準備 ChatGPT 分析內容。");
        }
      } finally {
        if (!controller.signal.aborted) setPreparing(false);
      }
    }

    void loadPackage();
    return () => controller.abort();
  }, [open, prepared, task.id]);

  async function openChatGPT() {
    if (!prepared) return;
    setMessage("");
    const copyPromise = copyText(prepared.prompt);
    const chatWindow = window.open(prepared.chatGPTUrl, "_blank", "noopener,noreferrer");
    const copied = await copyPromise;
    if (copied && chatWindow) {
      setMessage("完整 Prompt 已複製，ChatGPT 已開啟；貼上並傳送，完成後複製回覆返嚟。");
    } else if (copied) {
      setMessage("Prompt 已複製。瀏覽器阻止開新頁，請用下面「再次開啟 ChatGPT」連結。");
    } else {
      setMessage("ChatGPT 已開啟，但瀏覽器未允許自動複製；請使用「複製 Prompt」後再貼上。");
    }
  }

  async function copyPrompt() {
    if (!prepared) return;
    const copied = await copyText(prepared.prompt);
    setMessage(copied ? "完整 Prompt 已複製。" : "瀏覽器未允許複製，請手動選取下面內容。");
  }

  async function pasteFromClipboard() {
    setMessage("");
    if (!navigator.clipboard?.readText) {
      setMessage("瀏覽器未允許讀取剪貼簿，請長按下面輸入框貼上 ChatGPT 回覆。");
      return;
    }
    try {
      const value = await navigator.clipboard.readText();
      if (!value.trim()) throw new Error("剪貼簿未有內容。");
      setResponseText(value);
      await importResponse(value);
    } catch (error) {
      setMessage(error instanceof Error
        ? error.message
        : "未能讀取剪貼簿，請手動貼上 ChatGPT 回覆。");
    }
  }

  async function importResponse(value = responseText) {
    if (!value.trim()) {
      setMessage("請先貼上 ChatGPT 回覆。");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/chatgpt/task-assistant", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "import",
          taskId: task.id,
          responseText: value
        })
      });
      const body = await response.json().catch(() => ({})) as {
        analysis?: TaskAnalysis;
        eventId?: string;
        error?: string;
        message?: string;
      };
      if (!response.ok || !body.analysis || !body.eventId) {
        throw new Error(body.error || "未能讀取 ChatGPT 回覆。");
      }
      setAnalysis(body.analysis);
      setAnalysisEventId(body.eventId);
      setMessage(body.message || "已讀取建議；尚未修改任務。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "未能讀取 ChatGPT 回覆。");
    } finally {
      setBusy(false);
    }
  }

  async function applySuggestion() {
    if (!analysis || !owner) return;
    if (!window.confirm("確認套用 ChatGPT 建議？系統只會更新完成標準、下一步同預計時間；不會完成、延期、分享或加入 Calendar。")) return;
    setBusy(true);
    setMessage("");
    try {
      await controlAction("update_task", {
        id: task.id,
        changes: {
          definition_of_done: analysis.clarifiedOutcome,
          next_action: analysis.firstTenMinutes,
          estimated_minutes: analysis.estimatedMinutes
        }
      });
      if (analysisEventId) {
        await fetch("/api/chatgpt/task-assistant", {
          method: "PATCH",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ eventId: analysisEventId })
        }).catch(() => null);
      }
      setMessage("已按你確認更新完成標準、下一步同預計時間。");
      onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "未能套用建議。");
    } finally {
      setBusy(false);
    }
  }

  const preview = analysis ?? prepared?.quickSuggestion ?? null;
  const previewIsChatGPT = Boolean(analysis);

  return (
    <section className="mt-4 overflow-hidden rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50 via-white to-indigo-50">
      <div className="flex flex-wrap items-center justify-between gap-2 p-3">
        <button
          className="flex min-h-11 items-center gap-2 text-left text-sm font-extrabold text-slate-900"
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
          aria-controls={`chatgpt-task-assistant-${task.id}`}
        >
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-white text-violet-700 shadow-sm">
            <Brain className="h-4 w-4" />
          </span>
          ChatGPT 最省力分析
          <span className="rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-extrabold text-emerald-800">零額外 API 費</span>
          {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        {open ? (
          <Button type="button" disabled={!prepared || preparing} onClick={() => void openChatGPT()}>
            <ExternalLink className="h-4 w-4" />
            {preparing ? "準備中…" : "複製並開啟 ChatGPT"}
          </Button>
        ) : null}
      </div>

      {open ? (
        <div className="border-t border-violet-100 p-4" id={`chatgpt-task-assistant-${task.id}`}>
          <div className="grid gap-3 md:grid-cols-3">
            <Step number="1" title="系統先整理" detail="自動遮罩常見敏感資料，並寫好完整分析指令。" />
            <Step number="2" title="ChatGPT 幫你做" detail="撳一下複製 Prompt 及開啟 ChatGPT，直接貼上傳送。" />
            <Step number="3" title="貼回及確認" detail="一鍵讀剪貼簿、驗證格式、預覽後安全套用。" />
          </div>

          {prepared ? (
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs leading-5 text-emerald-900">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{prepared.privacyMessage} ChatGPT 只收到呢一項任務，不會收到完整 backlog。</span>
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="button" variant="secondary" disabled={!prepared || preparing} onClick={() => void copyPrompt()}>
              <Clipboard className="h-4 w-4" />複製 Prompt
            </Button>
            {prepared ? (
              <a
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-white px-4 py-2 text-base font-semibold text-slate-800 ring-1 ring-slate-200 transition hover:bg-slate-50"
                href={prepared.chatGPTUrl}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink className="h-4 w-4" />再次開啟 ChatGPT
              </a>
            ) : null}
          </div>

          {prepared ? (
            <details className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
              <summary className="cursor-pointer text-xs font-bold text-slate-600">送出前查看／手動複製 Prompt</summary>
              <textarea
                className="field mt-3 min-h-36 resize-y font-mono text-xs leading-5"
                readOnly
                value={prepared.prompt}
                aria-label="準備給 ChatGPT 的 Prompt"
              />
            </details>
          ) : null}

          <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-extrabold text-slate-900">將 ChatGPT 完成結果貼返嚟</p>
                <p className="mt-1 text-xs text-slate-500">最快方法：在 ChatGPT 複製整段回覆，再撳右邊按鈕。</p>
              </div>
              <Button type="button" variant="secondary" disabled={busy} onClick={() => void pasteFromClipboard()}>
                <ClipboardPaste className="h-4 w-4" />從剪貼簿貼入並預覽
              </Button>
            </div>
            <textarea
              className="field mt-3 min-h-32 resize-y font-mono text-xs leading-5"
              value={responseText}
              onChange={(event) => setResponseText(event.target.value)}
              placeholder="如瀏覽器不允許讀剪貼簿，請在這裏貼上 ChatGPT 回覆…"
              aria-label="ChatGPT 回覆"
            />
            <Button className="mt-2" type="button" variant="secondary" disabled={busy || !responseText.trim()} onClick={() => void importResponse()}>
              <Sparkles className="h-4 w-4" />{busy ? "讀取中…" : "檢查回覆並預覽"}
            </Button>
          </div>

          {preview ? (
            <div className={`mt-4 rounded-2xl border p-4 ${previewIsChatGPT ? "border-violet-200 bg-white" : "border-slate-200 bg-slate-50/80"}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="eyebrow">{previewIsChatGPT ? "CHATGPT 建議預覽" : "系統即時後備建議"}</p>
                {!previewIsChatGPT ? <span className="text-[11px] font-semibold text-slate-500">未貼回 ChatGPT 前先有一個可開始步驟</span> : null}
              </div>
              <p className="mt-2 text-sm font-bold text-slate-900">完成標準：{preview.clarifiedOutcome}</p>
              <ol className="mt-3 space-y-2">
                {preview.fastestPath.map((step, index) => (
                  <li className="flex gap-3 text-sm text-slate-700" key={`${index}-${step.action}`}>
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-violet-100 text-xs font-extrabold text-violet-700">{index + 1}</span>
                    <span>
                      <span className="font-semibold">{step.action}</span>
                      <span className="ml-2 text-xs text-slate-500">約 {step.minutes} 分鐘</span>
                    </span>
                  </li>
                ))}
              </ol>
              <div className="mt-3 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">
                <span className="font-extrabold">依家先做：</span>{preview.firstTenMinutes}
              </div>
              <p className="mt-3 text-xs leading-5 text-slate-600">
                <span className="font-bold">停手位：</span>{preview.stopCondition}
              </p>
              {preview.effortReductionTips.length ? (
                <ul className="mt-2 space-y-1 text-xs leading-5 text-slate-600">
                  {preview.effortReductionTips.map((tip, index) => <li key={`${index}-${tip}`}>• {tip}</li>)}
                </ul>
              ) : null}
              {preview.warnings.length ? (
                <ul className="mt-3 rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-900">
                  {preview.warnings.map((warning, index) => <li key={`${index}-${warning}`}>• {warning}</li>)}
                </ul>
              ) : null}
              {previewIsChatGPT && owner ? (
                <Button className="mt-3" type="button" variant="success" disabled={busy} onClick={() => void applySuggestion()}>
                  <Check className="h-4 w-4" />套用完成標準、第一步同估時
                </Button>
              ) : previewIsChatGPT ? (
                <p className="mt-3 text-xs text-slate-500">你可以查看建議，但只有任務擁有人可以修改內容。</p>
              ) : null}
            </div>
          ) : null}

          {message ? (
            <p className="mt-3 rounded-xl bg-white p-3 text-xs font-semibold leading-5 text-slate-700" role="status">{message}</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function Step({ number, title, detail }: { number: string; title: string; detail: string }) {
  return (
    <div className="flex gap-3 rounded-xl bg-white/80 p-3">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-violet-600 text-xs font-extrabold text-white">{number}</span>
      <div>
        <p className="text-xs font-extrabold text-slate-900">{title}</p>
        <p className="mt-1 text-xs leading-5 text-slate-600">{detail}</p>
      </div>
    </div>
  );
}

async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    return copied;
  }
}
