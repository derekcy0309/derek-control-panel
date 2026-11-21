"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, Cloud, CloudRain, CloudSun, Flag, Moon, Sun, Thermometer } from "lucide-react";
import { briefTime } from "@/lib/calendar-brief";
import { daylineDate } from "@/lib/dayline";
import { weatherLabel, type HkWeather } from "@/lib/dayline-weather";

function Symbol({code}:{code:number|null}) {
  const Icon=code===50?Sun:code!==null&&code>=70&&code<=77?Moon:code!==null&&[53,54,62,63,64,65].includes(code)?CloudRain:code===60||code===61?Cloud:code===51||code===52?CloudSun:Thermometer;
  return <Icon aria-hidden="true"/>;
}
export function WeatherStrip(){
  const [data,setData]=useState<HkWeather|null>(null),[error,setError]=useState(false),[busy,setBusy]=useState(false),[open,setOpen]=useState(false);
  const pending=useRef<AbortController|null>(null);
  const load=useCallback(async()=>{
    if(pending.current)return;const ctl=new AbortController();pending.current=ctl;setBusy(true);
    const timer=setTimeout(()=>ctl.abort(),12000);
    try{
      const response=await fetch("/api/weather/hong-kong",{credentials:"omit",referrerPolicy:"no-referrer",signal:ctl.signal});
      if(!response.ok)throw new Error();
      const value:HkWeather=await response.json();
      const age=Date.now()-Date.parse(value.checkedAt);
      if(!Array.isArray(value.forecast)||(!Array.isArray(value.warnings)&&value.warnings!==null)||!Number.isFinite(age)||age>10*60000||age< -5*60000)throw new Error();
      if(pending.current===ctl){setError(false);setData(value);}
    }catch{if(pending.current===ctl){setError(true);setData(null);}}
    finally{clearTimeout(timer);if(pending.current===ctl){pending.current=null;setBusy(false);}}
  },[]);
  useEffect(()=>{
    const visible=()=>{if(!document.hidden)void load();};
    void load();const t=setInterval(visible,120000);
    document.addEventListener("visibilitychange",visible);window.addEventListener("online",visible);
    return()=>{clearInterval(t);document.removeEventListener("visibilitychange",visible);window.removeEventListener("online",visible);const ctl=pending.current;pending.current=null;ctl?.abort();};
  },[load]);
  const observed=data?.observed, warnings=data?.warnings;
  const partial=!!data && (!observed||data.forecast.length<3||warnings===null);
  return <section className="dl-weather" data-open={open} aria-label="香港天氣">
    <div className="dl-weather-row">
      <div className="dl-current"><span className="dl-sunicon"><Symbol code={observed?.icon??null}/></span>{observed?<b className="dl-temp" aria-label={observed.temperature+" 攝氏度"}>{observed.temperature}<span>°</span></b>:null}<div><strong>香港{observed && weatherLabel(observed.icon)?" · "+weatherLabel(observed.icon):""}</strong><small>{observed?<><a href="https://www.hko.gov.hk/tc/" target="_blank" rel="noreferrer">香港天文台</a> · {briefTime(observed.at)}</>:busy?"讀取天氣中…":"天氣暫未能更新"}</small></div></div>
      <button className="dl-forecast-toggle" type="button" aria-expanded={open} aria-controls="dayline-forecast" onClick={()=>setOpen(!open)}>三日預報<ChevronDown aria-hidden="true"/></button>
      <div className="dl-forecast" id="dayline-forecast">{data?.forecast.map(d=><div key={d.date} className="dl-foreday" title={d.description}><span>{daylineDate(d.date)}</span><div><Symbol code={d.icon}/><b>{d.low}–{d.high}°</b><em>{weatherLabel(d.icon)}</em></div></div>)}{!data?.forecast.length?<span className="dl-meta">{busy?"讀緊預報…":"暫未有三日預報"}</span>:null}</div>
      {warnings?.length===0?<span className="dl-quiet"><span className="dl-status-dot"/>無生效警告</span>:null}
    </div>
    {warnings?.length?<div className="dl-weather-warning" role="status"><Flag aria-hidden="true"/><span>生效警告：{warnings.join("、")}</span></div>:null}
    {(error||partial)?<div className="dl-weather-note">{warnings==null?"天氣警告暫未能確認。":"部分天氣資料暫未能更新。"} <button type="button" disabled={busy} onClick={()=>void load()}>再試</button> · <a href="https://www.hko.gov.hk/tc/wxinfo/currwx/current.htm" target="_blank" rel="noreferrer">睇天文台</a></div>:null}
  </section>;
}
