import test from "node:test";
import assert from "node:assert/strict";
import { calendarMonday, calendarMonth, makeMonthAgenda, validCalendarDate } from "../lib/dayline-agenda.ts";
import type { DashboardBrief } from "../lib/calendar-brief.ts";

test("calendar date rail follows Hong Kong civil dates and starts on Monday",()=>{
  assert.equal(calendarMonday("2026-11-22"),"2026-11-16");
  assert.equal(calendarMonday("2026-11-23"),"2026-11-23");
  const {month,dates}=calendarMonth("2026-11-23");
  assert.equal(month,"2026-11");
  assert.equal(dates.length,42);
  assert.equal(dates[0],"2026-10-26");
  assert.equal(dates.at(-1),"2026-12-06");
  assert.equal(validCalendarDate("2026-02-30"),null);
  assert.equal(validCalendarDate("2026-11-23"),"2026-11-23");
});

test("agenda keeps shared titles masked, labels school and deadlines and uses Apple read-only",()=>{
  const d="2026-11-23", start=d+"T09:00:00+08:00", end=d+"T10:00:00+08:00";
  const brief:DashboardBrief = { generatedAt:start,from:d,untilExclusive:"2026-11-26",sources:[],truncated:false,text:"",
    familyDates:[{id:"school",title:"回條",kind:"school",date:d}],
    days:[{date:d,deadlines:[],events:[
      {id:"appointment",uid:"Panel",title:"Duplicate Panel data",start,end,allDay:false,source:"Panel"},
      {id:"apple",uid:"apple:1",title:"iPhone 行程",start,end,allDay:false,source:"Apple"},
      {id:"apple",uid:"apple:1",title:"iPhone 行程",start,end,allDay:false,source:"Apple"}
    ]}]
  };
  const schedule = makeMonthAgenda(
    [{id:"task",title:"提交計劃",due_date:d}],
    [{id:"appointment",item_type:"event",area:"family",owner_id:"other",title:"Private title",due_date:d,metadata:{calendarPrivacy:"busy"},schedule_start_at:start,schedule_end_at:end}],
    "viewer",brief
  ).get(d);
  assert.deepEqual(schedule?.map(row=>[row.kind,row.title,Boolean(row.href)]),[
    ["schedule","忙碌",false],["schedule","iPhone 行程",false],["deadline","提交計劃",true],["school","回條",true]
  ]);
  assert.equal(schedule?.[1].detail,"iPhone · 唯讀");
  assert.equal(schedule?.[1].when,"09:00–10:00");
  assert.doesNotMatch(JSON.stringify(schedule),/Private title|Duplicate Panel data/);
});
