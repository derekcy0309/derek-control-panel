"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { addBriefDays, briefDate, briefTime } from "@/lib/calendar-brief";
import { CALENDAR_REFRESH_MS, DEFAULT_TRAVEL_MINUTES, MAX_TRAVEL_MINUTES, travelMinutes, workStopAt, type StopSnapshot } from "@/lib/work-stop";

// Only revalidate when visible. The ticking countdown itself never calls the API.
export function useVisibleCalendarRefresh(refresh:()=>void,enabled:boolean){
  useEffect(()=>{
    if(!enabled)return;
    let last=Date.now();
    const check=()=>{if(document.visibilityState==="visible" && Date.now()-last>=CALENDAR_REFRESH_MS){last=Date.now();refresh();}};
    const id=window.setInterval(check,60_000);
    document.addEventListener("visibilitychange",check);window.addEventListener("online",check);
    return ()=>{window.clearInterval(id);document.removeEventListener("visibilitychange",check);window.removeEventListener("online",check);};
  },[enabled,refresh]);
}

function stamp(time:number,now:number){
  const day=briefDate(new Date(time)),today=briefDate(new Date(now));
  const prefix=day===today?"":day===addBriefDays(today,1)?"明天 ":day===addBriefDays(today,-1)?"昨日 ":day+" ";
  return prefix+briefTime(new Date(time).toISOString());
}

export function WorkStopHint({userId,snapshot,onRetry,busy}:{userId:string;snapshot:StopSnapshot;onRetry?:()=>void;busy?:boolean}){
  const [now,setNow]=useState<number|null>(null);
  const [minutes,setMinutes]=useState(DEFAULT_TRAVEL_MINUTES),[input,setInput]=useState(String(DEFAULT_TRAVEL_MINUTES)),[saved,setSaved]=useState(true);
  const prefKey="dcp:work-stop:v1:"+userId;
  useEffect(()=>{try{const n=travelMinutes(localStorage.getItem(prefKey))??DEFAULT_TRAVEL_MINUTES;setMinutes(n);setInput(String(n));}catch{setSaved(false);}},[prefKey]);
  useEffect(()=>{
    const tick=()=>{if(document.visibilityState==="visible")setNow(Date.now());};
    tick();const id=window.setInterval(tick,10_000);document.addEventListener("visibilitychange",tick);
    return ()=>{window.clearInterval(id);document.removeEventListener("visibilitychange",tick);};
  },[]);
  function change(value:string){
    setInput(value);const n=travelMinutes(value);if(n===null)return;setMinutes(n);
    try{localStorage.setItem(prefKey,String(n));setSaved(true);}catch{setSaved(false);}
  }
  const hint=now===null?null:workStopAt(snapshot,now,minutes);
  let headline="正在計算建議停止時間…",detail="";
  if(hint && now!==null){
    switch(hint.kind){
      case "unknown":headline="日曆資料不完整或未有更新，暫不能估算停止工作時間。";break;
      case "empty":headline="已讀取的行程中，今日暫無其他已確認時間的安排。";break;
      case "ongoing":headline="行程進行中";detail=stamp(Date.parse(hint.event.start),now)+" · "+hint.event.title;break;
      case "wrap":
      case "countdown":
        headline=hint.kind==="wrap"?"已到預留準備時間，可以暫停工作。":stamp(hint.stopAt,now)+" 停止工作 · "+(hint.minutes?"尚餘 "+hint.minutes+" 分鐘":"不足 1 分鐘");
        detail=stamp(Date.parse(hint.event.start),now)+" · "+hint.event.title+"（已預留 "+minutes+" 分鐘）";break;
    }
  }
  return <section aria-label="建議停止工作時間" className="brief-agenda space-y-1 rounded-2xl p-3 sm:p-4">
    <p className="text-xs font-bold">建議停止工作時間</p><p className="break-words text-base font-bold">{headline}</p>
    {detail?<p className="break-words text-sm">{detail}</p>:null}
    {onRetry?<p className="text-xs">{snapshot.panelOnly?"只計入日序行程。":"只計入日序及已選擇的 Apple 行程。"}工作 Google 日曆不包括在本提示內。</p>:snapshot.panelOnly?<p className="text-xs">未計入 Apple 行程。</p>:null}
    {onRetry&&hint?.kind==="unknown"?<button type="button" disabled={busy} onClick={onRetry} className="min-h-11 text-sm font-bold underline">{busy?"更新中…":"重新讀取日曆"}</button>:null}
    <details><summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-semibold underline">預留時間：{minutes} 分鐘</summary>
      <label className="block text-sm">預留準備或出門時間（分鐘）<input className="field ml-2 max-w-20" type="text" inputMode="numeric" maxLength={3} value={input} aria-invalid={travelMinutes(input)===null} onChange={e=>change(e.target.value)}/></label>
      <p className="mt-1 text-xs">{travelMinutes(input)===null?"請填寫 0 至 "+MAX_TRAVEL_MINUTES+" 的整數。現時仍預留 "+minutes+" 分鐘。":saved?"設定只儲存在此帳戶使用的這部裝置。":"此裝置未能儲存設定，所選時間在本次使用期間仍然有效。"}</p>
    </details>
  </section>;
}

export function GuideWorkStop({userId}:{userId:string}){
  const [snapshot,setSnapshot]=useState<StopSnapshot|null>(null),[error,setError]=useState(false),[busy,setBusy]=useState(false);
  const pending=useRef<AbortController|null>(null);
  const refresh=useCallback(async()=>{
    if(pending.current)return;
    const ctrl=new AbortController();pending.current=ctrl;setBusy(true);
    const timeout=window.setTimeout(()=>ctrl.abort(),50_000);
    try{
      const res=await fetch("/api/calendar-brief?view=work-stop",{cache:"no-store",credentials:"same-origin",signal:ctrl.signal});
      if(!res.ok)throw new Error();const value:StopSnapshot=await res.json();
      if(!Array.isArray(value?.events)||!Number.isFinite(Date.parse(value.generatedAt))||typeof value.incomplete!=="boolean"||typeof value.panelOnly!=="boolean")throw new Error();
      if(pending.current===ctrl){setSnapshot(value);setError(false);}
    }catch{if(pending.current===ctrl){setError(true);setSnapshot(null);}}
    finally{window.clearTimeout(timeout);if(pending.current===ctrl){pending.current=null;setBusy(false);}}
  },[]);
  useEffect(()=>{void refresh();return ()=>{pending.current?.abort();pending.current=null;};},[refresh]);
  useVisibleCalendarRefresh(refresh,true);
  return <div>
    {snapshot?<WorkStopHint key={userId} userId={userId} snapshot={snapshot} onRetry={refresh} busy={busy}/>:<p className="text-sm text-slate-600">{error?"未能讀取日曆，暫不能估算停止工作時間。你仍可繼續目前步驟。":"正在讀取下一個行程，你可以先開始目前步驟。"}</p>}
    {error?<button type="button" disabled={busy} onClick={()=>void refresh()} className="min-h-11 text-sm font-bold underline">{busy?"更新中…":"重新讀取日曆"}</button>:null}
  </div>;
}
