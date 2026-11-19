"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CalendarDays, RefreshCw } from "lucide-react";
import { briefEventTime, type DashboardBrief } from "@/lib/calendar-brief";
import { calendarErrorMessage } from "@/lib/calendar-errors";
import { dashboardAgendaHighlights } from "@/lib/dashboard-agenda";
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
 if(agent)return <section className="panel space-y-3 p-5" aria-label="Grok 三日精簡摘要"><p className="text-xs text-slate-500">每日 08:30 香港時間 · 只讀本人 · 不作任何修改</p>{busy&&!brief?<p role="status">讀取最新摘要中…</p>:null}{error?<p role="alert">{error}</p>:null}{brief?<pre className="whitespace-pre-wrap break-words text-sm leading-7">{brief.text}</pre>:null}<button type="button" disabled={busy} className="min-h-11 text-sm font-bold text-indigo-700" onClick={()=>void load()}>重新讀取</button></section>;
 const highlight=brief?dashboardAgendaHighlights(brief):null;
 const nearest=brief?.days.flatMap(day=>[...day.deadlines.map(t=>({title:t.title,date:day.date})),...(brief.familyDates??[]).filter(t=>t.date===day.date)]).at(0);
 const dayLabel=(date:string)=>["今日","聽日","後日"][brief?.days.findIndex(day=>day.date===date)??-1]??date;
 return <section className="panel space-y-4 p-4 sm:p-5" aria-labelledby="private-brief-title"><header className="flex flex-wrap items-center justify-between gap-2"><div><p className="eyebrow">只限本人 · Read only</p><h2 id="private-brief-title" className="section-title mt-1 flex items-center gap-2"><CalendarDays className="h-5 w-5"/>三日行程同 Deadline</h2></div><button type="button" className="flex min-h-11 items-center gap-2 text-sm font-bold text-indigo-700" disabled={busy} onClick={()=>void load(true)}><RefreshCw className={`h-4 w-4 ${busy?"animate-spin":""}`} aria-hidden="true"/>{busy?"更新中…":"更新"}</button></header>
  <p className="text-sm leading-5 text-slate-600">包括已揀嘅 iCloud 行程、Task Deadline 同你自己嘅學校／家庭日期。iPhone 已入嘅唔使再加；改行程返原本日曆。</p>
  {busy&&!brief?<p role="status" className="text-sm">讀取三日安排中…</p>:null}{error?<p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{error} {brief?"以下保留上次結果，未必係最新。":""}</p>:null}
  {brief?<><div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">{brief.sources.map(s=><p key={s.label}>{s.label}：{s.state==="fresh"?"已更新":s.state==="not_connected"?"未連接":s.state==="select_calendars"?"未選 Calendar":"未能更新"}{s.lastSync?` · ${new Date(s.lastSync).toLocaleString("zh-HK",{timeZone:"Asia/Hong_Kong",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"})}`:""}</p>)}</div>
   {brief.sources.filter(s=>s.state==="stale").map(s=><p key={s.label} role="alert" className="rounded-xl bg-amber-50 p-3 text-sm leading-6 text-amber-900">{s.label} 未能更新。{calendarErrorMessage(s.errorCode)} 唔好以舊資料當作完整最新安排。</p>)}
   {brief.truncated?<p role="alert" className="text-sm text-amber-900">資料超出本次上限，以下不是完整清單，請打開 Calendar／Task 查看。</p>:null}
   {brief.warnings?.map(warning=><p key={warning} role="status" className="rounded-xl bg-amber-50 p-3 text-sm leading-6 text-amber-900">{warning}</p>)}
   {brief.familyWarning?<p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{brief.familyWarning}</p>:null}
   <div className="grid gap-2 sm:grid-cols-2" aria-label="一眼睇安排"><div className="brief-agenda rounded-xl p-3"><p className="text-xs font-bold">進行中／下一個行程</p><p className="mt-1 break-words font-semibold">{highlight?`${dayLabel(highlight.date)} ${briefEventTime(highlight.event)} · ${highlight.event.title}`:"已讀取資料內暫無即將開始嘅行程"}</p></div><div className="brief-deadline rounded-xl p-3"><p className="text-xs font-bold">最近日期／Deadline</p><p className="mt-1 break-words font-semibold">{nearest?`${dayLabel(nearest.date)} · ${nearest.title}`:"已讀取資料內暫無到期事項"}</p></div></div>
   <details key={brief.from} open={brief.days.reduce((n,d)=>n+d.events.length+d.deadlines.length,brief.familyDates?.length??0)<=3 || undefined}><summary className="min-h-11 cursor-pointer py-2 text-sm font-bold text-indigo-700">逐日睇：今日、聽日、後日</summary>
   <div className="grid gap-3 lg:grid-cols-3">{brief.days.map((day,i)=>{
    const family=(brief.familyDates??[]).filter(item=>item.date===day.date);
    return <section key={day.date} className="min-w-0 rounded-2xl border border-slate-200 p-3" aria-label={`${["今日","聽日","後日"][i]} ${day.date}`}>
      <h3 className="font-extrabold">{["今日","聽日","後日"][i]} <span className="ml-1 text-xs font-normal text-slate-500">{day.date.slice(5)}</span></h3>
      <div className="mt-3 space-y-2">
        {day.events.map(e=><div key={e.source+e.id} className="brief-agenda rounded-xl border-l-2 border-sky-300 p-3"><p className="text-xs font-bold">{briefEventTime(e)}</p><p className="break-words font-semibold">{e.title}</p><p className="text-xs">{e.source} 行程 · 唯讀{e.tentative?" · 待確認":""}</p></div>)}
        {day.deadlines.map(t=><div key={t.id} className="brief-deadline rounded-xl border-l-2 border-amber-300 p-3"><p className="text-xs font-bold">Task Deadline · {t.priority<=2?"P1":t.priority===3?"P2":"P3"}</p><Link href={`/tasks/${t.id}`} className="inline-flex min-h-11 items-center break-words font-semibold underline">{t.title}</Link><p className="text-xs">{t.status==="waiting"?"等回覆":t.status==="blocked"?"待處理阻塞":t.status==="in_progress"?"做緊":"未完成"}</p></div>)}
        {family.map(item=><div className="brief-deadline rounded-xl border-l-2 border-amber-300 p-3" key={"item-"+item.id}><p className="text-xs font-bold">{item.kind==="school"?"學校":"家庭"} · 日期／限期</p><Link className="inline-flex min-h-11 items-center break-words font-semibold underline" href={`/workspace/${item.kind}#item-${item.id}`}>{item.title}</Link></div>)}
        {!day.events.length&&!day.deadlines.length&&!family.length?<p className="text-sm text-slate-500">暫無已讀取的行程或 Deadline。</p>:null}
      </div></section>;
   })}</div></details>
   <p className="text-xs text-slate-500">想睇學校或家庭 iCloud 行事曆？到 <Link className="underline" href="/settings#private-calendar">Settings → 私人 Calendar</Link> 揀返已有嘅 Calendar。只喺 iPhone 本機或其他帳戶嘅行程唔會經 iCloud 讀到。</p>
  </>:null}
 </section>;
}
