import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppleCalendarMonth, AppleCalendarMonthWindow } from "../apple-calendar-month.ts";
import type { BriefSource } from "../calendar-brief.ts";
import { calendarErrorCode } from "../calendar-errors.ts";
import { fetchAppleWindowEvents, type AppleCalendar } from "../integrations/apple-calendar.ts";
import { decryptCalendarToken } from "../integrations/google-calendar.ts";
import { calendarService } from "./calendar-brief.ts";

const appleTag="apple-calendar:v1:";
const MAX_MONTH_EVENTS=500;
const provider={fetchEvents:fetchAppleWindowEvents,decrypt:decryptCalendarToken};

// Never accept an owner from HTTP. Only the authenticated user's saved
// selection is used; monthly reads do not replace the three-day snapshot or
// write monthly appointment data to the database.
export async function readAppleCalendarMonth(
  owner:string, window:AppleCalendarMonthWindow, service:SupabaseClient=calendarService(),
  dependencies=provider, now=new Date()
):Promise<AppleCalendarMonth> {
  const {month,from,until}=window;
  const empty=(state:BriefSource["state"],errorCode?:BriefSource["errorCode"]):AppleCalendarMonth=>({
    month,from,until,events:[],truncated:false,source:{label:"Apple Calendar",state,lastSync:null,...(errorCode?{errorCode}:{})}
  });
  const found=await service.from("apple_calendar_connections")
    .select("id,account_email,secret_ciphertext,calendars,selected_ids,status,updated_at")
    .eq("owner_id",owner).maybeSingle();
  if(found.error)throw new Error("CALENDAR_DATABASE");
  const connection=found.data;
  if(!connection || connection.status==="disconnected")return empty("not_connected");
  if(!Array.isArray(connection.selected_ids) || !connection.selected_ids.length)return empty("select_calendars");
  try {
    const calendars=(connection.calendars as AppleCalendar[]).filter(c=>connection.selected_ids.includes(c.id));
    if(calendars.length!==connection.selected_ids.length || calendars.length>10)throw new Error("CALENDAR_SELECTION");
    let decrypted:string;
    try{decrypted=dependencies.decrypt(connection.secret_ciphertext);}catch{throw new Error("CALENDAR_CREDENTIAL");}
    if(!decrypted.startsWith(appleTag) || !decrypted.slice(appleTag.length))throw new Error("CALENDAR_CREDENTIAL");
    const result=await dependencies.fetchEvents(connection.account_email,decrypted.slice(appleTag.length),calendars,window,MAX_MONTH_EVENTS);
    // An explicit disconnect/changed selection must not be defeated by a
    // slower in-flight response from the old selection.
    const checked=await service.from("apple_calendar_connections")
      .select("updated_at,status").eq("owner_id",owner).eq("id",connection.id).maybeSingle();
    if(checked.error)throw new Error("CALENDAR_DATABASE");
    if(!checked.data || checked.data.status==="disconnected")return empty("not_connected");
    if(checked.data.status==="select_calendars")return empty("select_calendars");
    if(checked.data.updated_at!==connection.updated_at)return empty("stale","CALENDAR_SELECTION");
    return {month,from,until,...result,source:{label:"Apple Calendar",state:"fresh",lastSync:now.toISOString()}};
  }catch(error){
    // Never expose the provider error object, account URL, or decrypted secret.
    return empty("stale",calendarErrorCode(error));
  }
}
