"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type DashboardBrief } from "@/lib/calendar-brief";
import { briefStartUrl } from "@/lib/brief-start";
import { DaylineAgenda } from "@/components/dayline/Agenda";
import { stopSnapshotFromBrief } from "@/lib/work-stop";
import { useVisibleCalendarRefresh } from "@/components/WorkStopHint";
export function CalendarBriefPanel({agent=false,userId}:{agent?:boolean;userId:string}) {
 const [brief,setBrief]=useState<DashboardBrief|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false);const generation=useRef(0),pending=useRef<AbortController|null>(null);
 const load=useCallback(async(force=false)=>{const version=++generation.current;pending.current?.abort();const controller=new AbortController();pending.current=controller;const timer=setTimeout(()=>controller.abort(),50000);setBusy(true);setError("");try{
  let refreshWarning="";
  if(force&&!agent){
   try{
   const refresh=await fetch("/api/integrations/apple-calendar",{method:"POST",headers:{"Content-Type":"application/json"},credentials:"same-origin",cache:"no-store",body:JSON.stringify({action:"refresh"}),signal:controller.signal});
   // An account without Apple can still refresh its Panel events/deadlines.
   // A provider failure or short cooldown must not stop the independent Task query.
   if(!refresh.ok&&refresh.status!==404){const failure=await refresh.json().catch(()=>null);refreshWarning=typeof failure?.error==="string"?failure.error:"Apple 未能即時更新；仍會重新讀取 Panel 行程同 Deadline。";}
   }catch(caught){if(controller.signal.aborted)throw caught;refreshWarning="Apple 更新連線未完成；已嘗試獨立重讀 Panel 行程同 Deadline。";}
  }
  const res=await fetch(agent?"/api/agent/brief":"/api/calendar-brief",{cache:"no-store",credentials:"same-origin",signal:controller.signal});const value=await res.json().catch(()=>{throw new Error("未能讀取伺服器回應，請重試。");});if(!res.ok)throw new Error(value.error||"未能讀取三日安排。");if(typeof value.text!=="string"||!Array.isArray(value.days)||!Array.isArray(value.sources))throw new Error("摘要資料不完整，請重試。");if(version===generation.current){setBrief(value);setError(refreshWarning);}
 }catch(e){if(version===generation.current)setError(controller.signal.aborted?"連線逾時，請再按更新；以下保留上次結果，未必係最新。":e instanceof Error?e.message:"未能連線，請重試。");}finally{clearTimeout(timer);if(version===generation.current)setBusy(false);}},[agent]);
 const invalidate=useCallback(()=>{generation.current++;pending.current?.abort();},[]);
 useEffect(()=>{setBrief(null);void load();return invalidate;},[load,userId,invalidate]);
 useEffect(()=>{const listener=()=>void load();window.addEventListener("dcp:calendar-changed",listener);return()=>window.removeEventListener("dcp:calendar-changed",listener);},[load]);
 useVisibleCalendarRefresh(load,!agent && !busy);
 const stop=useMemo(()=>brief && !agent?stopSnapshotFromBrief(brief):null,[agent,brief]);
 if(agent)return <section className="panel space-y-3 p-5" aria-label="Grok 三日精簡摘要"><p className="text-xs text-slate-500">每日香港時間 08:30 · 僅供本人查閱 · 唯讀</p>{busy&&!brief?<p role="status">讀取最新摘要中…</p>:null}{error?<p role="alert">{error}</p>:null}{brief?<pre className="whitespace-pre-wrap break-words text-sm leading-7">{brief.text.endsWith(briefStartUrl)?<>{brief.text.slice(0,-briefStartUrl.length)}<a href={briefStartUrl} className="break-all font-bold underline">{briefStartUrl}</a></>:brief.text}</pre>:null}<button type="button" disabled={busy} className="min-h-11 text-sm font-bold text-indigo-700" onClick={()=>void load()}>重新讀取</button></section>;
 return <DaylineAgenda brief={brief} busy={busy} error={error} reload={()=>void load(true)} stop={stop} userId={userId}/>;
}
