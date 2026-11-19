"use client";
import Link from "next/link";
import { useCallback,useEffect,useState } from "react";
import { Button } from "@/components/ui/Button";
import { SchoolOnlyCode } from "./SchoolOnlyCode";
import type { SchoolChange,SchoolGrant,SchoolMode,SchoolProposal } from "@/lib/school-bot";

type State={grants:SchoolGrant[];pending:SchoolProposal[];more:boolean};
const modes:Record<SchoolMode,string>={off:"不開放",redact:"敏感事項隱去名稱，只顯示日期",omit:"敏感事項完全不分享"};
const actions={create:"新增",update:"修改",delete:"刪除（封存）"};
function Details({label,fields}:{label:string;fields:SchoolChange}) {
  return <div className="rounded-lg bg-white p-3"><p className="text-xs font-bold text-slate-600">{label}</p>
    <p className="mt-1 break-words font-semibold">{fields.title}</p><p className="text-sm">日期：{fields.date||"未設"}</p></div>;
}
function GrantChoice({grant,busy,save}:{grant:SchoolGrant;busy:boolean;save:(mode:SchoolMode)=>void}) {
  const [mode,setMode]=useState(grant.mode);
  return <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end"><label className="text-sm font-bold">{grant.label}
    <select aria-label={grant.label+" 學校授權"} className="field mt-1" value={mode} onChange={e=>setMode(e.target.value as SchoolMode)}>
      {Object.entries(modes).map(([val,text])=><option key={val} value={val}>{text}</option>)}
    </select></label><Button type="button" variant="secondary" disabled={busy||mode===grant.mode} onClick={()=>save(mode)}>儲存此授權</Button></div>;
}
export function SchoolBotReview({onApplied}:{onApplied:()=>void}) {
  const [data,setData]=useState<State|null>(null),[error,setError]=useState(""),[notice,setNotice]=useState("");
  const [busy,setBusy]=useState(false),[reauth,setReauth]=useState(false),[selected,setSelected]=useState("");
  const load=useCallback(async(signal?:AbortSignal)=>{
    try {
      const r=await fetch("/api/school-bot-review",{cache:"no-store",signal});const d=await r.json();
      if(!r.ok)throw new Error(d.error||"未能讀取，請重試。");
      if(!signal?.aborted){setData(d);setError("");}
    }catch(e){if(!signal?.aborted){setData(null);setError(e instanceof Error?e.message:"未能讀取，請重試。");}}
  },[]);
  useEffect(()=>{const ac=new AbortController();void load(ac.signal);return()=>ac.abort();},[load]);
  async function decide(action:"scope"|"approve"|"reject",id:string,mode?:SchoolMode){
    if(busy)return;setBusy(true);setError("");setNotice("");setReauth(false);
    try {
      const r=await fetch("/api/school-bot-review",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action,id,mode}),cache:"no-store"});
      const d=await r.json();if(!r.ok){setReauth(d.reauth===true);throw new Error(d.error||"未能完成，請重試。");}
      setNotice(action==="scope"?"已儲存呢個 bot 嘅學校授權。":action==="approve"?"已確認，學校記錄已更新。":"已拒絕，原有記錄冇變。");
      setSelected("");await load();if(action==="approve")onApplied();
    }catch(e){setError(e instanceof Error?e.message:"未能核對結果，請重新載入。");}finally{setBusy(false);}
  }
  async function login(){
    setBusy(true);try{
      const r=await fetch("/api/auth/google",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({next:"/workspace/school"})});
      const d=await r.json();if(!r.ok||!d.url)throw new Error(d.error||"未能開始登入。");window.location.assign(d.url);
    }catch(e){setError(e instanceof Error?e.message:"未能登入，請重試。");}finally{setBusy(false);}
  }
  return <section id="bot-review" className="panel space-y-3 p-4" aria-labelledby="school-bot-review-title"><h2 className="font-bold" id="school-bot-review-title">Bot 建議 · 等我確認</h2>
    {!data&&!error?<p role="status">讀取中…</p>:null}
    {data&&!data.pending.length?<p className="text-sm text-slate-600">暫時冇建議等你確認。</p>:null}
    {data?.pending.map(q=>{
      const label=data.grants.find(g=>g.id===q.grant_id)?.label, open=selected===q.id, after={...q.before_fields,...q.changes};
      return <article key={q.id} className="space-y-2 rounded-xl bg-indigo-50 p-3"><button type="button" aria-expanded={open} className="min-h-11 w-full text-left font-semibold" onClick={()=>setSelected(open?"":q.id)}>{label||"已停用嘅 bot"} 建議{actions[q.operation]}：{after.title||"學校事項"} · {open?"收起":"睇改動"}</button>
        {open?<><div className="grid gap-2 sm:grid-cols-2">{q.before_fields?<Details label="原本" fields={q.before_fields}/>:null}
          {q.operation==="delete"?<p className="rounded-lg bg-white p-3 text-sm">確認後會喺清單移除，保留封存記錄；唔會永久刪除。</p>:<Details label={q.operation==="create"?"會新增（私人、敏感）":"改成"} fields={after}/>}</div>
        <div className="flex flex-wrap gap-2"><Button type="button" disabled={busy||!label} onClick={()=>void decide("approve",q.id)}>本人確認{actions[q.operation]}</Button>
          <Button type="button" variant="secondary" disabled={busy} onClick={()=>void decide("reject",q.id)}>拒絕，維持原狀</Button></div></>:null}</article>;
    })}
    {data?.more?<p className="text-sm">先顯示最早 20 項；處理後會自動補上。</p>:null}
    {notice?<p role="status" className="text-sm text-emerald-800">{notice}</p>:null}
    {error?<div role="alert" className="space-y-2 text-sm text-amber-900"><p>{error}</p>{reauth?<Button type="button" disabled={busy} onClick={()=>void login()}>用 Google 重新登入，再確認</Button>:null}</div>:null}
    <details><summary className="min-h-11 cursor-pointer py-3 text-sm font-bold text-indigo-700">管理邊個 bot 可以用</summary>
      <p className="mb-3 text-sm">逐個 Access Code 開放你自己嘅學校事項。Bot 只睇名稱同日期，睇唔到備註或附件。改動要你登入確認；更改授權會取消該 bot 未處理嘅建議。</p>
      <div className="grid gap-3">{data?.grants.map(g=><GrantChoice key={g.id+g.mode} grant={g} busy={busy} save={mode=>void decide("scope",g.id,mode)}/>)}</div>
      <SchoolOnlyCode onCreated={()=>void load()} onLogin={()=>void login()}/>
      <Link href="/settings#agent-access-title" className="inline-flex min-h-11 items-center text-sm font-bold text-indigo-700">去設定停用整個 Access Code</Link>
    </details><button type="button" className="min-h-11 text-sm text-indigo-700" disabled={busy} onClick={()=>void load()}>重新讀取建議</button></section>;
}
