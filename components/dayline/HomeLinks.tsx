"use client";
import Link from "next/link";
import {useCallback,useEffect,useState} from "react";
import {Bookmark,BookOpen,Globe,Plus} from "lucide-react";
import {usefulLinks,websiteAddress,type HomeLink,type LinkShelf} from "@/lib/start-links";
type Model={links:HomeLink[];ownerId?:string;more?:boolean;error?:string;link?:HomeLink};
export async function writeLink(body:Record<string,unknown>){
  const res=await fetch("/api/start-links",{method:"POST",credentials:"same-origin",cache:"no-store",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  const data=await res.json().catch(()=>({})) as Model;
  if(!res.ok)throw Error(data.error||"未能儲存，請重試。");return data;
}
export function HomeLinks({full=false,userId}:{full?:boolean;userId?:string}){
  const [rows,setRows]=useState<HomeLink[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(""),[message,setMessage]=useState(""),[more,setMore]=useState(false);
  const [edit,setEdit]=useState(false),[address,setAddress]=useState(""),[name,setName]=useState(""),[busy,setBusy]=useState(false),[remove,setRemove]=useState(""),[shelf,setShelf]=useState<LinkShelf>("site");
  const [revision,setRevision]=useState(0),[reader,setReader]=useState(userId);
  const refresh=useCallback(()=>setRevision(x=>x+1),[]);
  useEffect(()=>{const c=new AbortController();setLoading(true);setError("");
    fetch("/api/start-links",{cache:"no-store",credentials:"same-origin",signal:c.signal}).then(async r=>{const data=await r.json() as Model;if(!r.ok)throw Error(data.error||"未能讀取");if(!c.signal.aborted){setRows(data.links??[]);setMore(Boolean(data.more));setReader(data.ownerId??userId);}}).catch(()=>{if(!c.signal.aborted)setError("未能讀取私人收藏，請重試。");}).finally(()=>{if(!c.signal.aborted)setLoading(false);});
    return ()=>c.abort();
  },[revision,userId]);
  useEffect(()=>{window.addEventListener("dayline:links",refresh);return ()=>window.removeEventListener("dayline:links",refresh);},[refresh]);
  const draftKey=reader?"dcp:note-form-draft:v1:"+reader+":website:"+shelf:null;
  useEffect(()=>{if(!draftKey)return;try{const d=JSON.parse(sessionStorage.getItem(draftKey)||"null");setAddress(d?.url||"");setName(d?.title||"");}catch{}},[draftKey]);
  function draft(url:string,title:string){setAddress(url);setName(title);if(draftKey){try{if(url||title)sessionStorage.setItem(draftKey,JSON.stringify({url,title}));else sessionStorage.removeItem(draftKey);}catch{}}}
  async function save(){if(busy)return;if(!websiteAddress(address)){setError("請輸入有效嘅 http 或 https 網址，例如 example.com。");return;}setBusy(true);setError("");try{await writeLink({action:"save",url:address,title:name,shelf});draft("","");setEdit(false);setMessage("已儲存到自己嘅收藏。");refresh();}catch(e){setError(e instanceof Error?e.message:"未能儲存；請重試。");}finally{setBusy(false);}}
  async function archive(id:string){if(busy)return;setBusy(true);setError("");try{await writeLink({action:"remove",id});setRemove("");setRows(current=>current.filter(v=>v.id!==id));setMessage("已從收藏移除。");}catch(e){setError(e instanceof Error?e.message:"未能移除。");}finally{setBusy(false);}}
  const shown=rows.filter(v=>v.shelf===shelf);
  return <section className="dl-library" aria-label={full?"我的收藏":"我的網頁"}>
    <header><div><span className="dl-section-kicker">MY SPACE</span><h2><Globe aria-hidden="true"/>{full?"我的收藏":"我的網頁"}</h2></div>{!full?<Link className="dl-chip" href="/briefing/local"><BookOpen aria-hidden="true"/>資訊站</Link>:null}</header>
    {full?<nav className="dl-shelves" aria-label="收藏分類">{(["site","later"] as const).map(s=><button type="button" aria-pressed={shelf===s} key={s} onClick={()=>{setShelf(s);setRemove("");setEdit(false);}}>{s==="site"?"我的網頁":"稍後睇"}</button>)}</nav>:null}
    {shelf==="site"?<div className="dl-useful" aria-label="Useful Links 常用捷徑"><h3>常用捷徑 <small>Useful Links</small></h3><div className="dl-linkchips">{usefulLinks.map(link=><a className="dl-chip" key={link.url} href={link.url} target="_blank" rel="noopener noreferrer">{link.title}</a>)}</div><h3>自己儲低嘅網頁</h3></div>:null}
    {error?<p role="alert">{error} <button type="button" className="dl-textbtn" onClick={refresh}>重新讀取</button></p>:null}
    {loading&&!shown.length?<p role="status">讀取自己嘅收藏中…</p>:null}
    {!loading&&!error&&!shown.length?<p>{shelf==="site"?"未有常用網站。貼一次網址，下次一撳就開。":"未有留低嘅報道。見到想睇嘅新聞，可以撳「稍後睇」。"}</p>:null}
    <div className="dl-linkchips">{(full?shown:shown.slice(0,6)).map(v=><span key={v.id} className="dl-linkwrap"><a className="dl-chip" href={v.url} target="_blank" rel="noopener noreferrer" title={v.url}><Bookmark aria-hidden="true"/>{v.title}</a>{full?<button type="button" aria-label={"移除 "+v.title} onClick={()=>setRemove(v.id)}>移除</button>:null}{remove===v.id?<span>確定移除？ <button disabled={busy} onClick={()=>void archive(v.id)}>確定</button><button onClick={()=>setRemove("")}>保留</button></span>:null}</span>)}</div>
    <div className="dl-library-tools"><button type="button" className="dl-textbtn" aria-expanded={edit} onClick={()=>{setEdit(!edit);setMessage("");}}><Plus aria-hidden="true"/>加網址</button>{!full?<Link className="dl-textbtn" href="/briefing/library">管理收藏／稍後睇</Link>:null}{more?<Link className="dl-textbtn" href="/workspace/note">更多私人筆記</Link>:null}</div>
    {edit?<form className="dl-linkform" onSubmit={e=>{e.preventDefault();void save();}}><label>網址<input type="text" inputMode="url" autoCapitalize="none" autoComplete="url" maxLength={1800} required value={address} onChange={e=>draft(e.target.value,name)} placeholder="例如 example.com"/></label><label>名稱（可留空）<input maxLength={120} value={name} onChange={e=>draft(address,e.target.value)} placeholder="預設用網站名稱"/></label><button type="submit" disabled={busy}>{busy?"儲存緊…":"儲存收藏"}</button></form>:null}
    {message?<p role="status">{message}</p>:null}
  </section>;
}
