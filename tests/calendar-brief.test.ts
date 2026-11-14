import test from "node:test";
import assert from "node:assert/strict";
import { briefWindow, makeCalendarBrief } from "../lib/calendar-brief.ts";
import { allowedAppleUrl, appleReadTransport, parseAppleEvents } from "../lib/integrations/apple-calendar.ts";
const now=new Date("2026-11-30T00:30:00Z");
test("brief uses HK today and exactly three calendar days across month/year boundaries",()=>{
 assert.equal(briefWindow(now).from,"2026-11-30");assert.equal(briefWindow(now).until,"2026-12-03");
 assert.equal(briefWindow(new Date("2026-12-31T17:00:00Z")).from,"2027-01-01");
});
test("brief excludes completed/outside-window tasks, preserves date-only deadline and priority",()=>{
 const result=makeCalendarBrief([], [{id:"a",title:"Low",due:"2026-12-01",priority:5,status:"waiting"},{id:"b",title:"High",due:"2026-12-01",priority:1,status:"not_started"},{id:"c",title:"Done",due:"2026-12-01",priority:1,status:"done"},{id:"d",title:"Past",due:"2026-11-29",priority:1,status:"not_started"}],[],now);
 assert.deepEqual(result.days[1].deadlines.map(x=>x.id),["b","a"]);assert.doesNotMatch(result.text,/Done|Past|23:59/);assert.match(result.text,/等回覆/);
});
test("Apple all-day end is exclusive, multi-day appointments overlap, duplicates are not repeated",()=>{
 const event={id:"a",uid:"uid",title:"Holiday",start:"2026-11-30",end:"2026-12-02",allDay:true,source:"Apple" as const};
 const result=makeCalendarBrief([event,event],[],[],now);assert.equal(result.days[0].events.length,1);assert.equal(result.days[1].events.length,1);assert.equal(result.days[2].events.length,0);
});
test("unavailable sources and truncation never masquerade as a complete fresh report",()=>{
 const result=makeCalendarBrief([],[],[{label:"Apple Calendar",state:"stale",lastSync:"2026-11-29"}],now,true);
 assert.match(result.text,/不是最新/);assert.match(result.text,/不是完整清單/);
});
test("Apple transport blocks all writes, non-Apple hosts and credential-forwarding redirects",async()=>{
 for(const url of ["http://caldav.icloud.com/","https://caldav.icloud.com.attacker.test/","https://127.0.0.1/","https://user:pass@caldav.icloud.com/"])assert.throws(()=>allowedAppleUrl(url));
 assert.equal(allowedAppleUrl("https://p123-caldav.icloud.com/path").hostname,"p123-caldav.icloud.com");
 let calls=0;const transport=appleReadTransport(async()=>{calls++;return new Response("",{status:302,headers:{location:"https://attacker.test/"}});});
 await assert.rejects(transport("https://caldav.icloud.com/",{method:"PUT"}),/WRITE_FORBIDDEN/);assert.equal(calls,0);
 await assert.rejects(transport("https://caldav.icloud.com/",{method:"PROPFIND"}),/HOST_REJECTED/);assert.equal(calls,1);
  const empty=appleReadTransport(async()=>new Response(null,{status:204}));assert.equal((await empty("https://caldav.icloud.com/",{method:"OPTIONS"})).status,204);
});
test("iCalendar expands recurring events, applies cancellation and discards descriptions",()=>{
 const ics=["BEGIN:VCALENDAR","VERSION:2.0","BEGIN:VEVENT","UID:repeat","DTSTART:20261130T020000Z","DTEND:20261130T030000Z","RRULE:FREQ=DAILY;COUNT=3","SUMMARY:Daily","DESCRIPTION:SECRET_NOTES","END:VEVENT","BEGIN:VEVENT","UID:repeat","RECURRENCE-ID:20261201T020000Z","DTSTART:20261201T020000Z","DTEND:20261201T030000Z","STATUS:CANCELLED","SUMMARY:Daily","END:VEVENT","END:VCALENDAR"].join("\r\n");
 const rows=parseAppleEvents(ics,now);assert.equal(rows.length,2);assert.deepEqual(rows.map(x=>x.start.slice(0,10)),["2026-11-30","2026-12-02"]);assert.equal(JSON.stringify(rows).includes("SECRET_NOTES"),false);
});
