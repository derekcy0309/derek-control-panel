"use client";
import Link from "next/link";
import {useEffect,useState} from "react";
import {useSearchParams} from "next/navigation";
import {series,safeSource,validBlocks,type Details,type Issue} from "@/lib/publications";
import {PublicationReceipts} from "./PublicationReceipts";
import {EditorialCover} from "./EditorialCover";
import styles from "./reading-room.module.css";
async function write(body:Record<string,unknown>,signal?:AbortSignal){const r=await fetch("/api/publications",{method:"POST",cache:"no-store",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),signal});if(!r.ok)throw Error();}
function Save({issue,onSaved}:{issue:Pick<Issue,"saved"|"id">;onSaved:(saved:boolean)=>void}){
 const [busy,wait]=useState(false),[err,error]=useState(false);
 return <><button className={styles.bookmark} type="button" disabled={busy} aria-pressed={issue.saved} onClick={async()=>{const wanted=!issue.saved;wait(true);error(false);try{await write({id:issue.id,action:"save",wanted});onSaved(wanted);}catch{error(true);}finally{wait(false);}}}>{issue.saved?"★ 已收藏":"☆ 收藏"}</button>{err?<span role="alert">未儲存，可再按一次。</span>:null}</>;
}
function Reader({issue,anchor}:{issue:Details;anchor:string}){
 const [saved,setSaved]=useState(issue.saved),[marked,setMarked]=useState(issue.read),[err,error]=useState(false),[tryNo,retry]=useState(0);
 useEffect(()=>{if(/^p-\d+$/.test(anchor)){const el=document.getElementById(anchor);if(el){el.focus({preventScroll:true});el.scrollIntoView({block:"center"});}}},[anchor,issue.id]);
 useEffect(()=>{if(marked)return;const c=new AbortController();let started=false;
   const mark=()=>{if(started||document.visibilityState!=="visible"||c.signal.aborted)return;started=true;write({id:issue.id,action:"read",seen:issue.revision},c.signal).then(()=>{if(!c.signal.aborted)setMarked(true);}).catch(()=>{if(!c.signal.aborted)error(true);});};
   const frame=requestAnimationFrame(mark);document.addEventListener("visibilitychange",mark);
   return ()=>{cancelAnimationFrame(frame);document.removeEventListener("visibilitychange",mark);c.abort();};
 },[issue.id,issue.revision,marked,tryNo]);
 return <article className={styles.reader}>
 <p className={styles.kicker}>{series[issue.series]}{issue.sourceKind==="codex-trial"?" · 試刊":""}</p>
 <h1>{issue.title}</h1>
 <p className={styles.meta}>出刊：<time dateTime={issue.published}>{issue.published}</time> · 涵蓋 {issue.from} 至 {issue.until} · 版本 {issue.version}</p>
 <div className={styles.readerActions}><Save issue={{id:issue.id,saved}} onSaved={setSaved}/> <small>{marked?"已讀":"未記錄已讀"}</small></div>
 {err&&!marked?<p role="alert">內文已載入，但未能記錄已讀。<button className={styles.quiet} type="button" onClick={()=>{error(false);retry(x=>x+1);}}>再試</button></p>:null}
 <div className={styles.readerCover}><EditorialCover art={issue.series==="us"?"market":"medical"}/></div>
 <div className={styles.prose}>{issue.blocks.map((b,i)=><section key={i} id={"p-"+i} tabIndex={-1} className={anchor==="p-"+i?"dl-pub-hit":undefined}>{b.heading?<h2>{b.text}</h2>:<p>{b.text}</p>}{b.links.map((l,k)=>safeSource(l.href)?<a key={k} href={l.href} target="_blank" referrerPolicy="no-referrer" rel="noopener noreferrer">{l.label} ↗</a>:null)}</section>)}</div>
 </article>;
}
export function PublicationReader({id,anchor}:{id:string;anchor:string}){
 const [data,set]=useState<Details|null>(null),[error,err]=useState(""),[epoch,retry]=useState(0);
 useEffect(()=>{const c=new AbortController();set(null);err("");fetch("/api/publications?view=issue&id="+encodeURIComponent(id),{cache:"no-store",signal:c.signal}).then(async r=>{if(!r.ok)throw Error(r.status===404?"刊物唔存在、未開啟，或你未獲授權。":"未能載入完整內文。");const j=await r.json();if(j.issue?.id!==id||!validBlocks(j.issue.blocks)||!/^[0-9a-f]{64}$/.test(j.issue.revision))throw Error("內文未完整載入。");if(!c.signal.aborted)set(j.issue);}).catch(e=>{if(!c.signal.aborted)err(e.message||"未能載入刊物。");});return()=>c.abort();},[id,epoch]);
 return data?<Reader key={data.id+data.revision} issue={data} anchor={anchor}/>:error?<p role="alert">{error} <button onClick={()=>retry(x=>x+1)}>重試</button></p>:<p role="status">讀取完整內文中…</p>;
}
export function PublicationShelf({section}:{section:string}){
 const params=useSearchParams(),id=params.get("issue")||"",initial=params.get("mode")||"all";
 const [cat,category]=useState(section==="medical"?"medical":section==="evening"?"us":"all"),[mode,filter]=useState(["saved","unread"].includes(initial)?initial:"all"),[month,setMonth]=useState(""),[draft,setDraft]=useState(""),[q,query]=useState(""),[offset,page]=useState(0),[epoch,retry]=useState(0),[items,set]=useState<Issue[]>([]),[error,err]=useState(false),[loading,wait]=useState(true),[more,next]=useState(false);
 useEffect(()=>{if(id)return;const c=new AbortController();wait(true);err(false);set([]);next(false);
   fetch("/api/publications?"+new URLSearchParams({category:cat,mode,month,q,offset:String(offset)}),{cache:"no-store",signal:c.signal}).then(async r=>{if(!r.ok)throw Error();const d=await r.json();if(!Array.isArray(d.items))throw Error();if(!c.signal.aborted){set(d.items);next(!!d.more);}}).catch(()=>{if(!c.signal.aborted)err(true);}).finally(()=>{if(!c.signal.aborted)wait(false);});return()=>c.abort();
 },[id,cat,mode,month,q,offset,epoch]);
 if(id)return <><Link className={styles.quiet} href={"/briefing/"+section+"?mode="+mode} prefetch={false}>← 返刊物清單</Link><PublicationReader key={id} id={id} anchor={params.get("at")||""}/></>;
 return <section className={styles.shelf}><header className={styles.detailHeader}><p className={styles.kicker}>THE ARCHIVE</p><h1>{section==="medical"?"醫療期刊":section==="evening"?"美股晚報":"刊物庫"}</h1>
 <p className={styles.muted}>按原本出刊日期由新到舊。收藏同已讀分開。</p></header>
 <form className={`dl-pub-filters ${styles.filters}`} onSubmit={e=>{e.preventDefault();page(0);query(draft.trim());}}>
 <div className={styles.searchRow}><label>搜尋標題、全文<input type="search" maxLength={100} value={draft} onChange={e=>setDraft(e.target.value)} placeholder="例如 BRCA"/></label><button className={styles.primary} type="submit">搜尋</button></div>
 <label>刊物分類<select value={cat} onChange={e=>{page(0);category(e.target.value);}}><option value="all">所有刊物</option><option value="medical">所有醫療期刊</option>{Object.entries(series).map(([k,l])=><option key={k} value={k}>{l}</option>)}</select></label>
 <label>月份<input type="month" value={month} onChange={e=>{page(0);setMonth(e.target.value);}}/></label>
 <label>閱讀狀態<select value={mode} onChange={e=>{page(0);filter(e.target.value);}}><option value="all">全部</option><option value="unread">未讀</option><option value="saved">已收藏</option></select></label></form>
 {error?<p role="alert">未能讀取刊物庫，唔代表冇新刊。 <button onClick={()=>retry(x=>x+1)}>重試</button></p>:loading?<p role="status">讀取刊物中…</p>:!items.length?<p>{mode==="unread"?"已收錄刊物中冇符合條件嘅未讀期數。":mode==="saved"?"暫時冇符合條件嘅收藏。":"暫時冇已收錄嘅刊物符合條件。"}</p>:null}
 {items.length>0?<div className={styles.archive}>
 {items.map(v=>{const a=v.anchor!==null&&v.anchor!==undefined?"p-"+v.anchor:"";const u=new URLSearchParams({issue:v.id,mode,...(a?{at:a}:{})});return <article key={v.id} className={styles.issue}>
 <div>
 <p className={styles.issueSeries}><span>{series[v.series]}</span><span className={styles.readState} data-unread={!v.read}>{v.read?"已讀":"未讀"}</span></p>
 <h2><Link prefetch={false} href={"/briefing/"+section+"?"+u+(a?"#"+a:"")}>{v.title}</Link></h2>
 <p className={styles.meta}>出刊 <time dateTime={v.published}>{v.published}</time> · 涵蓋 {v.from} 至 {v.until}</p>
 <p>{v.lead}</p>{v.snippet?<blockquote>{v.snippet}</blockquote>:null}
 </div>
 <div className={styles.issueSave}><Save issue={v} onSaved={saved=>set(all=>all.flatMap(item=>item.id!==v.id?[item]:mode==="saved"&&!saved?[]:[{...item,saved}]))}/></div>
 </article>;})}</div>:null}
 {(offset>0||more)?<nav aria-label="刊物分頁"><button className={styles.outline} disabled={!offset||loading} onClick={()=>page(x=>Math.max(0,x-25))}>上一頁</button><button className={styles.outline} disabled={!more||loading} onClick={()=>page(x=>x+25)}>下一頁</button></nav>:null}
 <PublicationReceipts/>
 </section>;
}
