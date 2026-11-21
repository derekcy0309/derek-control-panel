import { addBriefDays, briefDate } from "./calendar-brief.ts";

type ObjectValue = Record<string,unknown>;
const obj = (v:unknown):ObjectValue|null => v !== null && typeof v==="object" && !Array.isArray(v) ? v as ObjectValue : null;
const str = (v:unknown) => typeof v === "string" ? v.trim() : "";
const temp = (v:unknown) => { const x=obj(v); return x?.unit==="C" && typeof x.value==="number" && Number.isFinite(x.value) && x.value>=-30 && x.value<=60 ? x.value : null; };
export type WeatherDay = {date:string; low:number; high:number; description:string; icon:number|null};
export type HkWeather = { observed:{temperature:number; at:string; icon:number|null}|null; forecast:WeatherDay[]; warnings:string[]|null; checkedAt:string };
export function hkWeather(current:unknown, forecast:unknown, warning:unknown, now=new Date()): HkWeather {
  const c=obj(current), temps=obj(c?.temperature), list=temps?.data;
  const station=Array.isArray(list)?list.find(p=>obj(p)?.place==="香港天文台"):null;
  const at=str(temps?.recordTime), observation=temp(station), age=now.getTime()-Date.parse(at);
  const code=(v:unknown):number|null=>typeof v==="number"&&Number.isInteger(v)&&v>=50&&v<=99?v:null;
  const observed=observation!==null && age>=-5*60000 && age<=2*3600000?{temperature:observation,at,icon:code(Array.isArray(c?.icon)?c.icon[0]:null)}:null;
  const today=briefDate(now), wanted=[1,2,3].map(n=>addBriefDays(today,n));
  const rawDays=obj(forecast)?.weatherForecast;
  const days:WeatherDay[]=[];
  if(Array.isArray(rawDays))for(const date of wanted){
    const d=obj(rawDays.find(v=>obj(v)?.forecastDate===date.replaceAll("-","")));
    const low=temp(d?.forecastMintemp),high=temp(d?.forecastMaxtemp);
    if(low!==null&&high!==null&&low<=high)days.push({date,low,high,description:str(d?.forecastWeather).slice(0,260),icon:code(d?.ForecastIcon)});
  }
  const raw=obj(warning); let warnings:string[]|null=null;
  if(raw){
    const names=new Set<string>(); let valid=true;
    for(const item of Object.values(raw)){
      const row=obj(item), action=str(row?.actionCode).toUpperCase(),name=str(row?.name);
      if (action==="CANCEL" || action==="CANCELLED") continue;
      if(!name || !["ISSUE","REISSUE","EXTEND","UPDATE"].includes(action)){valid=false;break;}
      if(row?.expireTime && !Number.isFinite(Date.parse(str(row.expireTime)))){valid=false;break;}
      if(row?.expireTime && Date.parse(str(row.expireTime))<=now.getTime())continue;
      const level=str(row?.type).slice(0,60);
      names.add((level&&!name.includes(level)?name+"（"+level+"）":name).slice(0,150));
    }
    if(valid) warnings=[...names];
  }
  return {observed,forecast:days,warnings,checkedAt:now.toISOString()};
}
export function weatherLabel(icon:number|null){
  if(icon===50)return "天晴";
  if(icon===51)return "間有陽光"; if(icon===52)return "短暫陽光";
  if(icon!==null && icon>=53&&icon<=54)return "間中有驟雨";
  if(icon===60)return "多雲"; if(icon===61)return "密雲";
  if(icon===62)return "微雨"; if(icon===63)return "有雨"; if(icon===64)return "大雨"; if(icon===65)return "雷暴";
  if(icon!==null&&icon>=70&&icon<=75)return "天晴"; if(icon===76)return "大致多雲"; if(icon===77)return "大致天晴";
  if(icon===80)return "大風"; if(icon===81)return "乾燥"; if(icon===82)return "潮濕"; if(icon===83)return "有霧"; if(icon===84)return "薄霧"; if(icon===85)return "煙霞";
  if(icon===90)return "炎熱"; if(icon===91)return "暖"; if(icon===92)return "清涼"; if(icon===93)return "寒冷";
  return "";
}
