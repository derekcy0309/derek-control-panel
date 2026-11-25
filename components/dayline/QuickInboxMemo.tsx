"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
class MemoStatusError extends Error {}

// No browser storage, notifications or navigation. This is simply a narrow
// entry to the existing private Inbox; it never attaches to the current task.
export function QuickInboxMemo({ userId }: { userId: string }) {
  return <MemoForm key={userId} userId={userId}/>;
}
function MemoForm({ userId }: { userId: string }) {
  const [text,setText] = useState(""), [busy,setBusy] = useState(false);
  const [error,setError] = useState(""), [success,setSuccess] = useState(false);
  const lock = useRef(false), attempt = useRef<string | null>(null), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = text.trim();
    if (!title || lock.current) return;
    lock.current = true; setBusy(true); setSuccess(false); setError("");
    try {
      attempt.current ??= crypto.randomUUID();
      const body = new FormData();
      body.set("clientCaptureId",attempt.current); body.set("title",title);
      body.set("area","personal"); body.set("source","text");
      const response = await fetch("/api/quick-capture",{method:"POST",body,headers:{"X-Dayline-Account":userId},credentials:"same-origin",cache:"no-store"});
      const result = await response.json();
      if (!response.ok || typeof result.item?.id !== "string" || result.item?.owner_id !== userId || result.item?.item_type !== "inbox" || result.item?.title !== title) {
        const reason = response.status === 409 ? "未能確認儲存。請保留文字，並核對登入帳戶及收集箱內的備忘。" :
          response.status === 401 || response.status === 403 ? "未能確認登入權限，備忘尚未確認儲存。請保留文字，並重新登入。" :
          "未能確認備忘已儲存。文字仍在此頁，請重試。";
        throw new MemoStatusError(reason);
      }
      if (mounted.current) { attempt.current=null; setText(""); setSuccess(true); }
    } catch (err) {
      if (mounted.current) setError(err instanceof MemoStatusError ? err.message : "未能確認備忘已儲存。文字仍在此頁，請在恢復連線後重試。");
    } finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  return <details className="no-print rounded-xl border border-slate-200 p-3">
    <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold">暫記備忘</summary>
    <form onSubmit={submit} className="space-y-2">
      <label className="block text-sm font-semibold">稍後處理的事項
        <input className="field mt-1 block w-full" value={text} maxLength={500} readOnly={busy || Boolean(error)}
          onChange={e=>{setText(e.target.value);setSuccess(false);}} placeholder="輸入一句備忘，或使用鍵盤聽寫" />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button className="min-h-11 rounded-xl px-3 font-semibold underline" type="submit" disabled={busy || !text.trim()}>
          {busy ? "正在儲存…" : error ? "重試儲存" : "存入收集箱"}
        </button>
        {error && <button type="button" className="min-h-11 px-2 underline" onClick={()=>{
          // A previous write may already have reached Supabase. Keep this
          // UUID until acknowledged instead of silently creating another item.
          if (!navigator.clipboard) { setError("請選取並複製文字，再重試儲存。"); return; }
          void navigator.clipboard.writeText(text).then(()=>setError("已複製文字。你可以重試，以確認原有備忘是否已儲存。")).catch(()=>setError("請選取並複製文字，再重試儲存。"));
        }}>複製備忘</button>}
      </div>
      <p role="status" className="text-sm">{error || (success ? "已存入你的收集箱。你可以繼續目前的步驟。" : "只會存入你的收集箱，不會建立任務。")}</p>
    </form>
  </details>;
}
