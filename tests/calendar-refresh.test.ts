import test from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BriefEvent } from "../lib/calendar-brief.ts";
import { refreshApple } from "../lib/server/calendar-brief.ts";
const now=new Date("2026-11-19T02:00:00Z"),owner="fixture-owner";
const event:BriefEvent={id:"fixture-event",uid:"fixture-event",title:"Fixture only",start:"2026-11-19T02:00:00Z",end:"2026-11-19T03:00:00Z",allDay:false,source:"Apple"};
function fixture(windowStart="2026-11-19"){
 const connection={id:"fixture-source",owner_id:owner,status:"connected",error_code:null,selected_ids:["fixture-calendar"],calendars:[{id:"fixture-calendar",name:"Fixture",url:"https://caldav.icloud.com/fixture/"}],account_email:"fixture@example.test",secret_ciphertext:"not-real",last_attempt_at:"2026-11-19T01:58:00Z",updated_at:"2026-11-01T00:00:00Z"};
 const previous={window_start:windowStart,fetched_at:"2026-11-19T01:58:00Z",events:[event],truncated:false};
 const writes:Record<string,unknown>[]=[],reads:Array<[string,string,unknown]>=[];let saves=0;
 const service={from(table:string){let values:Record<string,unknown>|undefined;const builder={select(){return builder;},eq(field:string,value:unknown){reads.push([table,field,value]);return builder;},update(value:Record<string,unknown>){values=value;return builder;},async maybeSingle(){return {data:table==="apple_calendar_connections"?connection:previous,error:null};},then(resolve:(value:unknown)=>unknown){if(values)writes.push(values);return Promise.resolve(resolve({error:null}));}};return builder;},async rpc(name:string,payload:Record<string,unknown>){assert.equal(name,"save_private_calendar_snapshot");assert.equal(payload.p_owner,owner);assert.equal(payload.p_revision,connection.updated_at);saves++;return {error:null};}} as unknown as SupabaseClient;
 return {service,writes,reads,get saves(){return saves;}};
}
test("automatic reads use fresh cache but explicit refresh bypasses the five-minute cache",async()=>{
 const f=fixture();let fetches=0;const deps={decrypt:()=>"apple-calendar:v1:fixture",fetchEvents:async()=>{fetches++;return {events:[event],truncated:false};}};
 assert.equal((await refreshApple(owner,false,f.service,now,deps)).source.state,"fresh");assert.equal(fetches,0);
 assert.equal((await refreshApple(owner,true,f.service,now,deps)).source.state,"fresh");assert.equal(fetches,1);assert.equal(f.saves,1);
 assert.ok(f.reads.some(([table,field,value])=>table==="apple_calendar_connections"&&field==="owner_id"&&value===owner));
});
test("refresh errors preserve same-window results with a safe reason, never raw provider text",async()=>{
 for(const [message,code] of [["APPLE_AUTH_REQUIRED","APPLE_AUTH_REQUIRED"],["private title password=SECRET","APPLE_REFRESH_FAILED"]]){
  const f=fixture();const result=await refreshApple(owner,true,f.service,now,{decrypt:()=>"apple-calendar:v1:fixture",fetchEvents:async()=>{throw new Error(message);}});
  assert.equal(result.source.state,"stale");assert.equal(result.source.errorCode,code);assert.deepEqual(result.events,[event]);assert.equal(f.saves,0);
  assert.ok(f.writes.some(value=>value.error_code===code));assert.equal(JSON.stringify(f.writes).includes("SECRET"),false);
 }
});
test("a failed next-day refresh never returns yesterday's snapshot as today's fresh data",async()=>{
 const f=fixture("2026-11-18");const result=await refreshApple(owner,true,f.service,now,{decrypt:()=>"apple-calendar:v1:fixture",fetchEvents:async()=>{throw new Error("APPLE_EVENT_INVALID");}});
 assert.equal(result.source.state,"stale");assert.equal(result.source.errorCode,"APPLE_EVENT_INVALID");assert.deepEqual(result.events,[]);assert.equal(f.saves,0);
});
