"use client";
import Link from "next/link";
import { Mic } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";

type Props = { taskId: string; userId: string };
type Phase = "loading" | "ready" | "saving" | "saved" | "read-error" | "write-error" | "conflict";
type Buffer = { text: string; saved: string; revision: string | null; lock: boolean; loaded: boolean; failed: boolean };

export function TaskWorkingDraft(props: Props) {
  return <Editor key={props.userId + ":" + props.taskId} {...props}/>;
}
function Editor({ taskId, userId }: Props) {
  const [open,setOpen] = useState(false), [text,setText] = useState("");
  const [phase,setPhase] = useState<Phase>("loading"), [message,setMessage] = useState("");
  const [attempt,setAttempt] = useState(0), [discard,setDiscard] = useState(false);
  const field = useId(), box = useRef<HTMLTextAreaElement>(null), mounted = useRef(true);
  const state = useRef<Buffer>({ text:"", saved:"", revision:null, lock:false, loaded:false, failed:false });
  const endpoint = "/api/task-working-draft?task=" + encodeURIComponent(taskId);
  const save = useCallback(async () => {
    const s = state.current, next = s.text.trim();
    if (!s.loaded || s.lock || s.failed || !next || next === s.saved.trim()) return;
    s.lock = true;
    if (mounted.current) { setPhase("saving"); setMessage(""); }
    try {
      const response = await fetch(endpoint,{method:"POST",credentials:"same-origin",cache:"no-store",keepalive:true,
        headers:{"Content-Type":"application/json","X-Dayline-Account":userId},body:JSON.stringify({text:next,revision:s.revision})});
      const value = await response.json();
      if (!response.ok || typeof value.revision !== "string") {
        s.failed = true;
        if (mounted.current) {
          setPhase(response.status === 409 ? "conflict" : "write-error");
          setMessage(value.error || "未能儲存。請保留文字，再試一次。");
        }
        return;
      }
      s.saved = next; s.revision = value.revision;
      if (mounted.current) { setPhase(s.text.trim() === next ? "saved" : "ready"); setDiscard(false); }
    } catch {
      s.failed = true;
      if (mounted.current) { setPhase("write-error"); setMessage("草稿未同步。請先保留呢個畫面，連線後再試。"); }
    } finally {
      s.lock = false;
      // Finish the latest text when an internal route change interrupted typing during a write.
      if (!mounted.current && !s.failed && s.text.trim() !== s.saved.trim()) void save();
    }
  },[endpoint,userId]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; void save(); };
  },[save]);
  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController(); let live = true;
    setPhase("loading"); setMessage(""); state.current.loaded = false;
    void (async () => {
      try {
        const response = await fetch(endpoint,{cache:"no-store",credentials:"same-origin",headers:{"X-Dayline-Account":userId},signal:ctrl.signal});
        const result = await response.json();
        if (!live) return;
        if (!response.ok || typeof result.text !== "string" || !(result.revision === null || typeof result.revision === "string")) {
          throw Error(result.error || "未能讀取，請重試。");
        }
        state.current = {text:result.text,saved:result.text,revision:result.revision,lock:false,loaded:true,failed:false};
        setText(result.text); setPhase("ready"); box.current?.focus();
      } catch (error) { if (live) { setPhase("read-error"); setMessage(error instanceof Error && error.message !== "Failed to fetch" ? error.message : "暫時讀唔到草稿。請重試。"); } }
    })();
    return () => { live = false; ctrl.abort(); };
  },[open,endpoint,userId,attempt]);
  const dirty = text.trim() !== state.current.saved.trim();
  useEffect(() => {
    if (!open || !dirty || phase !== "ready" || !text.trim()) return;
    const timer = window.setTimeout(() => void save(),950);
    return () => clearTimeout(timer);
  },[open,text,phase,dirty,save]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const flush = () => { if (document.visibilityState === "hidden") void save(); };
    window.addEventListener("beforeunload",warn); document.addEventListener("visibilitychange",flush);
    return () => { window.removeEventListener("beforeunload",warn); document.removeEventListener("visibilitychange",flush); };
  },[dirty,save]);
  const change = (next: string) => {
    state.current.text = next; setText(next);
    if (!state.current.failed && !state.current.lock) setPhase("ready");
  };
  function dismiss() {
    if (dirty) { setDiscard(true); return; }
    setOpen(false);
  }
  return <section className="no-print mt-3" aria-label="工作草稿">
    <button type="button" aria-expanded={open} aria-controls={field+"panel"} disabled={phase === "saving"}
      className="inline-flex min-h-11 items-center gap-2 rounded-lg px-2 font-semibold underline underline-offset-4"
      onClick={() => open ? dismiss() : setOpen(true)}><Mic aria-hidden="true" size={17}/>{open ? "收起草稿" : "講一句／寫草稿"}</button>
    {open && <div id={field+"panel"} className="panel mt-1 space-y-2 rounded-xl p-3 text-left">
      <label htmlFor={field} className="block font-bold">今次想寫低嘅第一句</label>
      <p className="text-sm">撳鍵盤咪高峰聽寫，或者直接打字。文字會自動存入你嘅筆記；唔會發送或隨任務分享。</p>
      <textarea id={field} ref={box} className="field min-h-24 w-full" placeholder="例如：我想同對方確認……"
        maxLength={10000} value={text} disabled={phase === "loading" || phase === "read-error"} onChange={e=>change(e.target.value)}/>
      <p role="status" className="text-sm">{message || (phase === "loading" ? "讀取草稿中…" : phase === "saving" ? "儲存中…" :
        dirty ? text.trim() ? "未同步" : "唔會清除之前儲存嘅筆記。要刪除請到「筆記」。" : phase === "saved" || state.current.revision ? "已儲存到我的筆記。" : "未有草稿。")}</p>
      {(phase === "ready" || phase === "write-error") && dirty && text.trim() && <button type="button" className="min-h-11 px-2 font-semibold underline"
        onClick={() => {state.current.failed=false;void save();}}>{phase === "write-error" ? "重試儲存" : "即時儲存"}</button>}
      {phase === "read-error" && <button type="button" className="min-h-11 px-2 font-semibold underline" onClick={()=>setAttempt(x=>x+1)}>重讀草稿</button>}
      {phase === "conflict" && <button type="button" className="min-h-11 px-2 font-semibold underline" onClick={()=>setDiscard(true)}>重讀選項</button>}
      {discard && <div className="flex flex-wrap items-center gap-2" role="group" aria-label="未儲存文字">
        <span className="text-sm">要保留未儲存嘅修改？</span>
        <button type="button" className="min-h-11 px-2 underline" onClick={()=>setDiscard(false)}>繼續編輯</button>
        <button type="button" className="min-h-11 px-2 underline" disabled={state.current.lock}
          onClick={()=>{const s=state.current;s.text=s.saved;setText(s.saved);setOpen(false);setDiscard(false);}}>放棄未儲存修改並收起</button>
      </div>}
      {!dirty && state.current.revision && <Link className="inline-flex min-h-11 items-center font-semibold underline" href="/workspace/note">到我的筆記</Link>}
    </div>}
  </section>;
}
