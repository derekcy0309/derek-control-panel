"use client";
import {useCallback,useEffect,useState} from "react";
import {isInfoKey,off,preferenceNames,type InfoKey,type InfoPrefs} from "@/lib/publications";
import {PublicationUnreadHint} from "./PublicationUnreadHint";
import {defaultRoads,validRoads} from "@/lib/road-presets";
export function useInfoChoices(account?:string|null){
 const [prefs,set]=useState<InfoPrefs>(off),[ready,settled]=useState(false),[error,err]=useState(""),[busy,wait]=useState(false),[epoch,reload]=useState(0);
 const [loadedFor,bindAccount]=useState<string|null>();
 const [routes,setRoutes]=useState<string[]>(defaultRoads);
 const retry=useCallback(()=>reload(x=>x+1),[]);
 useEffect(()=>{const c=new AbortController();settled(false);err("");set(off);setRoutes(defaultRoads);if(account===null)return;
  fetch("/api/information",{signal:c.signal,cache:"no-store"}).then(async r=>{if(!r.ok)throw Error();const {prefs:p,routes:sel}=await r.json();if(!p||!Object.keys(off).every(k=>typeof p[k]==="boolean"))throw Error();if(!c.signal.aborted){set(p);setRoutes(validRoads(sel)?sel:defaultRoads);}}).catch(()=>{if(!c.signal.aborted)err("讀唔到你嘅設定，請重試。");}).finally(()=>{if(!c.signal.aborted){bindAccount(account);settled(true);}});return ()=>c.abort();
 },[epoch,account]);
 async function change(choice:InfoKey,enabled:boolean){if(busy||!isInfoKey(choice))return;wait(true);try{const r=await fetch("/api/information",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({choice,enabled})});if(!r.ok)throw Error();set(p=>({...p,[choice]:enabled}));err("");}catch{err("設定未儲存，請重試。");}finally{wait(false);}}
 async function saveRoutes(next:string[]){if(busy||!ready||!validRoads(next))return false;wait(true);try{const r=await fetch("/api/information",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({routes:next})});if(!r.ok)throw Error();setRoutes(next);err("");return true;}catch{err("路段未儲存，可再試。");return false;}finally{wait(false);}}
 const current=ready&&account!==null&&loadedFor===account;
 return {prefs:current?prefs:off,routes:current?routes:defaultRoads,ready:current,error,busy,change,retry,saveRoutes};
}
export function InfoSettings({model}:{model:ReturnType<typeof useInfoChoices>}){
 const {prefs,ready,error,busy,change,retry}=model;
 return <section className="dl-news-card"><h2>我想睇嘅資訊</h2><p>每項預設關閉，只影響你自己。開啟刊物唔會取得其他人嘅刊物。</p>
 {!ready?<p role="status">讀取設定中…</p>:null}{error?<p role="alert">{error} <button onClick={retry}>重新讀取</button></p>:null}
 <div className="dl-choices">{(["journals","news"] as InfoKey[]).map(k=><label key={k}><input type="checkbox" checked={prefs[k]} disabled={!ready||busy||!!error} onChange={e=>void change(k,e.target.checked)}/>{preferenceNames[k]}</label>)}</div></section>;
}
export function PersonalInformation({model}:{model:ReturnType<typeof useInfoChoices>}){return model.ready&&model.prefs.journals?<PublicationUnreadHint/>:null;}
