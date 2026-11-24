"use client";
import Link from "next/link";
import { useEffect, useState, type CSSProperties } from "react";
import { ChevronDown, Play, Tag } from "lucide-react";
import { loadWorkGuide } from "@/lib/control-api";
import { daylineDate } from "@/lib/dayline";
import { taskVisibleNextAction } from "@/lib/task-steps";
import { guideInstruction, starterSteps, type GuideDetail } from "@/lib/work-guide";
import type { PersonalTaskTag, Task } from "@/lib/types";

const firstTag=(task:Task,tags:PersonalTaskTag[])=>tags.find(t=>task.personal_tag_ids?.includes(t.id));
export function DaylineNow({task,tags,tagColors,suggestion,completed,onOrder}:{task?:Task;tags:PersonalTaskTag[];tagColors:ReadonlyMap<string,CSSProperties>;suggestion:boolean;completed:boolean;onOrder:()=>void}){
  const [detail,setDetail]=useState<GuideDetail|null>(null),[failed,setFailed]=useState(false);
  const id=task?.id;
  useEffect(()=>{let live=true;setDetail(null);setFailed(false);if(id)void loadWorkGuide(id).then(v=>{if(live)setDetail(v);}).catch(()=>{if(live)setFailed(true);});return()=>{live=false;};},[id]);
  if(!task)return <section className="dl-focus"><div className="dl-focus-top"><span className="dl-focus-chip"><span/>而家做</span></div><h2>{completed?"今日手排嘅工作做晒":"暫時冇要即刻開始嘅工作"}</h2><p className="dl-tools-muted">等回覆、未到工作日或者被阻住嘅 Task 唔會自動補入嚟。</p><div className="dl-focus-actions"><button className="dl-primary" type="button" onClick={onOrder}>自己排今日</button></div></section>;
  const taskTags=tags.filter(tag=>task.personal_tag_ids?.includes(tag.id)).slice(0,2),instruction=detail?guideInstruction(task,detail):null;
  return <article className="dl-focus" aria-label={"而家做："+task.title}>
    <div className="dl-focus-top"><span className="dl-focus-chip"><span/>而家做</span><span className="dl-focus-order">{suggestion?"系統建議":"手排第 1 項"}</span></div>
    <h2><Link className="dl-hero-title" href={"/tasks/"+task.id}>{task.title}</Link></h2>
    <div className="dl-focus-tags">{taskTags.map(tag=><span className="task-tag-color inline-flex min-w-0 max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold" data-tag-id={tag.id} key={tag.id} style={tagColors.get(tag.id)}><Tag className="h-3.5 w-3.5 shrink-0" aria-hidden="true"/><span className="min-w-0 break-words">{tag.name}</span></span>)}{task.due_date?<span className="dl-tag">限期：{daylineDate(task.due_date)}</span>:null}</div>
    <div className="dl-first"><span className="dl-step-kicker">{instruction?.kind==="resume"?"由上次接住":instruction?.kind==="review"?"下一步":"第一小步"}</span><p>{instruction?.text??taskVisibleNextAction(task)??starterSteps(task.title)[0]}</p>{failed?<p className="dl-resume-note">未能讀到上次進度，可以入開工導航再試。</p>:null}</div>
    <div className="dl-focus-actions"><Link href="/work-guide" className="dl-primary"><Play aria-hidden="true"/>開始呢件事</Link><span className="dl-guide-caption">開工導航</span></div>
  </article>;
}
export function DaylineNext({tasks,tags,tagColors,suggestion,onOrder}:{tasks:Task[];tags:PersonalTaskTag[];tagColors:ReadonlyMap<string,CSSProperties>;suggestion:boolean;onOrder:()=>void}){
  return <section className="dl-queue" aria-label="跟住做"><div className="dl-section-heading"><div><span className="dl-eyebrow" aria-hidden="true"><b/>UP NEXT</span><h2>跟住做</h2></div><button type="button" className="dl-text-btn" onClick={onOrder}>自己排今日</button></div>
    {tasks.length?<div className="dl-queue-list">{tasks.slice(0,2).map((task,i)=>{
      const tag=firstTag(task,tags);
      return <details key={task.id}><summary><span className="dl-number">0{i+2}</span><strong>{task.title}</strong>{tag?<span className="task-tag-color max-w-[4.2rem] truncate rounded-full px-2 py-0.5 text-xs font-semibold sm:max-w-[10rem]" data-tag-id={tag.id} style={tagColors.get(tag.id)}>{tag.name}</span>:<span/>}<ChevronDown aria-hidden="true"/></summary><p>{taskVisibleNextAction(task)||starterSteps(task.title)[0]} <Link className="underline" href={"/tasks/"+task.id}>任務詳情</Link></p></details>;
    })}</div>:<p className="dl-tools-muted">冇排其他工作。</p>}
    {tasks.length>0?<span className="dl-meta">{suggestion?"未有手排，顯示建議次序。":"照你手排嘅次序。"}</span>:null}
  </section>;
}
