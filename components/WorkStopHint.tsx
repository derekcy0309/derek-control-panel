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
  const prefix=day===today?"":day===addBriefDays(today,1)?"聽日 ":day===addBriefDays(today,-1)?"昨日 ":day+" ";
  return prefix+briefTime(new Date(time).toISOString());
}

export function WorkStopHint({userId,snapshot}:{userId:string;snapshot:StopSnapshot}){
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
  let headline="計緊收手時間…",detail="";
  if(hint && now!==null){
    switch(hint.kind){
      case "unknown":headline="日曆資料未齊或未夠新，暫唔估收手時間。";break;
      case "empty":headline="已讀取嘅行程入面，今日暫時冇定咗鐘數嘅約。";break;
      case "ongoing":headline="而家係行程時間";detail=stamp(Date.parse(hint.event.start),now)+" · "+hint.event.title;break;
      case "wrap":
      case "countdown":
        headline=hint.kind==="wrap"?"到咗收手時間，可以準備下一個行程。":stamp(hint.stopAt,now)+" 收手 · "+(hint.minutes?"仲有 "+hint.minutes+" 分鐘":"唔夠 1 分鐘");
        detail=stamp(Date.parse(hint.event.start),now)+" · "+hint.event.title+"（已預留 "+minutes+" 分鐘）";break;
    }
  }
  return <section aria-label="幾點要收手" className="brief-agenda space-y-1 rounded-2xl p-3 sm:p-4">
    <p className="text-xs font-bold">幾點要收手？</p><p className="break-words text-base font-bold">{headline}</p>
    {detail?<p className="break-words text-sm">{detail}</p>:null}
    {snapshot.panelOnly?<p className="text-xs">暫時只計 Panel 行程。</p>:null}
    <details><summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-semibold underline">預留時間：{minutes} 分鐘</summary>
      <label className="block text-sm">出門／準備要幾多分鐘？<input className="field ml-2 max-w-20" type="text" inputMode="numeric" maxLength={3} value={input} aria-invalid={travelMinutes(input)===null} onChange={e=>change(e.target.value)}/></label>
      <p className="mt-1 text-xs">{travelMinutes(input)===null?"請填 0 至 "+MAX_TRAVEL_MINUTES+" 嘅整數；暫時沿用 "+minutes+" 分鐘。":saved?"只記住呢個帳戶喺呢部裝置嘅分鐘數。":"呢部裝置未能記住設定，今次仍然生效。"}</p>
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
    {snapshot?<WorkStopHint key={userId} userId={userId} snapshot={snapshot}/>:<p className="text-sm text-slate-600">{error?"暫時讀唔到收手時間；你照樣可以做下面嗰一步。":"讀緊下一個行程，唔使等就可以開工。"}</p>}
    {error||snapshot?.incomplete?<button type="button" disabled={busy} onClick={()=>void refresh()} className="min-h-11 text-sm font-bold underline">{busy?"更新中…":"重讀日曆"}</button>:null}
  </div>;
}
