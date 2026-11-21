import {detectorSpots,holidayClass,journeys,notices,tollRates} from "./traffic-data.ts";
import type {RoadReport} from "../roadwatch.ts";
const sources={roads:"https://resource.data.one.gov.hk/td/jss/Journeytimev2.xml",alerts:"https://www.td.gov.hk/tc/special_news/trafficnews.xml",variable:"https://static.data.gov.hk/td/road-network-v2/TUN_BRIDGE_TV_TOLL.csv",fixed:"https://static.data.gov.hk/td/road-network-v2/TUN_BRIDGE_TOLL.csv",holiday:"https://www.1823.gov.hk/common/ical/tc.json"};
async function publicText(url:string,ttl:number,max=600000){
 const response=await fetch(url,{redirect:"error",credentials:"omit",signal:AbortSignal.timeout(6500),...(ttl?{next:{revalidate:ttl}}:{cache:"no-store" as const})});
 if(!response.ok||!response.body||Number(response.headers.get("content-length"))>max){await response.body?.cancel();throw Error("unavailable");}
 const reader=response.body.getReader(),dec=new TextDecoder();let size=0,text="";
 try{while(true){const r=await reader.read();if(r.done)break;size+=r.value.byteLength;if(size>max){await reader.cancel();throw Error("too big");}text+=dec.decode(r.value,{stream:true});}}finally{reader.releaseLock();}
 return text+dec.decode();
}
export async function roadReport(vehicle:"PC"|"MC",now?:Date):Promise<RoadReport>{
 const [roads,alerts,variable,fixed,holiday,spots]=await Promise.all([publicText(sources.roads,0).then(journeys).catch(()=>null),publicText(sources.alerts,0).then(notices).catch(()=>null),publicText(sources.variable,3600).catch(()=>null),publicText(sources.fixed,3600).catch(()=>null),publicText(sources.holiday,21600).then(t=>JSON.parse(t)).catch(()=>null),publicText("https://resource.data.one.gov.hk/td/traffic-detectors/rawSpeedVol-all.xml",30,2200000).then(detectorSpots).catch(()=>null)]);
 const check=now??new Date(),period=holidayClass(holiday,check);
 const fares=(s:string|null,v:boolean)=>{try{return s?tollRates(s,v,vehicle,period,check):null;}catch{return null;}};
 const v=fares(variable,true),f=fares(fixed,false);
 return {at:check.toISOString(),roads,spots,notices:alerts,tolls:[...(v??[]),...(f??[])],period,variableOK:period!=="unknown"&&!!v?.length,fixedOK:!!f?.length,vehicle};
}
