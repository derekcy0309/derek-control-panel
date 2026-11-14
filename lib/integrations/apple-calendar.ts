import { createHash } from "node:crypto";
import { createDAVClient, type DAVCalendar } from "tsdav";
import ICAL from "ical.js";
import { briefWindow, type BriefEvent } from "../calendar-brief.ts";

export type AppleCalendar = { id: string; name: string; url: string };
export function allowedAppleUrl(value: string) {
 const u = new URL(value);
 if (u.protocol!=="https:" || u.username || u.password || u.hash || (u.port && u.port!=="443") || !(u.hostname==="caldav.icloud.com" || /^p\d+-caldav\.icloud\.com$/.test(u.hostname))) throw new Error("APPLE_HOST_REJECTED");
 return u;
}
// Even a compromised provider response cannot turn this transport into a write
// client, arbitrary proxy or credential-forwarding redirect.
export function appleReadTransport(transport: typeof fetch = fetch): typeof fetch {
 let calls=0;
 return async (input, init={}) => {
  if (++calls>40) throw new Error("APPLE_REQUEST_LIMIT");
  const method=(init.method || (input instanceof Request?input.method:"GET")).toUpperCase();
  if (!["GET","OPTIONS","PROPFIND","REPORT"].includes(method)) throw new Error("APPLE_WRITE_FORBIDDEN");
  let u=allowedAppleUrl(String(input instanceof Request?input.url:input));
  for(let hop=0;hop<4;hop++) {
   const response=await transport(u, {...init,method,redirect:"manual",cache:"no-store",signal:AbortSignal.timeout(12000)});
   if ([301,302,307,308].includes(response.status)) { const location=response.headers.get("location");await response.body?.cancel();if(!location)throw new Error("APPLE_REDIRECT");u=allowedAppleUrl(new URL(location,u).href);continue; }
   if(response.status===401||response.status===403){await response.body?.cancel();throw new Error("APPLE_AUTH_REQUIRED");}
   if(response.status>=400){await response.body?.cancel();throw new Error("APPLE_UNAVAILABLE");}
   const chunks:Uint8Array[]=[];let size=0;const reader=response.body?.getReader();
   if(reader)while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>4*1024*1024){await reader.cancel();throw new Error("APPLE_RESPONSE_LIMIT");}chunks.push(part.value);}
   return new Response([204,205,304].includes(response.status)?null:Buffer.concat(chunks),{status:response.status,statusText:response.statusText,headers:response.headers});
  }
  throw new Error("APPLE_REDIRECT_LIMIT");
 };
}
async function client(email: string, password: string) {
 return createDAVClient({serverUrl:"https://caldav.icloud.com",credentials:{username:email,password},authMethod:"Basic",defaultAccountType:"caldav",fetch:appleReadTransport()});
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
 function hydrate(c:InstanceType<typeof ICAL.Component>) {const e=new ICAL.Event(c);for(const [name,time] of [["dtstart",e.startDate],["dtend",e.endDate]] as const){const tzid=c.getFirstProperty(name)?.getParameter("tzid");if(time&&!time.isDate&&tzid&&zones.has(String(tzid)))time.zone=zones.get(String(tzid))!;else if(time&&!time.isDate&&tzid&&time.zone.tzid==="floating"&&tzid!=="Asia/Hong_Kong")throw new Error("APPLE_TIMEZONE_UNSUPPORTED");}return e;}
 function iso(t:InstanceType<typeof ICAL.Time>) {return t.isDate?t.toString().slice(0,10):t.zone.tzid==="floating"?new Date(t.toString()+"+08:00").toISOString():t.toJSDate().toISOString();}
 function add(e:InstanceType<typeof ICAL.Event>,s:InstanceType<typeof ICAL.Time>,f:InstanceType<typeof ICAL.Time>) {
  if(String(e.component.getFirstPropertyValue("status")).toUpperCase()==="CANCELLED")return;
  const a=iso(s),b=iso(f),aTime=Date.parse(a+(s.isDate?"T00:00:00+08:00":"")),bTime=Date.parse(b+(s.isDate?"T00:00:00+08:00":""));
  if(!Number.isFinite(aTime)||!Number.isFinite(bTime)||bTime<=aTime)throw new Error("APPLE_EVENT_INVALID");
  if(aTime<upper&&bTime>lower)result.push({id:createHash("sha256").update(e.uid+":"+a).digest("hex"),uid:e.uid,title:(e.summary||"未命名行程").slice(0,500),start:a,end:b,allDay:s.isDate,source:"Apple",tentative:String(e.component.getFirstPropertyValue("status")).toUpperCase()==="TENTATIVE"});
 }
 for(const c of components){
  if(c.hasProperty("recurrence-id")&&masterIds.has(String(c.getFirstPropertyValue("uid"))))continue;
  const event=hydrate(c);if(!event.startDate)throw new Error("APPLE_EVENT_INVALID");
  if(!event.isRecurring()){add(event,event.startDate,event.endDate);continue;}
  for(const exception of components.filter(x=>x.hasProperty("recurrence-id")&&String(x.getFirstPropertyValue("uid"))===event.uid))event.relateException(hydrate(exception));
  const iter=event.iterator();let exhausted=false;
  for(let n=0;n<10000;n++){const occurrence=iter.next();if(!occurrence){exhausted=true;break;}if(Date.parse(iso(occurrence)+(occurrence.isDate?"T00:00:00+08:00":""))>=upper){exhausted=true;break;}const detail=event.getOccurrenceDetails(occurrence);add(detail.item,detail.startDate,detail.endDate);}
  if(!exhausted)throw new Error("APPLE_RECURRENCE_LIMIT");
 }
 return result;
}
export async function fetchAppleEvents(email:string,password:string,calendars:AppleCalendar[],now=new Date()) {
 const dav=await client(email,password),window=briefWindow(now);let events:BriefEvent[]=[];
 for(const calendar of calendars){
  allowedAppleUrl(calendar.url);
  const objects=await dav.fetchCalendarObjects({calendar:{url:calendar.url} as DAVCalendar,timeRange:{start:new Date(window.start).toISOString(),end:new Date(window.end).toISOString()},expand:true,useMultiGet:false,urlFilter:()=>true});
  if(objects.length>1000)throw new Error("APPLE_RESPONSE_LIMIT");
  for(const object of objects)if(object.data)events.push(...parseAppleEvents(String(object.data),now));
 }
 events=[...new Map(events.map(e=>[e.uid+":"+e.start,e])).values()].sort((a,b)=>a.start.localeCompare(b.start));
 return {events:events.slice(0,200),truncated:events.length>200};
}
