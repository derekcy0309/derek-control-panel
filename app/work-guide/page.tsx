"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { TaskCoach } from "@/components/TaskCoach";
import { QuickInboxMemo } from "@/components/dayline/QuickInboxMemo";
import { Compass } from "lucide-react";
import { AuthGate } from "@/components/AuthGate";
import { GuideWorkStop } from "@/components/WorkStopHint";
import { Button } from "@/components/ui/Button";
import { useTodayData } from "@/hooks/useTodayData";
import { controlAction, loadWorkGuide } from "@/lib/control-api";
import { useDaylineDate } from "@/hooks/useDaylineDate";
import { simpleToday } from "@/lib/simple-mode";
import { createTaskPriorityProjection } from "@/lib/upcoming-task-priority";
import type { Task } from "@/lib/types";
import { guideInstruction, pauseForCurrentStep, type GuideCheckpoint, type GuideDetail } from "@/lib/work-guide";

export default function Page(){return <AuthGate><WorkGuide/></AuthGate>;}

function WorkGuide(){
  const {data,error,reload,saveTaskLocally}=useTodayData();
  const [notice,setNotice]=useState("");
  const today=useDaylineDate();
  const priority=data?createTaskPriorityProjection(data.taskTags??[],data.tasks,today):null;
  const plan=data?simpleToday({tasks:data.tasks,planning:data.planning,dependencies:data.taskDependencies,assignments:data.assignments,userId:data.currentUser.id,today,priorityRank:priority?.rank}):null;
  const task=plan?.ordered[0];
  return <div className="work-guide mx-auto max-w-3xl space-y-4">
    <header className="flex flex-wrap items-center justify-between gap-2"><h1 className="page-title flex items-center gap-2"><Compass aria-hidden="true"/>開工導航</h1><Link className="inline-flex min-h-11 items-center font-bold text-indigo-700" href="/">← 返回今日總覽</Link></header>
    {!error && data?<GuideWorkStop key={data.currentUser.id} userId={data.currentUser.id}/>:null}
    {error?<p role="alert" className="panel p-4">未能確認今日次序。<button className="min-h-11 underline" onClick={()=>void reload()}>重新載入</button></p>:null}
    {notice?<p role="status" className="rounded-xl bg-emerald-50 p-3 text-emerald-900">{notice}</p>:null}
    {!error && !data?<p role="status">正在讀取今日安排…</p>:null}
    {!error && data && plan && (task?<OneTask key={data.currentUser.id+task.id} userId={data.currentUser.id} task={task} reason={plan.isSuggestion?"今日尚未手動排序。以下按優先級建議，同級以較早到期的任務為先。":"按你編排的今日次序，先處理這項任務。"} onCloseTask={changed=>{saveTaskLocally(changed);setNotice(changed.recurrence_rule_id?"本期已完成。恆常任務的設定不變。":"整項任務已完成。");if(changed.recurrence_rule_id)void reload();}} refreshPlan={reload}/>:
      <section className="panel space-y-3 p-5"><h2 className="section-title">{plan.planned.length?"今日已編排的任務暫時沒有可開始的下一項。":"暫時沒有可開始的任務。"}</h2><p>等待回覆、未到工作日或受阻的任務不會自動加入。</p><Link className="inline-flex min-h-11 items-center font-bold text-indigo-700" href="/#today-order">編排今日任務 →</Link></section>)}
  </div>;
}

function OneTask({task,userId,reason,onCloseTask,refreshPlan}:{task:Task;userId:string;reason:string;onCloseTask:(task:Task)=>void;refreshPlan:()=>Promise<void>}){
  const [detail,setDetail]=useState<GuideDetail|null>(null),[loadError,setLoadError]=useState(""),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  const [miniChoice,setMini]=useState<boolean|null>(null),[editing,setEditing]=useState(false),[next,setNext]=useState("");
  const [resumed,setResumed]=useState(false),[locationDraft,setLocationDraft]=useState<string|null>(null);
  const [message,setMessage]=useState(""),[attempt,setAttempt]=useState(0);
  const writeLock=useRef(false), retryKey=useRef<{input:string;id:string}|null>(null);
  const draftKey="dcp:guide-next:v1:"+userId+":"+task.id;
  const locationKey=draftKey+":position";
  const [draftWarning,setDraftWarning]=useState(false);
  useEffect(()=>{try{const draft=sessionStorage.getItem(draftKey);if(draft){setNext(draft.slice(0,2000));setEditing(true);}}catch{/* Storage can be disabled on a shared device. */}},[draftKey]);
  useEffect(()=>{try{setLocationDraft(sessionStorage.getItem(locationKey));}catch{/* The pause can still be saved online. */}},[locationKey]);
  function storeLocation(value:string|null){setLocationDraft(value);try{if(value===null)sessionStorage.removeItem(locationKey);else sessionStorage.setItem(locationKey,value);setDraftWarning(false);}catch{setDraftWarning(value!==null);}}
  function writeDraft(value:string){setNext(value);try{if(value)sessionStorage.setItem(draftKey,value);else sessionStorage.removeItem(draftKey);setDraftWarning(false);}catch{setDraftWarning(Boolean(value));}}
  useEffect(()=>{let live=true;setLoadError("");setDetail(null);
    void loadWorkGuide(task.id).then(result=>{if(live)setDetail(result);}).catch(()=>{if(live)setLoadError("未能讀取上次進度。請重試，原有記錄不會更改。");});
    return()=>{live=false;};
  },[task.id,attempt]);
  const record=useCallback(async(completed:string,following:string,pause?:{actualStep:boolean;stepId?:string;stepVersion?:string;preparation:boolean;location:string})=>{
    const input=JSON.stringify([completed,following,pause]);
    if(retryKey.current?.input!==input)retryKey.current={input,id:crypto.randomUUID()};
    const result=await controlAction<{checkpoint:GuideCheckpoint}>("record_guide_step",{taskId:task.id,clientMutationId:retryKey.current.id,completed,next:following,...(pause?{pause:true,...pause}:{})});
    retryKey.current=null;setDetail(current=>current?{...current,checkpoint:result.checkpoint}:current);
  },[task.id]);
  async function run(action:()=>Promise<void>){
    if(writeLock.current)return;writeLock.current=true;setBusy(true);setError("");setMessage("");
    try{await action();}catch(caught){setError(caught instanceof Error?caught.message:"未能確認儲存結果。請重試。");}
    finally{writeLock.current=false;setBusy(false);}
  }
  if(loadError)return <div role="alert" className="panel space-y-2 p-5"><p>{loadError}</p><Button onClick={()=>{setAttempt(x=>x+1);void refreshPlan();}}>重試</Button></div>;
  if(!detail)return <p role="status" className="panel p-5">讀取「{task.title}」上次進度…</p>;
  const guide=guideInstruction(task,detail);
  const review=guide.kind==="review",waiting=guide.kind==="waiting";
  const step=guide.step;
  const pause=pauseForCurrentStep(detail,guide);
  const paused=!!pause&&!resumed;
  const mini=miniChoice??!!pause?.preparation;
  const location=locationDraft??pause?.location??"";
  async function pauseHere(){
    await record("",guide.text,{actualStep:Boolean(step),stepId:step?.id,stepVersion:step?.updated_at,preparation:mini,location:location.trim()});
    storeLocation(null);setResumed(false);setMessage("暫停位置已儲存。任務和今日次序不變。");
  }
  async function finishStep(){
    if(mini){setMini(false);setMessage("準備動作已完成，可以繼續目前步驟。");return;}
    if(step){
      const result=await controlAction<{step:{id:string;status:"done";updated_at:string}}>("update_task_step",{id:step.id,expectedUpdatedAt:step.updated_at,status:"done"});
      setDetail(d=>d?{...d,steps:d.steps.map(s=>s.id===step.id?{...s,...result.step}:s)}:d);
    }else{await record(guide.text,guide.follow);}
    setEditing(false);writeDraft("");storeLocation(null);setMessage("這一步已完成，整項任務仍未結束。");
  }
  return <article className="guide-wash space-y-4 rounded-3xl p-5 sm:p-8">
    <p className="text-sm font-bold">{reason}</p><h2 className="text-2xl font-extrabold break-words">{task.title}</h2>
    {detail.checkpoint?.completed_summary?<p className="text-sm">上次完成：{detail.checkpoint.completed_summary}</p>:null}
    <div className="rounded-2xl bg-white p-4 text-slate-900"><p className="text-xs font-bold text-indigo-700">{review?"任務仍未結束":waiting?"等待結果":paused?"上次暫停的步驟":mini?"準備動作":"目前步驟"}</p><p className="mt-2 break-words text-xl font-bold">{mini?guide.smaller:guide.text}</p>{pause?.location?<p className="mt-2 whitespace-pre-wrap break-words text-sm">上次停在：{pause.location}</p>:null}</div>
    {review && detail.openChildren?<p>這項任務仍有未完成的子任務。請先開啟任務詳情跟進。</p>:null}
    {!editing && !waiting?<div className="flex flex-wrap gap-2">
      {paused?<Button disabled={busy} onClick={()=>{setResumed(true);setMessage("");}}>從這一步繼續</Button>:!review?<><Button disabled={busy} onClick={()=>void run(finishStep)}>{busy?"儲存中…":mini?"已準備好，返回目前步驟":"完成這一步"}</Button>{!mini?<Button variant="secondary" disabled={busy} onClick={()=>{setMini(true);setMessage("");}}>拆細一步</Button>:null}<Button variant="secondary" disabled={busy} onClick={()=>void run(pauseHere)}>暫停並儲存位置</Button></>:
      <>{!detail.openChildren?<Button disabled={busy} onClick={()=>void run(async()=>{const result=await controlAction<{task:Task}>("update_task",{id:task.id,changes:{status:"done"},...(task.last_progress_at?{expectedLastProgressAt:task.last_progress_at}:{})});onCloseTask(result.task);})}>{task.recurrence_rule_id?"確認完成本期（保留恆常任務）":"確認完成整項任務"}</Button>:null}</>}
      {!step&&!paused?<Button variant="ghost" disabled={busy} onClick={()=>setEditing(true)}>自訂下一步</Button>:null}
    </div>:null}
    {!paused&&!editing&&!review&&!waiting?<details className="text-sm" key={guide.text}><summary className="min-h-11 cursor-pointer py-3 underline">補充暫停位置（選填）</summary><label className="block">目前停在哪裏？<textarea className="field mt-1 block w-full" maxLength={1000} disabled={busy} value={location} placeholder="例如：報告第 3 頁，已核對首兩項。" onChange={e=>storeLocation(e.target.value)}/></label><p>按「暫停並儲存位置」後，下次會顯示這項記錄。</p></details>:null}
    {editing?<form className="space-y-2" onSubmit={e=>{e.preventDefault();if(next.trim())void run(async()=>{await record("",next.trim());setEditing(false);setMini(false);writeDraft("");storeLocation(null);setMessage("下一步已儲存。");});}}><label className="block font-bold">下次從哪一步開始？<input className="field mt-1 bg-white" value={next} onChange={e=>writeDraft(e.target.value)} maxLength={2000} required autoFocus/></label><Button type="submit" disabled={busy||!next.trim()}>儲存下一步</Button> <Button type="button" variant="ghost" disabled={busy} onClick={()=>{setEditing(false);writeDraft("");}}>取消</Button></form>:null}
    {draftWarning?<p role="status" className="text-sm">此裝置未能暫存草稿。請在離開前儲存。</p>:null}
    {message?<p role="status">{message}</p>:null}
    {error?<p role="alert" className="rounded-lg bg-amber-50 p-3 text-amber-950">{error} <button className="min-h-11 underline" onClick={()=>{setError("");setAttempt(x=>x+1);void refreshPlan();}}>重讀最新進度</button></p>:null}
    <QuickInboxMemo userId={userId}/>
    <TaskCoach title={task.title} step={mini?guide.smaller:guide.text} progress={detail.checkpoint?.completed_summary ?? ""}/>
    <Link href={`/tasks/${task.id}`} className="inline-flex min-h-11 items-center font-semibold underline">查看任務詳情{detail.openChildren?"及子任務":""} →</Link>
  </article>;
}
