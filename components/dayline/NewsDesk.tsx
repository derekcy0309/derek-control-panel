"use client";
import Link from "next/link";
import {useEffect,useState} from "react";
import {Bookmark,ChartNoAxesCombined,Library,Newspaper} from "lucide-react";
import {isNewsSection,marketBrief,marketIndices,sections,type NewsIssue,type NewsSection,type Story} from "@/lib/briefing";
import {HomeLinks,writeLink} from "./HomeLinks";
import {InfoSettings,useInfoChoices} from "./InfoChoices";
import {PublicationShelf} from "./PublicationShelf";
import {RoadWatch} from "./RoadWatch";
const dateText=(value:string)=>new Intl.DateTimeFormat("zh-HK",{timeZone:"Asia/Hong_Kong",month:"short",day:"numeric",weekday:"short",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(value));
function IndexCharts(){
  const [show,setShow]=useState(false),[index,setIndex]=useState(0);
  const current=marketIndices[index];
  return <section className="dl-news-card"><span className="dl-section-kicker">MARKETS</span><h2><ChartNoAxesCombined aria-hidden="true"/>主要市場指數走勢圖</h2>
    <p>美股、港股同日本；報價按來源及交易時段更新，可能延遲。圖表只喺你撳開後先連接 TradingView。</p>
    <label>揀指數 <select value={index} onChange={e=>setIndex(Number(e.target.value))}>{marketIndices.map((i,n)=><option key={i.symbol} value={n}>{i.label}</option>)}</select></label>
    <div className="dl-library-tools"><button className="dl-chip" aria-expanded={show} onClick={()=>setShow(!show)}>{show?"收起圖表":"載入走勢圖"}</button><a href={"https://www.tradingview.com/symbols/"+current.path+"/"} rel="noopener noreferrer" target="_blank">到來源睇 {current.label} 圖表</a></div>
    {show?<><iframe title={current.label+"走勢圖（TradingView）"} src={"/api/market-chart?index="+index} referrerPolicy="no-referrer" sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox" className="dl-chart"/><a href={"https://www.tradingview.com/symbols/"+current.path+"/"} target="_blank" rel="noopener noreferrer">圖表由 TradingView 提供</a></>:null}
  </section>;
}
function StoryLine({story}:{story:Story}){
  const [state,setState]=useState<"idle"|"busy"|"done"|"failed">("idle");
  async function later(){if(state==="busy"||state==="done")return;setState("busy");try{await writeLink({action:"save",url:story.url,title:story.title.slice(0,120),shelf:"later"});setState("done");window.dispatchEvent(new Event("dayline:links"));}catch{setState("failed");}}
  return <li><div><a href={story.url} target="_blank" rel="noopener noreferrer">{story.title}</a><small>{story.source}{story.date?<> · <time dateTime={story.date}>{dateText(story.date)}</time></>:null}</small></div><button onClick={()=>void later()} disabled={state==="busy"||state==="done"} aria-label={story.title+"，稍後睇"}><Bookmark aria-hidden="true"/>{state==="done"?"已收藏":state==="failed"?"未儲存，重試":state==="busy"?"儲存中":"稍後睇"}</button></li>;
}
function NewsPage({section}:{section:NewsSection}){
  const [data,setData]=useState<NewsIssue|null>(null),[error,setError]=useState(""),[updated,setUpdated]=useState(0),[loading,setLoading]=useState(true);
  useEffect(()=>{const c=new AbortController();setLoading(true);setError("");
    fetch("/api/briefing?section="+section,{cache:"no-store",credentials:"same-origin",signal:c.signal}).then(async r=>{if(!r.ok)throw Error();const value=await r.json() as NewsIssue;if(!c.signal.aborted)setData(value);}).catch(()=>{if(!c.signal.aborted)setError("暫時讀唔到新聞，請檢查連線再試。");}).finally(()=>{if(!c.signal.aborted)setLoading(false);});return ()=>c.abort();
  },[section,updated]);
  return <><div className="dl-news-subhead"><h2>{sections[section]}</h2><button className="dl-textbtn" disabled={loading} onClick={()=>setUpdated(x=>x+1)}>{loading?"讀取中…":"重新讀取"}</button></div>
    {error?<p role="alert">{error}{data?" 以下保留上次畫面。":""}</p>:null}
    {section==="markets"&&data?<section className="dl-news-card"><span className="dl-section-kicker">MARKET BRIEF / 香港時間</span><h3>美股／港股速讀</h3><p>各市場揀一條近期重點，優先大市、AI、醫療同新上市。留意刊登時間，唔當即時報價或收市總結。</p><ul>{marketBrief(data.groups,new Date(data.checkedAt)).map(x=><StoryLine key={x.market} story={x.story}/>)}</ul>{!marketBrief(data.groups,new Date(data.checkedAt)).length?<p>暫無可核實日期嘅近期市場重點。</p>:null}</section>:null}
    {section==="markets"?<IndexCharts/>:null}
    {loading&&!data?<p role="status">讀取來源標題中…</p>:null}
    {data?.groups?.map(g=><section className="dl-news-card" key={g.label}><span className="dl-section-kicker">{section==="gadgets"?"原廠發布":section==="care"?"社福界動向":"公開新聞"}</span><h3>{g.label}</h3>
      {g.state==="unavailable"?<p role="status">呢個來源暫時讀唔到；可以稍後重試或打開來源。</p>:g.stories.length?<ul>{g.stories.map(s=><StoryLine key={s.url} story={s}/>)}</ul>:<p>來源最新一批標題暫時冇符合呢個主題嘅項目，唔代表市場冇變化。</p>}
      <a className="dl-textbtn" target="_blank" rel="noopener noreferrer" href={g.sourceUrl}>到 {g.source} 睇原文</a></section>)}
    {data?<p className="dl-news-foot">上次檢查：{dateText(data.checkedAt)}（香港時間）。每篇刊登日期另列；新聞唔會彈通知或加入 Task。</p>:null}</>;
}
export function NewsDesk({section}:{section:string}){
  const model=useInfoChoices(),publication=["medical","evening","publications"].includes(section);
  const key=publication?"journals":"news";
  return <main className="dl-desk"><Link href="/" className="dl-textbtn">返今日總覽</Link><header><span className="dl-section-kicker">DAYLINE / READING ROOM</span><h1><Newspaper aria-hidden="true"/>資訊站</h1><p>想睇先打開。常用網站同稍後睇嘅新聞都喺自己帳戶。</p></header>
    <nav aria-label="資訊分類"><Link href="/briefing/medical" aria-current={section==="medical"?"page":undefined}>醫療期刊</Link><Link href="/briefing/evening" aria-current={section==="evening"?"page":undefined}>美股晚報</Link><Link href="/briefing/publications" aria-current={section==="publications"?"page":undefined}>所有刊物</Link><Link href="/briefing/traffic" aria-current={section==="traffic"?"page":undefined}>交通路況</Link>{Object.entries(sections).map(([s,l])=><Link href={"/briefing/"+s} key={s} aria-current={section===s?"page":undefined}>{l}</Link>)}<Link href="/briefing/library" aria-current={section==="library"?"page":undefined}><Library aria-hidden="true"/>我的收藏</Link><Link href="/briefing/preferences" aria-current={section==="preferences"?"page":undefined}>資訊設定</Link></nav>
    {section==="library"?<HomeLinks full/>:section==="preferences"?<InfoSettings model={model}/>:section==="traffic"?<RoadWatch model={model}/>:!model.ready?<p role="status">讀取你嘅設定中…</p>:!model.prefs[key]||model.error?<InfoSettings model={model}/>:publication?<PublicationShelf key={section} section={section}/>:isNewsSection(section)?<NewsPage key={section} section={section}/>:null}</main>;
}
