"use client";

import Link from "next/link";
import {useId,useRef,useState} from "react";
import {Button} from "@/components/ui/Button";

const reasons = [
  ["size","步驟太大"],
  ["information","欠缺資料"],
  ["decision","需要他人決定"]
] as const;
type Reason = typeof reasons[number][0];
const templates = {
  information:"想請你提供［所需文件或資料］，讓我核對［具體項目］。可否將有關檔案或連結傳給我？",
  decision:"想請你確認［需要決定的事項］：應採用［方案 A］還是［方案 B］？確認後我便可繼續。"
};

// No task text, person, API or notification is passed to this helper.
export function GuideObstacleHelp({userId,taskId,onSmaller}:{userId:string;taskId:string;onSmaller:()=>void}){
  const [reason,setReason]=useState<Reason|null>(null),[draft,setDraft]=useState(""),[feedback,setFeedback]=useState(""),[storageWarning,setStorageWarning]=useState(false);
  const input=useRef<HTMLTextAreaElement>(null),contentId=useId();
  // Existing sign-out cleanup removes all dcp:guide-next:v1:<user>:* entries.
  const key=(r:Reason)=>"dcp:guide-next:v1:"+userId+":"+taskId+":obstacle:"+r;
  function choose(r:Reason){
    setReason(r);setFeedback("");setStorageWarning(false);
    if(r==="size"){onSmaller();return;}
    let value=templates[r];try{value=sessionStorage.getItem(key(r))??value;}catch{/* Typing still works without browser storage. */}
    setDraft(value);
  }
  function edit(value:string){
    setDraft(value);setFeedback("");
    if(!reason || reason==="size")return;
    try{sessionStorage.setItem(key(reason),value);setStorageWarning(false);}catch{setStorageWarning(true);}
  }
  async function copy(){
    if(!draft.trim())return;
    try{await navigator.clipboard.writeText(draft);setFeedback("已複製草稿，尚未傳送。");}
    catch{input.current?.focus();input.current?.select();setFeedback("未能自動複製。請使用裝置的「複製」功能複製已選取的文字。");}
  }
  return <details className="rounded-2xl border p-4">
    <summary className="min-h-11 cursor-pointer py-2 font-bold">我遇到困難</summary>
    <p className="mt-2 text-sm">哪一項最接近目前的情況？</p>
    <div aria-label="選擇目前的困難" role="group" className="my-2 flex flex-wrap gap-2">
      {reasons.map(([value,label])=><Button type="button" key={value} variant="secondary" aria-pressed={reason===value} aria-controls={contentId} onClick={()=>choose(value)}>{label}</Button>)}
    </div>
    <div id={contentId}>
      {reason==="size"?<p role="status" className="text-sm">上方已顯示準備動作。先完成這個小動作即可，原來的步驟仍會保留。</p>:null}
      {reason && reason!=="size"?<div className="space-y-2">
        <label className="block text-sm font-semibold">{reason==="information"?"索取資料草稿":"請對方決定的草稿"}
          <textarea ref={input} value={draft} onChange={e=>edit(e.target.value)} maxLength={2000} rows={3} className="field mt-1 block w-full"/>
        </label>
        <p className="text-sm">可將［　］內的文字換成你的問題，再複製到慣用的通訊工具。日序不會代為傳送。</p>
        <Button type="button" variant="secondary" disabled={!draft.trim()} onClick={()=>void copy()}>複製草稿</Button>
        {feedback?<p role="status" className="text-sm">{feedback}</p>:null}
        {storageWarning?<p role="status" className="text-sm">此裝置未能暫存草稿，請在離開前自行複製。</p>:null}
      </div>:null}
    </div>
    <Link href="/body-double" prefetch={false} className="mt-2 inline-flex min-h-11 items-center text-sm underline">查看共同專注選項</Link>
  </details>;
}
