"use client";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
export function SchoolOnlyCode({onCreated,onLogin}:{onCreated:()=>void;onLogin:()=>void}){
  const [label,setLabel]=useState(""),[mode,setMode]=useState("omit"),[busy,setBusy]=useState(false),[code,setCode]=useState("");
  const [show,setShow]=useState(false),[message,setMessage]=useState(""),[err,setErr]=useState(""),[reauth,setReauth]=useState(false);
  async function create(){
    if(!label.trim()||busy)return;setBusy(true);setErr("");setMessage("");setReauth(false);
    try{
      const r=await fetch("/api/school-bot-review",{method:"POST",cache:"no-store",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"newCode",label:label.trim(),mode})});
      const d=await r.json();if(!r.ok){setReauth(d.reauth===true);throw new Error(d.error||"未能建立 Code。");}
      setShow(false);setCode(d.accessCode);setMessage("已建立，有效 30 日。請放入該 bot 嘅安全憑證欄，唔好貼入對話。");onCreated();
    }catch(e){setErr(e instanceof Error?e.message:"未能確認結果；請先重新讀取授權。");}finally{setBusy(false);}
  }
  return <details className="mt-3 rounded-xl bg-slate-50 p-3" onToggle={e=>{if(!e.currentTarget.open){setCode("");setShow(false);setMessage("");}}}>
    <summary className="min-h-11 cursor-pointer py-2 font-bold">俾另一個 bot：建立只限學校嘅 Code</summary>
    <p className="mb-3 text-sm">一個 bot 一個 Code；唔會開 Task、Notes、Calendar 或其他人嘅資料。</p>
    {!code?<form className="grid gap-2" onSubmit={e=>{e.preventDefault();void create();}}>
      <label>Bot 名稱<input className="field mt-1" required maxLength={50} value={label} onChange={e=>setLabel(e.target.value)} placeholder="例如：我的學校 GPT"/></label>
      <label>敏感事項<select className="field mt-1" value={mode} onChange={e=>setMode(e.target.value)}><option value="omit">完全不分享</option><option value="redact">只顯示日期，隱去名稱</option></select></label>
      <div><Button type="submit" disabled={busy||!label.trim()}>確認開放，建立獨立 Code</Button></div></form>:<div className="space-y-2">
      <label>學校 Bot Access Code（只顯示今次）<input type={show?"text":"password"} className="field" autoComplete="off" readOnly value={code}/></label>
      <div className="flex flex-wrap gap-2"><Button type="button" variant="secondary" onClick={()=>void navigator.clipboard.writeText(code).then(()=>setMessage("Code 已複製，請放入安全憑證欄。")).catch(()=>setErr("請按顯示，再自行複製。"))}>複製 Code</Button><Button type="button" variant="secondary" onClick={()=>setShow(!show)}>{show?"隱藏":"顯示 Code"}</Button><Button type="button" variant="secondary" onClick={()=>{setCode("");setShow(false);setLabel("");setMessage("已收起 Code。");}}>已保存，收起</Button></div>
      <p className="text-sm">Bot 可用 /agent 登入，或用 <a className="underline" href="/agent-school-openapi.yaml">學校 API 規格</a> 連接。</p></div>}
    {message?<p role="status" className="text-sm">{message}</p>:null}{err?<p role="alert" className="text-sm">{err}</p>:null}
    {reauth?<Button type="button" variant="secondary" onClick={onLogin}>用 Google 重新登入</Button>:null}</details>;
}
