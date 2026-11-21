import type { SupabaseClient } from "@supabase/supabase-js";
import { briefDate, briefWindow, type FamilyDate } from "../calendar-brief.ts";

// Human dashboard only. No service client, calendar writes, agent grants or implicit household access.
export async function readDashboardFamilyDates(client:SupabaseClient, owner:string, now:Date) {
  const w=briefWindow(now);
  const result=await client.from("operating_items").select("id,title,item_type,due_date,schedule_start_at,schedule_status")
    .eq("owner_id",owner).eq("area","family").in("item_type",["school","event","important_date","household","shopping","pet"])
    .is("archived_at",null).not("status","in","(completed,cancelled)").gte("due_date",w.from).lt("due_date",w.until)
    .order("due_date").order("id").limit(201);
  if(result.error)throw new Error("FAMILY_DATES_UNAVAILABLE");
  const rows=result.data??[];
  const dates:FamilyDate[]=rows.slice(0,200).filter(row=>row.schedule_status!=="cancelled"
    && !(row.item_type==="event" && row.schedule_start_at && briefDate(new Date(row.schedule_start_at))===row.due_date))
    .map(row=>({id:row.id,title:row.title,date:row.due_date,kind:row.item_type==="school"?"school":"family"}));
  return {dates,truncated:rows.length>200};
}

// The extra look-ahead belongs to the authenticated human dashboard only.
export async function readNextDashboardSchoolDate(client:SupabaseClient,owner:string,now:Date):Promise<FamilyDate|null>{
  const {until}=briefWindow(now);
  const result=await client.from("operating_items").select("id,title,due_date").eq("owner_id",owner)
    .eq("area","family").eq("item_type","school").is("archived_at",null).not("status","in","(completed,cancelled)")
    .gte("due_date",until).order("due_date").order("id").limit(1);
  if(result.error)throw new Error("SCHOOL_LOOKAHEAD_UNAVAILABLE");
  const item=result.data?.[0];
  return item?{id:item.id,title:item.title,date:item.due_date,kind:"school"}:null;
}
