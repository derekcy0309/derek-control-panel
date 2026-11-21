"use client";
import Link from "next/link";
import {useCallback,useEffect,useState} from "react";
import {isInfoKey,off,preferenceNames,type InfoKey,type InfoPrefs} from "@/lib/publications";
import {RoadWatch} from "./RoadWatch";
import {defaultRoads,validRoads} from "@/lib/road-presets";
export function useInfoChoices(account?:string|null){
 const [prefs,set]=useState<InfoPrefs>(off),[ready,settled]=useState(false),[error,err]=useState(""),[busy,wait]=useState(false),[epoch,reload]=useState(0);
 const [routes,setRoutes]=useState<string[]>(defaultRoads);
 const retry=useCallback(()=>reload(x=>x+1),[]);
 useEffect(()=>{const c=new AbortController();settled(false);err("");set(off);setRoutes(defaultRoads);if(account===null)return;
  fetch("/api/information",{signal:c.signal,cache:"no-store"}).then(async r=>{if(!r.ok)throw Error();const {prefs:p,routes:sel}=await r.json();if(!p||!Object.keys(off).every(k=>typeof p[k]==="boolean"))throw Error();if(!c.signal.aborted){set(p);setRoutes(validRoads(sel)?sel:defaultRoads);}}).catch(()=>{if(!c.signal.aborted)err("讀唔到你嘅設定，請重試。");}).finally(()=>{if(!c.signal.aborted)settled(true);});return ()=>c.abort();
 },[epoch,account]);
 async function change(choice:InfoKey,enabled:boolean){if(busy||!isInfoKey(choice))return;wait(true);try{const r=await fetch("/api/information",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({choice,enabled})});if(!r.ok)throw Error();set(p=>({...p,[choice]:enabled}));err("");}catch{err("設定未儲存，請重試。");}finally{wait(false);}}
 async function saveRoutes(next:string[]){if(busy||!ready||!validRoads(next))return false;wait(true);try{const r=await fetch("/api/information",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({routes:next})});if(!r.ok)throw Error();setRoutes(next);err("");return true;}catch{err("路段未儲存，可再試。");return false;}finally{wait(false);}}
 return {prefs,routes,ready,error,busy,change,retry,saveRoutes};
}
export function InfoSettings({model}:{model:ReturnType<typeof useInfoChoices>}){
 const {prefs,ready,error,busy,change,retry}=model;
 return <section className="dl-news-card"><h2>我想睇嘅資訊</h2><p>每項預設關閉，只影響你自己。開啟刊物唔會取得其他人嘅刊物。</p>
 {!ready?<p role="status">讀取設定中…</p>:null}{error?<p role="alert">{error} <button onClick={retry}>重新讀取</button></p>:null}
 <div className="dl-choices">{(["journals","news"] as InfoKey[]).map(k=><label key={k}><input type="checkbox" checked={prefs[k]} disabled={!ready||busy||!!error} onChange={e=>void change(k,e.target.checked)}/>{preferenceNames[k]}</label>)}</div><p><Link className="dl-textbtn" href="/briefing/traffic">首頁交通實況及路段設定（毋須訂閱）</Link></p></section>;
}
function UnreadLine(){const [n,set]=useState<number|null>(null);
 useEffect(()=>{let c:AbortController|undefined;const refresh=()=>{c?.abort();c=new AbortController();const signal=c.signal;fetch("/api/publications?view=count",{cache:"no-store",signal}).then(async r=>{if(!r.ok)throw Error();const j=await r.json();if(!signal.aborted)set(Number.isInteger(j.unread)?j.unread:null);}).catch(()=>{if(!signal.aborted)set(null);});};refresh();window.addEventListener("focus",refresh);window.addEventListener("pageshow",refresh);return()=>{c?.abort();window.removeEventListener("focus",refresh);window.removeEventListener("pageshow",refresh);};},[]);
 return n&&n>0?<Link className="dl-pub-line" href="/briefing/publications?mode=unread" prefetch={false}>刊物 · {n} 期未讀</Link>:null;
}
export function PersonalInformation({model}:{model:ReturnType<typeof useInfoChoices>}){return model.ready&&model.prefs.journals?<UnreadLine/>:null;}
export function HomeRoads({model}:{model:ReturnType<typeof useInfoChoices>}){return model.ready&&model.prefs.traffic?<RoadWatch compact model={model}/>:null;}
