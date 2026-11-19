import { createHash } from "node:crypto";
import { createDAVClient, type DAVCalendar } from "tsdav";
import ICAL from "ical.js";
import { Temporal } from "@js-temporal/polyfill";
import { briefWindow, type BriefEvent } from "../calendar-brief.ts";
import { calendarErrorCode } from "../calendar-errors.ts";

export type AppleCalendar = { id: string; name: string; url: string };
export function allowedAppleUrl(value: string) {
 const u = new URL(value);
 if (u.protocol!=="https:" || u.username || u.password || u.hash || (u.port && u.port!=="443") || !(u.hostname==="caldav.icloud.com" || /^p\d+-caldav\.icloud\.com$/.test(u.hostname))) throw new Error("APPLE_HOST_REJECTED");
 return u;
}
// Even a compromised provider response cannot turn this transport into a write
// client, arbitrary proxy or credential-forwarding redirect.
export function appleReadTransport(transport: typeof fetch = fetch): typeof fetch {
 let calls=0;const deadline=Date.now()+40000;
 return async (input, init={}) => {
  if (++calls>40) throw new Error("APPLE_REQUEST_LIMIT");
  const method=(init.method || (input instanceof Request?input.method:"GET")).toUpperCase();
  if (!["GET","OPTIONS","PROPFIND","REPORT"].includes(method)) throw new Error("APPLE_WRITE_FORBIDDEN");
  let u=allowedAppleUrl(String(input instanceof Request?input.url:input));
  for(let hop=0;hop<4;hop++) {
   const remaining=deadline-Date.now();if(remaining<=0)throw new Error("APPLE_TIMEOUT");
   const response=await transport(u, {...init,method,redirect:"manual",cache:"no-store",signal:AbortSignal.timeout(Math.min(12000,remaining))});
   if ([301,302,307,308].includes(response.status)) { const location=response.headers.get("location");await response.body?.cancel();if(!location)throw new Error("APPLE_REDIRECT");u=allowedAppleUrl(new URL(location,u).href);continue; }
   if(response.status===401||response.status===403){await response.body?.cancel();throw new Error("APPLE_AUTH_REQUIRED");}
   if(response.status===404||response.status===410){await response.body?.cancel();throw new Error("APPLE_CALENDAR_MISSING");}
   if(response.status>=400){await response.body?.cancel();throw new Error("APPLE_UNAVAILABLE");}
   const chunks:Uint8Array[]=[];let size=0;const reader=response.body?.getReader();
   if(reader)while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>4*1024*1024){await reader.cancel();throw new Error("APPLE_RESPONSE_LIMIT");}chunks.push(part.value);}
   return new Response([204,205,304].includes(response.status)?null:Buffer.concat(chunks),{status:response.status,statusText:response.statusText,headers:response.headers});
  }
  throw new Error("APPLE_REDIRECT_LIMIT");
 };
}
async function client(email: string, password: string) {
 try{return await createDAVClient({serverUrl:"https://caldav.icloud.com",credentials:{username:email,password},authMethod:"Basic",defaultAccountType:"caldav",fetch:appleReadTransport()});}
 catch(error){const code=calendarErrorCode(error);throw new Error(code==="APPLE_REFRESH_FAILED"?"APPLE_DISCOVERY_FAILED":code);}
}
export async function discoverAppleCalendars(email: string,password: string): Promise<AppleCalendar[]> {
 const dav=await client(email,password), calendars=await dav.fetchCalendars();
 if(calendars.length>30)throw new Error("APPLE_CALENDAR_LIMIT");
 return calendars.map(c=>({id:createHash("sha256").update(allowedAppleUrl(c.url).href).digest("hex"),name:typeof c.displayName==="string"?c.displayName.slice(0,100):"Calendar",url:allowedAppleUrl(c.url).href}));
}
export function parseAppleEvents(data: string, now=new Date()): BriefEvent[] {
 const root=new ICAL.Component(ICAL.parse(data)), zones=new Map<string,InstanceType<typeof ICAL.Timezone>>();
 for(const z of root.getAllSubcomponents("vtimezone")){const tz=new ICAL.Timezone(z);zones.set(tz.tzid,tz);}
 const components=root.getAllSubcomponents("vevent"), masterIds=new Set(components.filter(c=>!c.hasProperty("recurrence-id")).map(c=>String(c.getFirstPropertyValue("uid"))));
 const {start,end}=briefWindow(now), lower=Date.parse(start),upper=Date.parse(end);const result:BriefEvent[]=[];
 function zoneId(c:InstanceType<typeof ICAL.Component>,property:string){const value=c.getFirstProperty(property)?.getParameter("tzid");return typeof value==="string"?value:undefined;}
 function hydrate(c:InstanceType<typeof ICAL.Component>) {
  // Relate only this UID's explicitly hydrated exceptions, not every exception
  // in the VCALENDAR (ICAL.Event's default constructor behavior).
  const e=new ICAL.Event(c,{exceptions:[]});
  for(const [name,time] of [["dtstart",e.startDate],["dtend",e.endDate]] as const){
   const tzid=zoneId(c,name);
   if(time&&!time.isDate&&tzid&&zones.has(tzid))time.zone=zones.get(tzid)!;
   else if(time&&!time.isDate&&tzid&&time.zone.tzid==="floating"){
    try{new Intl.DateTimeFormat("en",{timeZone:tzid});}catch{throw new Error("APPLE_TIMEZONE_UNSUPPORTED");}
   }
  }
  return e;
 }
 function iso(t:InstanceType<typeof ICAL.Time>,tzid?:string) {
  if(t.isDate)return t.toString().slice(0,10);
  if(t.zone.tzid!=="floating")return t.toJSDate().toISOString();
  // Apple can return an IANA TZID without embedding VTIMEZONE. Never silently
  // reinterpret it as HK time; use its actual offset and DST disambiguation.
  try{return Temporal.ZonedDateTime.from({timeZone:tzid??"Asia/Hong_Kong",year:t.year,month:t.month,day:t.day,hour:t.hour,minute:t.minute,second:t.second},{disambiguation:"compatible",overflow:"reject"}).toInstant().toString({fractionalSecondDigits:3});}
  catch{throw new Error("APPLE_TIMEZONE_UNSUPPORTED");}
 }
 function add(e:InstanceType<typeof ICAL.Event>,s:InstanceType<typeof ICAL.Time>,f:InstanceType<typeof ICAL.Time>) {
  if(String(e.component.getFirstPropertyValue("status")).toUpperCase()==="CANCELLED")return;
  const a=iso(s,zoneId(e.component,"dtstart")),b=iso(f,zoneId(e.component,e.component.hasProperty("dtend")?"dtend":"dtstart")),aTime=Date.parse(a+(s.isDate?"T00:00:00+08:00":"")),bTime=Date.parse(b+(s.isDate?"T00:00:00+08:00":""));
 if(!Number.isFinite(aTime)||!Number.isFinite(bTime)||bTime<aTime||(s.isDate&&bTime===aTime))throw new Error("APPLE_EVENT_INVALID");
  // RFC 5545: a DATE-TIME VEVENT without DTEND/DURATION is an instant,
  // not malformed calendar data. Include points at HK midnight as well.
  if(aTime<upper&&(bTime===aTime?aTime>=lower:bTime>lower))result.push({id:createHash("sha256").update(e.uid+":"+a).digest("hex"),uid:e.uid,title:(e.summary||"未命名行程").slice(0,500),start:a,end:b,allDay:s.isDate,source:"Apple",tentative:String(e.component.getFirstPropertyValue("status")).toUpperCase()==="TENTATIVE"});
 }
 for(const c of components){
  if(c.hasProperty("recurrence-id")&&masterIds.has(String(c.getFirstPropertyValue("uid"))))continue;
  const event=hydrate(c);if(!event.startDate)throw new Error("APPLE_EVENT_INVALID");
  if(!event.isRecurring()){add(event,event.startDate,event.endDate);continue;}
  for(const exception of components.filter(x=>x.hasProperty("recurrence-id")&&String(x.getFirstPropertyValue("uid"))===event.uid))event.relateException(hydrate(exception));
  const iter=event.iterator();let exhausted=false;
  for(let n=0;n<10000;n++){const occurrence=iter.next();if(!occurrence){exhausted=true;break;}if(Date.parse(iso(occurrence,zoneId(c,"dtstart"))+(occurrence.isDate?"T00:00:00+08:00":""))>=upper){exhausted=true;break;}const detail=event.getOccurrenceDetails(occurrence);add(detail.item,detail.startDate,detail.endDate);}
  if(!exhausted)throw new Error("APPLE_RECURRENCE_LIMIT");
 }
 return result;
}
export async function fetchAppleEvents(email:string,password:string,calendars:AppleCalendar[],now=new Date()) {
 const dav=await client(email,password),window=briefWindow(now);let events:BriefEvent[]=[];
 for(const calendar of calendars){
  allowedAppleUrl(calendar.url);
  const objects=await dav.fetchCalendarObjects({calendar:{url:calendar.url} as DAVCalendar,timeRange:{start:new Date(window.start).toISOString(),end:new Date(window.end).toISOString()},expand:true,useMultiGet:false,urlFilter:()=>true}).catch(error=>{const code=calendarErrorCode(error);throw new Error(code==="APPLE_REFRESH_FAILED"?"APPLE_RESPONSE_INVALID":code);});
  if(objects.length>1000)throw new Error("APPLE_RESPONSE_LIMIT");
  for(const object of objects)if(object.data){try{events.push(...parseAppleEvents(String(object.data),now));}catch(error){const code=calendarErrorCode(error);throw new Error(code==="APPLE_REFRESH_FAILED"||code==="APPLE_NETWORK"?"APPLE_PARSE_FAILED":code);}}
 }
 events=[...new Map(events.map(e=>[e.uid+":"+e.start,e])).values()].sort((a,b)=>a.start.localeCompare(b.start));
 return {events:events.slice(0,200),truncated:events.length>200};
}
