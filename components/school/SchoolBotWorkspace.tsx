"use client";
import { useRef,useState } from "react";
import { Button } from "@/components/ui/Button";
import type { SchoolChange,SchoolRow } from "@/lib/school-bot";
type Draft={operation:"create"|"update"|"delete";row?:SchoolRow};
async function api(path:string,body?:object){
  const r=await fetch(path,{method:body?"POST":"GET",cache:"no-store",...(body?{headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}:{})});
  const value=await r.json();if(!r.ok)throw new Error(value.error||"未能讀取，請重試。");return value;
}
function Suggestion({draft,done,cancel}:{draft:Draft;done:(message:string)=>void;cancel:()=>void}){
  const [title,setTitle]=useState(""),[date,setDate]=useState(draft.row?.date??""),[changeDate,setChangeDate]=useState(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState("");const request=useRef<{key:string;id:string}|null>(null);
  async function submit(){
    if(busy)return;setBusy(true);setError("");
    const changes:SchoolChange={};
    if(draft.operation!=="delete"){if(title.trim())changes.title=title.trim();if(draft.operation==="create"||changeDate)changes.date=date||null;}
    const body={operation:draft.operation,...(draft.row?{itemId:draft.row.id,version:draft.row.version}:{}),changes};
    try {
      const key=JSON.stringify(body);if(request.current?.key!==key)request.current={key,id:crypto.randomUUID()};
      const result=await api("/api/agent/school",{...body,requestId:request.current.id});
      done(result.status==="pending"?"建議已送出，等本人登入確認。學校記錄未有改動。":"呢個建議之前已經處理，冇重複提交。");
    }catch(e){setError(e instanceof Error?e.message:"未能提交，請重試。");}finally{setBusy(false);}
  }
  const canSend=draft.operation==="delete"||(draft.operation==="create"?!!title.trim():!!title.trim()||changeDate);
  return <form className="grid gap-3 rounded-xl bg-indigo-50 p-3" onSubmit={e=>{e.preventDefault();void submit();}}>
    <p className="font-bold">{draft.operation==="create"?"建議新增":draft.operation==="update"?"建議修改":"建議刪除（封存）"} {draft.row?.title}</p>
    {draft.operation!=="delete"?<><label>事項名稱{draft.operation==="update"?"（唔改就留空）":""}<input className="field mt-1" maxLength={120} value={title} onChange={e=>setTitle(e.target.value)} required={draft.operation==="create"}/></label>
      {draft.operation==="update"?<label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={changeDate} onChange={e=>setChangeDate(e.target.checked)}/>更改日期</label>:null}
      {draft.operation==="create"||changeDate?<label>日期（可留空）<input type="date" className="field mt-1" value={date} onChange={e=>setDate(e.target.value)}/></label>:null}</>:null}
    <div className="flex flex-wrap gap-2"><Button type="submit" disabled={!canSend||busy}>提交建議，等本人確認</Button><Button type="button" variant="secondary" onClick={cancel} disabled={busy}>取消</Button></div>
    {error?<p role="alert">{error}</p>:null}</form>;
}
export function SchoolBotWorkspace({initialOpen=false}:{initialOpen?:boolean}){
  const [rows,setRows]=useState<SchoolRow[]|null>(null),[offset,setOffset]=useState(0),[more,setMore]=useState(false),[busy,setBusy]=useState(false);
  const [draft,setDraft]=useState<Draft|null>(null),[error,setError]=useState(""),[notice,setNotice]=useState("");
  const generation=useRef(0);
  async function load(n:number){
    const v=++generation.current;setBusy(true);setError("");setRows(null);setDraft(null);
    try{const d=await api("/api/agent/school?offset="+n);if(v===generation.current){setRows(d.items);setOffset(n);setMore(d.more);}}
    catch(e){if(v===generation.current)setError(e instanceof Error?e.message:"未能讀取。");}finally{if(v===generation.current)setBusy(false);}
  }
  return <details className="panel p-4" open={initialOpen||undefined} onToggle={e=>{if(e.currentTarget.open)void load(0);else{generation.current++;setRows(null);setDraft(null);setNotice("");setError("");}}}>
    <summary className="min-h-11 cursor-pointer py-2 font-bold">子女及學校 · 已授權 bot</summary>
    <div className="grid gap-3"><p className="text-sm">只讀已開放嘅學校事項。可提議新增、修改或刪除，由擁有人最後確認。</p>
      {busy?<p role="status">讀取中…</p>:null}{error?<p role="alert">{error} <button type="button" className="min-h-11 underline" onClick={()=>void load(offset)}>重試</button></p>:null}
      {notice?<p role="status">{notice}</p>:null}
      {rows!==null?<><div><Button type="button" onClick={()=>{setNotice("");setDraft({operation:"create"});}}>建議新增學校事項</Button></div>
        {draft?<Suggestion key={draft.operation+(draft.row?.id??"")} draft={draft} done={message=>{setNotice(message);setDraft(null);}} cancel={()=>setDraft(null)}/>:null}
        {!rows.length?<p className="text-sm">暫無可讀嘅未完成事項。</p>:null}
        {rows.map(row=><div key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 p-3"><span className="min-w-0 break-words">{row.title} · {row.date||"未設日期"}</span>
          <div className="flex gap-2">{(["update","delete"] as const).map(op=><button type="button" key={op} className="min-h-11 px-2 text-sm font-bold text-indigo-700" onClick={()=>{setNotice("");setDraft({operation:op,row});}}>{op==="update"?"建議修改":"建議刪除"}</button>)}</div></div>)}
        <div className="flex gap-2">{offset>0?<Button variant="secondary" onClick={()=>void load(offset-25)}>上一頁</Button>:null}{more?<Button variant="secondary" onClick={()=>void load(offset+25)}>下一頁</Button>:null}</div></>:null}</div></details>;
}
