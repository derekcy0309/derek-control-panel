import test from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { appleCalendarMonthWindow, requestedAppleCalendarMonth, type AppleCalendarMonth } from "../lib/apple-calendar-month.ts";
import { parseAppleEvents, parseAppleEventsForWindow } from "../lib/integrations/apple-calendar.ts";
import { makeMonthAgenda } from "../lib/dayline-agenda.ts";
import { readAppleCalendarMonth } from "../lib/server/apple-calendar-month.ts";

const month=appleCalendarMonthWindow("2026-12")!;
const stamp="2026-11-22T08:00:00.000Z";
const owner="11111111-1111-4111-8111-111111111111", other="22222222-2222-4222-8222-222222222222";
const calendar=(id:string)=>({id,name:id,url:"https://p1-caldav.icloud.com/calendars/"+id});
const connection={
  id:"calendar-connection",account_email:"owner@example.invalid",secret_ciphertext:"encrypted-fixture",
  calendars:[calendar("private"),calendar("not-selected")],selected_ids:["private"],status:"connected",updated_at:stamp
};
const appointment={id:"test-event",uid:"test-uid",title:"下月 iPhone 行程",start:"2026-12-18T15:45:00Z",end:"2026-12-18T17:15:00Z",allDay:false,source:"Apple" as const};
type FixtureRow=Record<string,unknown>;

function fixture(rows:Map<string,FixtureRow>, afterRead?:(row:FixtureRow)=>FixtureRow|null){
  const queries:URL[]=[];
  const service=createClient("https://calendar-fixture.supabase.co","fake-key",{
    auth:{autoRefreshToken:false,persistSession:false,detectSessionInUrl:false},
    global:{fetch:async(input,init)=>{
      const request=new Request(input,init),url=new URL(request.url);
      queries.push(url);
      assert.equal(request.method,"GET","month read must not write to the snapshot or connection");
      assert.equal(url.origin,"https://calendar-fixture.supabase.co");
      assert.equal(url.pathname,"/rest/v1/apple_calendar_connections");
      const wanted=url.searchParams.get("owner_id");
      assert.ok(typeof wanted==="string" && wanted.startsWith("eq."));
      let row=rows.get(wanted.slice(3));
      if(row && afterRead && url.searchParams.has("id"))row=afterRead(row)??undefined;
      return new Response(JSON.stringify(row?[row]:[]),{headers:{"Content-Type":"application/json"}});
    }}
  });
  return {service,queries};
}

test("month URL accepts exactly one month, uses one HK grid, and rejects alternate owners or spans",()=>{
  assert.equal(month.from,"2026-11-30");
  assert.equal(month.until,"2027-01-04");
  assert.equal(month.start,"2026-11-30T00:00:00+08:00");
  assert.equal(month.end,"2027-01-04T00:00:00+08:00");
  const sixWeeks=appleCalendarMonthWindow("2026-11")!;
  assert.equal(Date.parse(sixWeeks.end)-Date.parse(sixWeeks.start),42*86400000);
  for(const q of ["","month=2026-02-01","month=2026-00","month=2026-13","month=2026-12&month=2026-11","month=2026-12&owner_id=victim","month=2026-12&user=x","month=2026-12&until=2300-01-01","month=0000-01"])
    assert.equal(requestedAppleCalendarMonth(new URLSearchParams(q)),null,q);
  assert.deepEqual(requestedAppleCalendarMonth(new URLSearchParams("month=2026-12")),month);
});

test("Apple calendar parser expands the viewed month beyond the old three-day limit",()=>{
  const ics=["BEGIN:VCALENDAR","VERSION:2.0","BEGIN:VEVENT","UID:planned","DTSTART:20261218T154500Z","DTEND:20261218T171500Z","SUMMARY:下月行程","DESCRIPTION:DO_NOT_COPY","END:VEVENT","BEGIN:VEVENT","UID:outside","DTSTART:20270104T000000Z","DTEND:20270104T010000Z","SUMMARY:Outside the grid","END:VEVENT","END:VCALENDAR"].join("\r\n");
  const rows=parseAppleEventsForWindow(ics,month);
  assert.deepEqual(rows.map(r=>r.uid),["planned"]);
  assert.equal(rows[0].title,"下月行程");
  assert.equal(JSON.stringify(rows).includes("DO_NOT_COPY"),false);
  assert.deepEqual(parseAppleEvents(ics,new Date(stamp)),[],"legacy home and Grok still read only the next three days");
});

test("month agenda includes both HK dates for overnight and stops at the exclusive all-day end",()=>{
  const wholeDay={...appointment,id:"allday",uid:"allday",start:"2026-12-19",end:"2026-12-21",allDay:true};
  const payload:AppleCalendarMonth={month:month.month,from:month.from,until:month.until,events:[appointment,appointment,wholeDay],source:{label:"Apple Calendar",state:"fresh",lastSync:stamp},truncated:false};
  const agenda=makeMonthAgenda([{id:"task",title:"日序 Task",due_date:"2026-12-24"}],[],owner,null,payload);
  assert.equal(agenda.get("2026-12-18")?.length,1);
  assert.equal(agenda.get("2026-12-19")?.length,2);
  assert.equal(agenda.get("2026-12-20")?.length,1);
  assert.equal(agenda.get("2026-12-21"),undefined);
  assert.equal(agenda.get("2026-12-24")?.[0].title,"日序 Task");
  assert.equal(agenda.get("2026-12-18")?.[0].detail,"iPhone · 唯讀");
  assert.equal(agenda.get("2026-12-18")?.[0].href,undefined);
});

test("month service filters both queries by verified owner and reads only their selected Calendars",async()=>{
  const {service,queries}=fixture(new Map([[owner,connection],[other,{...connection,account_email:"other@example.invalid"}]]));
  let requests=0;
  const result=await readAppleCalendarMonth(owner,month,service,{
    decrypt(sealed){assert.equal(sealed,"encrypted-fixture");return "apple-calendar:v1:FAKE_PASSWORD";},
    async fetchEvents(email,password,calendars,window,limit){
      requests++;assert.equal(email,connection.account_email);assert.equal(password,"FAKE_PASSWORD");
      assert.deepEqual(calendars,[calendar("private")]);assert.deepEqual(window,month);assert.equal(limit,500);
      return {events:[appointment],truncated:false};
    }
  },new Date(stamp));
  assert.equal(requests,1);
  assert.deepEqual(queries.map(url=>url.searchParams.get("owner_id")),["eq."+owner,"eq."+owner]);
  assert.equal(queries[1].searchParams.get("id"),"eq."+connection.id);
  assert.equal(result.source.state,"fresh");
  assert.equal(result.events[0].title,"下月 iPhone 行程");
  assert.doesNotMatch(JSON.stringify(result),/FAKE_PASSWORD|encrypted-fixture|example.invalid|not-selected/);
});

test("unconnected and unselected accounts do not decrypt or call Apple",async()=>{
  const {service}=fixture(new Map([[owner,{...connection,selected_ids:[]}]]));
  const skip={decrypt(){throw new Error("do not decrypt");},async fetchEvents(){throw new Error("do not call Apple");}};
  assert.equal((await readAppleCalendarMonth(other,month,service,skip)).source.state,"not_connected");
  assert.equal((await readAppleCalendarMonth(owner,month,service,skip)).source.state,"select_calendars");
});

test("disconnect/reselection suppress an in-flight result; failures expose fixed safe text only",async()=>{
  const onlyOwner=new Map([[owner,connection]]);
  const provider={
    decrypt(){return "apple-calendar:v1:FAKE_PASSWORD";},
    async fetchEvents(){return {events:[appointment],truncated:false};}
  };
  for(const updated of [null,{...connection,status:"disconnected"},{...connection,updated_at:"2026-11-22T09:00:00Z"}]){
    const result=await readAppleCalendarMonth(owner,month,fixture(onlyOwner,()=>updated).service,provider);
    assert.deepEqual(result.events,[]);
    assert.equal(result.source.state,updated?.status==="connected"?"stale":"not_connected");
  }
  const failure=await readAppleCalendarMonth(owner,month,fixture(onlyOwner).service,{
    ...provider,async fetchEvents(){throw new Error("provider response emitted password=FAKE_PASSWORD and private body");}
  });
  assert.equal(failure.source.errorCode,"APPLE_REFRESH_FAILED");
  assert.doesNotMatch(JSON.stringify(failure),/FAKE_PASSWORD|private body/);
});
