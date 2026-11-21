"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { TaskCoach } from "@/components/TaskCoach";
import { Compass } from "lucide-react";
import { AuthGate } from "@/components/AuthGate";
import { GuideWorkStop } from "@/components/WorkStopHint";
import { Button } from "@/components/ui/Button";
import { useTodayData } from "@/hooks/useTodayData";
import { controlAction, loadWorkGuide } from "@/lib/control-api";
import { hkDateIso } from "@/lib/planning";
import { simpleToday } from "@/lib/simple-mode";
import type { Task } from "@/lib/types";
import { guideInstruction, type GuideCheckpoint, type GuideDetail } from "@/lib/work-guide";

export default function Page(){return <AuthGate><WorkGuide/></AuthGate>;}

function WorkGuide(){
  const {data,error,reload,saveTaskLocally}=useTodayData();
  const [notice,setNotice]=useState("");
  const plan=data?simpleToday({tasks:data.tasks,planning:data.planning,dependencies:data.taskDependencies,assignments:data.assignments,userId:data.currentUser.id,today:hkDateIso()}):null;
  const task=plan?.ordered[0];
  return <main className="work-guide mx-auto max-w-3xl space-y-4">
    <header className="flex flex-wrap items-center justify-between gap-2"><h1 className="page-title flex items-center gap-2"><Compass aria-hidden="true"/>開工導航</h1><Link className="inline-flex min-h-11 items-center font-bold text-indigo-700" href="/">← 返 Dashboard</Link></header>
    {!error && data?<GuideWorkStop key={data.currentUser.id} userId={data.currentUser.id}/>:null}
    {error?<p role="alert" className="panel p-4">未能確認今日次序。<button className="min-h-11 underline" onClick={()=>void reload()}>重新載入</button></p>:null}
    {notice?<p role="status" className="rounded-xl bg-emerald-50 p-3 text-emerald-900">{notice}</p>:null}
    {!error && !data?<p role="status">讀取你嘅今日安排…</p>:null}
    {!error && data && plan && (task?<OneTask key={data.currentUser.id+task.id} userId={data.currentUser.id} task={task} reason={plan.isSuggestion?"今日未手排，按 Priority 建議；同級先睇 Deadline。":"照你今日排嘅次序：而家先做呢件。"} onCloseTask={changed=>{saveTaskLocally(changed);setNotice(changed.recurrence_rule_id?"今次已做完，恆常工作會按原設定繼續。":"已確認成件 Task 完成。");if(changed.recurrence_rule_id)void reload();}} refreshPlan={reload}/>:
      <section className="panel space-y-3 p-5"><h2 className="section-title">{plan.planned.length?"今日已排嘅工作暫時冇下一件可以開始。":"暫時冇可以開始嘅工作。"}</h2><p>等回覆、未到工作日或被阻住嘅 Task 唔會自動補入嚟。</p><Link className="inline-flex min-h-11 items-center font-bold text-indigo-700" href="/#today-order">自己排今日 →</Link></section>)}
  </main>;
}

function OneTask({task,userId,reason,onCloseTask,refreshPlan}:{task:Task;userId:string;reason:string;onCloseTask:(task:Task)=>void;refreshPlan:()=>Promise<void>}){
  const [detail,setDetail]=useState<GuideDetail|null>(null),[loadError,setLoadError]=useState(""),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  const [mini,setMini]=useState(false),[editing,setEditing]=useState(false),[next,setNext]=useState("");
  const [message,setMessage]=useState(""),[attempt,setAttempt]=useState(0);
  const writeLock=useRef(false), retryKey=useRef<{input:string;id:string}|null>(null);
  const draftKey="dcp:guide-next:v1:"+userId+":"+task.id;
  const [draftWarning,setDraftWarning]=useState(false);
  useEffect(()=>{try{const draft=sessionStorage.getItem(draftKey);if(draft){setNext(draft.slice(0,2000));setEditing(true);}}catch{/* Storage can be disabled on a shared device. */}},[draftKey]);
  function writeDraft(value:string){setNext(value);try{if(value)sessionStorage.setItem(draftKey,value);else sessionStorage.removeItem(draftKey);setDraftWarning(false);}catch{setDraftWarning(Boolean(value));}}
  useEffect(()=>{let live=true;setLoadError("");setDetail(null);
    void loadWorkGuide(task.id).then(result=>{if(live)setDetail(result);}).catch(()=>{if(live)setLoadError("上次進度未讀到，唔會當你未開始。");});
    return()=>{live=false;};
  },[task.id,attempt]);
  const record=useCallback(async(completed:string,following:string)=>{
    const input=JSON.stringify([completed,following]);
    if(retryKey.current?.input!==input)retryKey.current={input,id:crypto.randomUUID()};
    const result=await controlAction<{checkpoint:GuideCheckpoint}>("record_guide_step",{taskId:task.id,clientMutationId:retryKey.current.id,completed,next:following});
    retryKey.current=null;setDetail(current=>current?{...current,checkpoint:result.checkpoint}:current);
  },[task.id]);
  async function run(action:()=>Promise<void>){
    if(writeLock.current)return;writeLock.current=true;setBusy(true);setError("");setMessage("");
    try{await action();}catch(caught){setError(caught instanceof Error?caught.message:"未能儲存；請重試，唔會當作完成。");}
    finally{writeLock.current=false;setBusy(false);}
  }
  if(loadError)return <div role="alert" className="panel space-y-2 p-5"><p>{loadError}</p><Button onClick={()=>{setAttempt(x=>x+1);void refreshPlan();}}>重試</Button></div>;
  if(!detail)return <p role="status" className="panel p-5">讀取「{task.title}」上次進度…</p>;
  const guide=guideInstruction(task,detail);
  const review=guide.kind==="review",waiting=guide.kind==="waiting";
  const step=guide.step;
  async function finishStep(){
    if(mini){setMini(false);setMessage("已起步，接住做返眼前呢個動作。");return;}
    if(step){
      const result=await controlAction<{step:{id:string;status:"done";updated_at:string}}>("update_task_step",{id:step.id,expectedUpdatedAt:step.updated_at,status:"done"});
      setDetail(d=>d?{...d,steps:d.steps.map(s=>s.id===step.id?{...s,...result.step}:s)}:d);
    }else{await record(guide.text,guide.follow);}
    setEditing(false);writeDraft("");setMessage("呢步已記低，成件 Task 未結案。");
  }
  return <article className="guide-wash space-y-4 rounded-3xl p-5 sm:p-8">
    <p className="text-sm font-bold">{reason}</p><h2 className="text-2xl font-extrabold break-words">{task.title}</h2>
    {detail.checkpoint?.completed_summary?<p className="text-sm">上次做到：{detail.checkpoint.completed_summary}</p>:null}
    <div className="rounded-2xl bg-white p-4 text-slate-900"><p className="text-xs font-bold text-indigo-700">{review?"確認前唔會結案":waiting?"等結果":"而家只做呢一步"}</p><p className="mt-2 break-words text-xl font-bold">{mini?guide.smaller:guide.text}</p></div>
    <TaskCoach title={task.title} step={mini?guide.smaller:guide.text} progress={detail.checkpoint?.completed_summary ?? ""}/>
    {review && detail.openChildren?<p>仲有未完成嘅子任務，先去原任務跟進。</p>:null}
    {!editing && !waiting?<div className="flex flex-wrap gap-2">
      {!review?<><Button disabled={busy} onClick={()=>void run(finishStep)}>{busy?"儲存中…":mini?"起咗步，接住做":"呢步搞掂"}</Button>{!mini?<Button variant="secondary" disabled={busy} onClick={()=>{setMini(true);setMessage("");}}>再細一步</Button>:null}</>:
      <>{!detail.openChildren?<Button disabled={busy} onClick={()=>void run(async()=>{const result=await controlAction<{task:Task}>("update_task",{id:task.id,changes:{status:"done"},...(task.last_progress_at?{expectedLastProgressAt:task.last_progress_at}:{})});onCloseTask(result.task);})}>{task.recurrence_rule_id?"確認今次已完成":"確認整件完成"}</Button>:null}</>}
      {!step?<Button variant="ghost" disabled={busy} onClick={()=>setEditing(true)}>記低下次點接</Button>:null}
    </div>:null}
    {editing?<form className="space-y-2" onSubmit={e=>{e.preventDefault();if(next.trim())void run(async()=>{await record("",next.trim());setEditing(false);setMini(false);writeDraft("");setMessage("已記低。下次打開會由呢步接住。");});}}><label className="block font-bold">下次返嚟做乜？<input className="field mt-1 bg-white" value={next} onChange={e=>writeDraft(e.target.value)} maxLength={2000} required autoFocus/></label>{draftWarning?<p role="status" className="text-sm">呢部裝置未能暫存草稿，離開前請按「儲存下一步」。</p>:null}<Button type="submit" disabled={busy||!next.trim()}>儲存下一步</Button> <Button type="button" variant="ghost" disabled={busy} onClick={()=>{setEditing(false);writeDraft("");}}>取消</Button></form>:null}
    {message?<p role="status">{message}</p>:null}
    {error?<p role="alert" className="rounded-lg bg-amber-50 p-3 text-amber-950">{error} <button className="min-h-11 underline" onClick={()=>{setError("");setAttempt(x=>x+1);void refreshPlan();}}>重讀最新進度</button></p>:null}
    <Link href={`/tasks/${task.id}`} className="inline-flex min-h-11 items-center font-semibold underline">查看原任務{detail.openChildren?"同子任務":""} →</Link>
  </article>;
}
