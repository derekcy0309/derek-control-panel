import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { briefWindow, makeCalendarBrief, type BriefDeadline, type BriefEvent, type BriefSource } from "../calendar-brief.ts";
import { decryptCalendarToken } from "../integrations/google-calendar.ts";
import { fetchAppleEvents, type AppleCalendar } from "../integrations/apple-calendar.ts";
import { calendarErrorCode } from "../calendar-errors.ts";

export function calendarService() {
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key)throw new Error("CALENDAR_NOT_CONFIGURED");
 return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
}
export async function appleMetadata(owner:string,service=calendarService()) {
 const result=await service.from("apple_calendar_connections").select("id,account_email,calendars,selected_ids,status,error_code,last_attempt_at").eq("owner_id",owner).maybeSingle();
 if(result.error)throw new Error("CALENDAR_DATABASE");if(!result.data)return null;
 return {...result.data,calendars:(result.data.calendars as AppleCalendar[]).map(c=>({id:c.id,name:c.name}))};
}
export async function refreshApple(owner:string,force=false,service=calendarService(),now=new Date(),dependencies={fetchEvents:fetchAppleEvents,decrypt:decryptCalendarToken}) {
 const connection=await service.from("apple_calendar_connections").select("*").eq("owner_id",owner).maybeSingle();
 if(connection.error)throw new Error("CALENDAR_DATABASE");const c=connection.data;
 if(!c||c.status==="disconnected")return {events:[] as BriefEvent[],source:{label:"Apple Calendar",state:"not_connected",lastSync:null} as BriefSource,truncated:false};
 if(!c.selected_ids.length)return {events:[] as BriefEvent[],source:{label:"Apple Calendar",state:"select_calendars",lastSync:null} as BriefSource,truncated:false};
 const w=briefWindow(now),cached=await service.from("private_calendar_snapshots").select("*").eq("owner_id",owner).eq("source_key",c.id).maybeSingle();
 if(cached.error)throw new Error("CALENDAR_DATABASE");
 const previous=cached.data,valid=previous?.window_start===w.from;
 // Retry throttling is per account in the DB, not ephemeral function memory.
 if(!force && valid && c.status==="connected" && now.getTime()-Date.parse(previous.fetched_at)<300000)return {events:previous.events as BriefEvent[],source:{label:"Apple Calendar",state:"fresh",lastSync:previous.fetched_at} as BriefSource,truncated:previous.truncated};
 if(!force && c.last_attempt_at && now.getTime()-Date.parse(c.last_attempt_at)<60000)return {events:valid?previous.events as BriefEvent[]:[],source:{label:"Apple Calendar",state:"stale",lastSync:previous?.fetched_at??null,errorCode:calendarErrorCode(new Error(c.error_code??"APPLE_REFRESH_FAILED"))} as BriefSource,truncated:previous?.truncated??false};
 const started=now.toISOString();await service.from("apple_calendar_connections").update({last_attempt_at:started}).eq("id",c.id).eq("owner_id",owner);
 try {
  let secret:string;try{secret=dependencies.decrypt(c.secret_ciphertext);}catch{throw new Error("CALENDAR_CREDENTIAL");}
  if(!secret.startsWith("apple-calendar:v1:"))throw new Error("CALENDAR_CREDENTIAL");
  const selected=(c.calendars as AppleCalendar[]).filter(x=>c.selected_ids.includes(x.id));
  if(selected.length!==c.selected_ids.length||selected.length>10)throw new Error("CALENDAR_SELECTION");
  const result=await dependencies.fetchEvents(c.account_email,secret.slice("apple-calendar:v1:".length),selected,now);
  const saved=await service.rpc("save_private_calendar_snapshot",{p_owner:owner,p_source:c.id,p_start:w.from,p_events:result.events,p_fetched:started,p_truncated:result.truncated,p_revision:c.updated_at});
  if(saved.error)throw new Error("CALENDAR_DATABASE");
  await service.from("apple_calendar_connections").update({status:"connected",error_code:null}).eq("id",c.id).eq("owner_id",owner).eq("last_attempt_at",started);
  return {...result,source:{label:"Apple Calendar",state:"fresh",lastSync:started} as BriefSource};
 } catch (error) {
  // Never log provider error objects: they may contain account paths or ICS.
  const latest=await service.from("apple_calendar_connections").select("updated_at,status").eq("id",c.id).eq("owner_id",owner).maybeSingle();
  if(latest.error||latest.data?.updated_at!==c.updated_at||latest.data?.status==="disconnected")return {events:[] as BriefEvent[],source:{label:"Apple Calendar",state:"stale",lastSync:null} as BriefSource,truncated:false};
  const code=calendarErrorCode(error);
  await service.from("apple_calendar_connections").update({status:"attention",error_code:code}).eq("id",c.id).eq("owner_id",owner).eq("last_attempt_at",started);
  return {events:valid?previous.events as BriefEvent[]:[],source:{label:"Apple Calendar",state:"stale",lastSync:previous?.fetched_at??null,errorCode:code} as BriefSource,truncated:previous?.truncated??false};
 }
}
// owner MUST originate from verified auth or agent_brief_owner; never HTTP input.
export async function readCalendarBrief(owner:string,client:SupabaseClient,service=calendarService(),now=new Date()) {
 const w=briefWindow(now);
 const [tasks,panel,apple]=await Promise.all([
  client.from("tasks").select("id,title,due_date,requested_priority,status").eq("owner_id",owner).is("deleted_at",null).is("archived_at",null).not("status","in","(done,cancelled)").gte("due_date",w.from).lt("due_date",w.until).order("due_date").order("requested_priority").limit(201),
  client.from("operating_items").select("id,title,schedule_start_at,schedule_end_at,schedule_status").eq("owner_id",owner).eq("item_type","event").is("archived_at",null).in("schedule_status",["confirmed","tentative"]).lt("schedule_start_at",w.end).gt("schedule_end_at",w.start).order("schedule_start_at").limit(201),
  refreshApple(owner,false,service,now)
 ]);
 if(tasks.error||panel.error)throw new Error("CALENDAR_DATABASE");
 const deadlines:BriefDeadline[]=(tasks.data??[]).slice(0,200).map(t=>({id:t.id,title:t.title,due:t.due_date,priority:t.requested_priority??3,status:t.status}));
 const events:BriefEvent[]=(panel.data??[]).slice(0,200).map(e=>({id:e.id,uid:"panel:"+e.id,title:e.title,start:e.schedule_start_at,end:e.schedule_end_at,allDay:false,source:"Panel",tentative:e.schedule_status==="tentative"}));
 return makeCalendarBrief([...events,...apple.events],deadlines,[{label:"Panel",state:"fresh",lastSync:now.toISOString()},apple.source],now,apple.truncated||(tasks.data?.length??0)>200||(panel.data?.length??0)>200);
}
