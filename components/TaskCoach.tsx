"use client";

import { useRef, useState } from "react";
import { askTaskCoach, type CoachMessage } from "@/lib/control-api";
import { Button } from "@/components/ui/Button";

export function TaskCoach({title, step, progress}: {title:string; step:string; progress:string}) {
  const [messages, setMessages] = useState<CoachMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);

  async function send() {
    if (lock.current || !draft.trim()) return;
    lock.current = true;
    setBusy(true);
    setError("");
    const conversation: CoachMessage[] = [...messages, {role:"user", content:draft.trim()}];
    try {
      const {reply} = await askTaskCoach({title:title.slice(0,2000), step:step.slice(0,2000), progress:progress.slice(0,2000), messages:conversation.slice(-9)});
      setMessages([...conversation, {role:"assistant",content:reply}]);
      setDraft("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "未能取得回覆，請再試。");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  return <details className="rounded-2xl bg-white p-4 text-slate-900">
    <summary className="cursor-pointer font-bold">同 AI 教練傾</summary>
    <p className="mt-2 text-sm">送出時會將任務標題、眼前步驟、上次進度同最近對話交畀 OpenAI。請略去個案身份資料。</p>
    <div role="log" aria-live="polite" className="space-y-2">{messages.map((m,i) =>
      <p key={i} className="mt-2 whitespace-pre-wrap break-words"><b>{m.role==="user"?"你":"教練"}　</b>{m.content}</p>)}</div>
    <form className="mt-3 space-y-2" onSubmit={e=>{e.preventDefault();void send();}}>
      <label className="block">你而家卡喺邊一步？
        <textarea className="field mt-1" maxLength={2000} value={draft} onChange={e=>setDraft(e.target.value)} disabled={busy} placeholder="例如：開咗 inbox，但搵唔到附件" />
      </label>
      <Button type="submit" disabled={busy || !draft.trim()}>{busy?"等緊教練回覆…":"問教練"}</Button>
      {error && <p role="alert">{error}</p>}
    </form>
  </details>;
}
