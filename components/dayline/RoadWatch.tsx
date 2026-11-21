"use client";
import Link from "next/link";
import {useEffect,useState} from "react";
import {CarFront,Route,Radio} from "lucide-react";
import {recentReading,roadWords,trafficHighlights,roadSource,tollSource,tollTable,type Journey,type RoadReport} from "@/lib/roadwatch";
const hk=(s:string,date=false)=>new Intl.DateTimeFormat("zh-HK",{timeZone:"Asia/Hong_Kong",...(date?{month:"numeric",day:"numeric"} as const:{}),hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(s));
function RoadLine({r,now}:{r:Journey;now:number}){
 const live=recentReading(r.at,now);return <li className="dl-road-line"><div><strong>{r.start}</strong><span>往 {r.dest}</span></div><div><b data-state={live?r.status:"unknown"}>{live?roadWords[r.status]:"資料較舊"}</b>{live&&r.minutes!==null?<span>約 {r.minutes} 分鐘</span>:null}<small>量度 {hk(r.at,true)}</small></div></li>;
}
export function RoadWatch({compact=false}:{compact?:boolean}){
 const [data,setData]=useState<RoadReport|null>(null),[vehicle,setVehicle]=useState<"PC"|"MC">("PC"),[area,setArea]=useState("全部"),[find,setFind]=useState(""),[revision,setRevision]=useState(0),[error,setError]=useState(false),[busy,setBusy]=useState(true),[now,setNow]=useState(Date.now);
 useEffect(()=>{let alive=true,inFlight=false;const controller=new AbortController();async function read(){if(inFlight||document.hidden)return;inFlight=true;setBusy(true);try{const r=await fetch("/api/hk-traffic?vehicle="+vehicle,{cache:"no-store",credentials:"omit",signal:controller.signal});if(!r.ok)throw Error();const snap=await r.json() as RoadReport;if(alive){setData(snap);setNow(Date.now());setError(false);}}catch{if(alive)setError(true);}finally{inFlight=false;if(alive)setBusy(false);}}
   void read();let minute=Math.floor(Date.now()/60000);const timer=window.setInterval(()=>{const t=Date.now();setNow(t);if(Math.floor(t/60000)!==minute){minute=Math.floor(t/60000);void read();}},5000);const visible=()=>{if(!document.hidden){setNow(Date.now());void read();}};document.addEventListener("visibilitychange",visible);return ()=>{alive=false;controller.abort();clearInterval(timer);document.removeEventListener("visibilitychange",visible);};
 },[vehicle,revision]);
 const readings=data?.roads??[],high=trafficHighlights(readings,now),matches=readings.filter(r=>(area==="全部"||r.area===area)&&(!find||[r.start,r.dest].some(s=>s.includes(find.trim()))));
 const expired=!data||now-Date.parse(data.at)>2*60000||now<Date.parse(data.at)-120000;
 return <section className={compact?"dl-library dl-traffic-mini":"dl-news-card dl-roadpage"} aria-label="主要幹道路況">
   <header className="dl-news-subhead"><div><span className="dl-section-kicker">ON THE ROAD / 香港</span><h2><Route aria-hidden="true"/>主要幹道路況</h2></div>{compact?<Link className="dl-chip" href="/briefing/traffic">交通及隧道費</Link>:<button className="dl-textbtn" disabled={busy} onClick={()=>setRevision(x=>x+1)}>{busy?"更新緊…":"更新路況"}</button>}</header>
   {!data&&!error?<p role="status">讀取運輸署路況中…</p>:null}{error?<p role="status">暫時更新唔到。{data?"以下資料請留意量度時間。":"請稍後重試。"} <button className="dl-textbtn" onClick={()=>setRevision(x=>x+1)}>重試</button></p>:null}
   {data?<><p>按運輸署行車時間顯示器，較擠塞嘅路段行先；唔代表全港每一段路。</p>{high.length?<ul className="dl-road-list">{high.map(r=><RoadLine key={r.key} r={r} now={now}/>)}</ul>:<p>暫時冇足夠新嘅路況讀數；唔代表道路暢順。</p>}
     {compact&&data.notices?.[0]&&!expired?<p><Radio aria-hidden="true"/> 交通消息：{data.notices[0].place} {data.notices[0].direction&&"・往"+data.notices[0].direction}</p>:null}</>:null}
   {!compact?<><details><summary>睇各區路段／揀方向</summary><div className="dl-linkform"><label>出發地區<select value={area} onChange={e=>setArea(e.target.value)}>{["全部","港島","九龍","新界"].map(a=><option key={a}>{a}</option>)}</select></label><label>搵道路或目的地<input value={find} onChange={e=>setFind(e.target.value)} placeholder="例如：屯門、獅子山、東隧"/></label></div>
    {matches.length?<ul className="dl-road-list">{matches.map(r=><RoadLine key={r.key} r={r} now={now}/>)}</ul>:<p>呢個範圍暫時未有顯示器讀數。</p>}</details>
    <section className="dl-road-block"><h3><Radio aria-hidden="true"/>特別交通消息</h3>{data?.notices&&!expired?(data.notices.length?<ul>{data.notices.map(n=><li key={n.id}><div><strong>{n.place}{n.direction&&" · 往"+n.direction}</strong><p>{n.body}</p><small>運輸署公布：{hk(n.at,true)}</small></div></li>)}</ul>:<p>最近一次成功查詢，運輸署暫無生效消息。</p>):<p>未能確認最新交通消息，唔代表冇事故。</p>}</section>
    <section className="dl-road-block"><h3><CarFront aria-hidden="true"/>而家隧道費</h3><p>按香港時間及運輸署收費表計算（港元），唔係收費亭實報或你嘅扣款紀錄。</p><label>車種<select aria-label="車種" value={vehicle} onChange={e=>{setVehicle(e.target.value as "PC"|"MC");setData(null);}}><option value="PC">私家車</option><option value="MC">電單車</option></select></label>
      {data?<><p>計算時間 {hk(data.at,true)} · {data.period==="holiday"?"星期日／公眾假期":data.period==="weekday"?"星期一至六（非公眾假期）":"假期日曆未能確認"}</p>{(!data.variableOK||expired)?<p>未能確認此刻嘅分時收費，請到官方即時查詢。</p>:null}
        <ul className="dl-fares">{data.tolls.filter(t=>t.variable&&!expired&&t.until&&Date.parse(t.until)>now).map(t=><li key={t.name}><span>{t.name==="海底隧道"?"紅磡海底隧道（紅隧）":t.name}</span><strong>HK$ {t.fee}</strong></li>)}</ul>
        <details><summary>其他主要固定收費</summary>{data.fixedOK&&!expired?<ul className="dl-fares">{data.tolls.filter(t=>!t.variable).map(t=><li key={t.name}><span>{t.name}</span><strong>HK$ {t.fee}</strong></li>)}</ul>:<p>未能核實最新固定收費。</p>}</details></>:null}
      <a className="dl-textbtn" href={tollSource} rel="noopener noreferrer" target="_blank">香港出行易：即時收費及其他車種</a></section>
    <footer className="dl-news-foot">此頁開住時每分鐘再查；路況量度時間逐段列明。資料：<a href={roadSource} rel="noreferrer" target="_blank">運輸署行車時間</a>、<a href={tollTable} rel="noreferrer" target="_blank">隧道收費表</a>。駕駛途中請勿操作。</footer></>:null}
 </section>;
}
