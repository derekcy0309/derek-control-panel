import { briefDate, type BriefEvent, type BriefSource, type CalendarBrief } from "./calendar-brief.ts";

export const DEFAULT_TRAVEL_MINUTES=20;
export const MAX_TRAVEL_MINUTES=180;
export const CALENDAR_REFRESH_MS=5*60_000;
const MAX_SNAPSHOT_AGE=15*60_000;
export type StopEvent=Pick<BriefEvent,"title"|"start"|"end">;
export type StopSnapshot={generatedAt:string;events:StopEvent[];incomplete:boolean;panelOnly:boolean};
export function travelMinutes(value:unknown):number|null {
  if(typeof value!=="string" && typeof value!=="number")return null;
  const raw=String(value).trim();
  if(!/^\d{1,3}$/.test(raw))return null;
  const n=Number(raw);return n<=MAX_TRAVEL_MINUTES?n:null;
}
export function makeStopSnapshot(events:BriefEvent[],sources:BriefSource[],truncated:boolean,generatedAt:string):StopSnapshot {
  const seen=new Set<string>(),fixed:StopEvent[]=[];
  for(const e of events){
    if(e.allDay || e.tentative)continue;
    const start=Date.parse(e.start),end=Date.parse(e.end),key=e.uid+":"+e.start;
    if(!Number.isFinite(start)||!Number.isFinite(end)||end<start||seen.has(key))continue;
    seen.add(key);fixed.push({title:e.title,start:e.start,end:e.end});
  }
  return {generatedAt,events:fixed,incomplete:truncated || sources.some(s=>s.state==="stale"),
    panelOnly:sources.some(s=>s.label==="Apple Calendar" && (s.state==="not_connected" || s.state==="select_calendars"))};
}
export function stopSnapshotFromBrief(brief:CalendarBrief){
  return makeStopSnapshot(brief.days.flatMap(d=>d.events),brief.sources,brief.truncated,brief.generatedAt);
}
type StopHint={kind:"unknown"|"empty"}|{kind:"ongoing";event:StopEvent}|{kind:"countdown"|"wrap";event:StopEvent;stopAt:number;minutes:number};
export function workStopAt(snapshot:StopSnapshot,now:number,travel:number):StopHint{
  const generated=Date.parse(snapshot.generatedAt);
  if(!Number.isFinite(now)||!Number.isFinite(generated)||snapshot.incomplete||now-generated>MAX_SNAPSHOT_AGE||generated-now>120_000)return {kind:"unknown"};
  const margin=(travelMinutes(travel)??DEFAULT_TRAVEL_MINUTES)*60_000;
  const tomorrow=Date.parse(briefDate(new Date(now))+"T00:00:00+08:00")+86_400_000;
  let active:StopEvent|undefined,next:StopEvent|undefined,soonest=Infinity;
  for(const e of snapshot.events){
    const s=Date.parse(e.start),f=Date.parse(e.end);
    if(!Number.isFinite(s)||!Number.isFinite(f)||f<s)continue;
    if(s<=now && (now<f || (s===f && s===now))){
      if(!active || f<Date.parse(active.end))active=e;
    }else if(s>now && s<soonest && s-margin<tomorrow){
      next=e;soonest=s;
    }
  }
  if(active)return {kind:"ongoing",event:active};
  if(!next)return {kind:"empty"};
  const stopAt=soonest-margin;
  return {kind:stopAt<=now?"wrap":"countdown",event:next,stopAt,minutes:Math.max(0,Math.floor((stopAt-now)/60_000))};
}
