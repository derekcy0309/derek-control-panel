"use client";
import Link from "next/link";
import { useEffect, useState, type CSSProperties } from "react";
import { ChevronDown, ExternalLink, Play, Tag } from "lucide-react";
import { controlAction, loadWorkGuide } from "@/lib/control-api";
import { launchHttps, type LaunchTarget } from "@/lib/launch-resource";
import { TaskWorkingDraft } from "@/components/dayline/TaskWorkingDraft";
import { daylineDate } from "@/lib/dayline";
import { taskVisibleNextAction } from "@/lib/task-steps";
import { guideInstruction, starterSteps, type GuideDetail } from "@/lib/work-guide";
import type { Task } from "@/lib/types";
import type { TaskPriorityProjection } from "@/lib/upcoming-task-priority";

export function DaylineNow({userId,task,priority,tagColors,suggestion,completed,onOrder}:{userId:string;task?:Task;priority:TaskPriorityProjection;tagColors:ReadonlyMap<string,CSSProperties>;suggestion:boolean;completed:boolean;onOrder:()=>void}){
  const [detail,setDetail]=useState<(GuideDetail & {launch?:LaunchTarget|null;launchUnavailable?:boolean})|null>(null),[failed,setFailed]=useState(false);
  const [smaller,setSmaller]=useState(false),[retry,setRetry]=useState(0);
  const id=task?.id;
  useEffect(()=>{let live=true;setDetail(null);setFailed(false);if(id)void loadWorkGuide(id,true).then(v=>{if(live)setDetail(v);}).catch(()=>{if(live)setFailed(true);});return()=>{live=false;};},[id,retry]);
  useEffect(()=>{if(window.location.hash==="#dayline-start"){const card=document.getElementById("dayline-start");card?.focus({preventScroll:true});card?.scrollIntoView({block:"center"});}},[id]);
  if(!task)return <section id="dayline-start" tabIndex={-1} className="dl-focus scroll-mt-24"><div className="dl-focus-top"><span className="dl-focus-chip"><span/>而家做</span></div><h2>{completed?"今日手排嘅工作做晒":"暫時冇要即刻開始嘅工作"}</h2><p className="dl-tools-muted">等回覆、未到工作日或者被阻住嘅 Task 唔會自動補入嚟。</p><div className="dl-focus-actions"><button className="dl-primary" type="button" onClick={onOrder}>自己排今日</button></div></section>;
  const taskTags=priority.labels(task).slice(0,2),instruction=detail?guideInstruction(task,detail):null;
  const canStart=instruction?.kind!=="review" && instruction?.kind!=="waiting";
  return <article id="dayline-start" tabIndex={-1} className="dl-focus scroll-mt-24" aria-label={"而家做："+task.title}>
    <div className="dl-focus-top"><span className="dl-focus-chip"><span/>而家做</span><span className="dl-focus-order">{suggestion?"系統建議":"手排第 1 項"}</span></div>
    <h2><Link className="dl-hero-title" href={"/tasks/"+task.id}>{task.title}</Link></h2>
    <div className="dl-focus-tags">{taskTags.map(tag=><span className="task-tag-color inline-flex min-w-0 max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold" data-tag-id={tag.id} key={tag.id} style={tagColors.get(tag.id)}><Tag className="h-3.5 w-3.5 shrink-0" aria-hidden="true"/><span className="min-w-0 break-words">{tag.name}</span></span>)}{task.due_date?<span className="dl-tag">限期：{daylineDate(task.due_date)}</span>:null}</div>
    <div className="dl-first" id="dayline-first-step" aria-live="polite"><span className="dl-step-kicker">{smaller?"再細一步":instruction?.kind==="resume"?"由上次接住":instruction?.kind==="review"?"下一步":"第一小步"}</span><p>{smaller?(instruction?.smaller||starterSteps(task.title)[2]):instruction?.text??taskVisibleNextAction(task)??starterSteps(task.title)[0]}</p></div>
    {failed || detail?.launchUnavailable?<p className="dl-resume-note" role="status">{failed?"未能讀到上次進度同資源。":"部分資源暫時未能讀取。"} <button type="button" className="min-h-11 underline" onClick={()=>setRetry(n=>n+1)}>重試</button></p>:null}
    <div className="dl-focus-actions">
      {detail?.launch ? <LaunchAction target={detail.launch}/> : canStart ? <button type="button" className="dl-primary" aria-controls="dayline-first-step" aria-pressed={smaller} onClick={()=>setSmaller(value=>!value)}><Play aria-hidden="true"/>{smaller?"睇返原步":"再細一步"}</button> : null}
      <Link href="/work-guide" className={canStart||detail?.launch?"dl-guide-caption inline-flex min-h-11 items-center underline":"dl-primary"}>開始呢件事</Link>
    </div>
    <TaskWorkingDraft key={task.id} userId={userId} taskId={task.id}/>
  </article>;
}

function LaunchAction({target}:{target:LaunchTarget}) {
  const [opening,setOpening]=useState(false),[error,setError]=useState("");
  if(target.kind!=="file")return <a href={target.href} className="dl-primary max-w-full" rel="noreferrer" target={target.kind==="web"?"_blank":undefined}><ExternalLink className="shrink-0" aria-hidden="true"/><span className="min-w-0 break-words">打開{target.label}</span></a>;
  const resourceId=target.resourceId;
  async function openFile() {
    if(opening)return;
    setOpening(true);setError("");
    try {
      const result=await controlAction<{url:string}>("open_task_storage_resource",{id:resourceId});
      const href=launchHttps(result.url);
      if(!href)throw Error();
      // Use the current tab: opening a new window after awaiting a signature
      // gets blocked on iPhone. No signed URLs are requested until this click.
      window.location.assign(href);
    } catch {setError("檔案未能開啟。請檢查權限或連線，再按一次。");}
    finally {setOpening(false);}
  }
  return <><button type="button" className="dl-primary max-w-full" disabled={opening} onClick={()=>void openFile()}><ExternalLink aria-hidden="true" className="shrink-0"/><span className="min-w-0 break-words">{opening?"正在開檔…":"打開"+target.label}</span></button>{error?<p role="alert" className="text-sm">{error}</p>:null}</>;
}
export function DaylineNext({tasks,priority,tagColors,suggestion,onOrder}:{tasks:Task[];priority:TaskPriorityProjection;tagColors:ReadonlyMap<string,CSSProperties>;suggestion:boolean;onOrder:()=>void}){
  return <section className="dl-queue" aria-label="跟住做"><div className="dl-section-heading"><div><span className="dl-eyebrow" aria-hidden="true"><b/>UP NEXT</span><h2>跟住做</h2></div><button type="button" className="dl-text-btn" onClick={onOrder}>自己排今日</button></div>
    {tasks.length?<div className="dl-queue-list">{tasks.slice(0,2).map((task,i)=>{
      const tag=priority.labels(task)[0];
      return <details key={task.id}><summary><span className="dl-number">0{i+2}</span><strong>{task.title}</strong>{tag?<span className="task-tag-color max-w-[4.2rem] truncate rounded-full px-2 py-0.5 text-xs font-semibold sm:max-w-[10rem]" data-tag-id={tag.id} style={tagColors.get(tag.id)}>{tag.name}</span>:<span/>}<ChevronDown aria-hidden="true"/></summary><p>{taskVisibleNextAction(task)||starterSteps(task.title)[0]} <Link className="underline" href={"/tasks/"+task.id}>任務詳情</Link></p></details>;
    })}</div>:<p className="dl-tools-muted">冇排其他工作。</p>}
    {tasks.length>0?<span className="dl-meta">{suggestion?"未有手排，顯示建議次序。":"照你手排嘅次序。"}</span>:null}
  </section>;
}
