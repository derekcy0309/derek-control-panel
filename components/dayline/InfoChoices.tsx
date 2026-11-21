"use client";
import Link from "next/link";
import {useCallback,useEffect,useState} from "react";
import {isInfoKey,off,preferenceNames,type InfoKey,type InfoPrefs} from "@/lib/publications";
import {RoadWatch} from "./RoadWatch";
export function useInfoChoices(){
 const [prefs,set]=useState<InfoPrefs>(off),[ready,settled]=useState(false),[error,err]=useState(""),[busy,wait]=useState(false),[epoch,reload]=useState(0);
 const retry=useCallback(()=>reload(x=>x+1),[]);
 useEffect(()=>{const c=new AbortController();settled(false);err("");set(off);
  fetch("/api/information",{signal:c.signal,cache:"no-store"}).then(async r=>{if(!r.ok)throw Error();const {prefs:p}=await r.json();if(!p||!Object.keys(off).every(k=>typeof p[k]==="boolean"))throw Error();if(!c.signal.aborted)set(p);}).catch(()=>{if(!c.signal.aborted)err("讀唔到你嘅設定，請重試。");}).finally(()=>{if(!c.signal.aborted)settled(true);});return ()=>c.abort();
 },[epoch]);
 async function change(choice:InfoKey,enabled:boolean){if(busy||!isInfoKey(choice))return;wait(true);try{const r=await fetch("/api/information",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({choice,enabled})});if(!r.ok)throw Error();set(p=>({...p,[choice]:enabled}));err("");}catch{err("設定未儲存，請重試。");}finally{wait(false);}}
 return {prefs,ready,error,busy,change,retry};
}
export function InfoSettings({model}:{model:ReturnType<typeof useInfoChoices>}){
 const {prefs,ready,error,busy,change,retry}=model;
 return <section className="dl-news-card"><h2>我想睇嘅資訊</h2><p>每項預設關閉，只影響你自己。開啟刊物唔會取得其他人嘅刊物。</p>
 {!ready?<p role="status">讀取設定中…</p>:null}{error?<p role="alert">{error} <button onClick={retry}>重新讀取</button></p>:null}
 <div className="dl-choices">{(Object.keys(off) as InfoKey[]).map(k=><label key={k}><input type="checkbox" checked={prefs[k]} disabled={!ready||busy||!!error} onChange={e=>void change(k,e.target.checked)}/>{preferenceNames[k]}</label>)}</div></section>;
}
function UnreadLine(){const [n,set]=useState<number|null>(null);
 useEffect(()=>{let c:AbortController|undefined;const refresh=()=>{c?.abort();c=new AbortController();const signal=c.signal;fetch("/api/publications?view=count",{cache:"no-store",signal}).then(async r=>{if(!r.ok)throw Error();const j=await r.json();if(!signal.aborted)set(Number.isInteger(j.unread)?j.unread:null);}).catch(()=>{if(!signal.aborted)set(null);});};refresh();window.addEventListener("focus",refresh);window.addEventListener("pageshow",refresh);return()=>{c?.abort();window.removeEventListener("focus",refresh);window.removeEventListener("pageshow",refresh);};},[]);
 return n&&n>0?<Link className="dl-pub-line" href="/briefing/publications?mode=unread" prefetch={false}>刊物 · {n} 期未讀</Link>:null;
}
export function PersonalInformation(){const {prefs}=useInfoChoices();return <>{prefs.journals?<UnreadLine/>:null}{prefs.traffic?<RoadWatch compact/>:null}</>;}
