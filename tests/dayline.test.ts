import test from "node:test";
import assert from "node:assert/strict";
import { daylineDate,daylineWeek,nextHkMidnight,visibleAgendaDays } from "../lib/dayline.ts";
import { briefDate, type BriefEvent } from "../lib/calendar-brief.ts";
import { hkWeather,weatherLabel } from "../lib/dayline-weather.ts";
const now=new Date("2026-11-21T13:05:00+08:00");
const t=(value:number)=>({value,unit:"C"});
test("weekday and weekly ink rotate on Monday HKT, also over New Year",()=>{
  assert.equal(daylineDate("2026-11-21",true),"2026年11月21日（星期六）");
  assert.equal(daylineWeek("2026-11-16"),"mist");assert.equal(daylineWeek("2026-11-22"),"mist");
  assert.equal(daylineWeek("2026-11-23"),"mint");assert.equal(daylineWeek("2026-12-31"),daylineWeek("2027-01-03"));
  assert.equal(new Set(["09","16","23","30"].map(d=>daylineWeek("2026-11-"+d))).size,4);
  const before=new Date("2026-11-22T15:59:59Z");assert.equal(briefDate(before),"2026-11-22");assert.equal(nextHkMidnight(before),Date.parse("2026-11-22T16:00:00Z"));
});
test("the weather strip uses the HKO station and the next three distinct HK dates only",()=>{
  const d=(date:string)=>({forecastDate:date,forecastMintemp:t(18),forecastMaxtemp:t(25),ForecastIcon:60,forecastWeather:"多雲"});
  const value=hkWeather({temperature:{recordTime:now.toISOString(),data:[{place:"另一區",...t(11)},{place:"香港天文台",...t(22)}]},icon:[50]},
    {weatherForecast:["20261124","20261121","20261122","20261122","20261123","20261126"].map(d)},{},now);
  assert.equal(value.observed?.temperature,22);assert.deepEqual(value.forecast.map(x=>x.date),["2026-11-22","2026-11-23","2026-11-24"]);assert.deepEqual(value.warnings,[]);assert.equal(weatherLabel(50),"天晴");
});
test("partial failure, stale or missing obs and invalid warnings never imply safe weather",()=>{
  const stale=hkWeather({temperature:{recordTime:"2026-11-18T12:00:00+08:00",data:[{place:"香港天文台",...t(25)}]}},null,null,now);
  assert.equal(stale.observed,null);assert.equal(stale.warnings,null);
  assert.equal(hkWeather(null,{},{"error":"bad"},now).warnings,null);
  assert.equal(hkWeather(null,{},{"signal":{name:"警告",actionCode:"UNKNOWN"}},now).warnings,null);
  assert.deepEqual(hkWeather(null,null,{cancel:{name:"舊警告",actionCode:"CANCEL"},fire:{name:"火災危險警告",type:"紅色",actionCode:"ISSUE"},expired:{name:"舊雷暴",actionCode:"EXTEND",expireTime:"2026-11-21T11:00:00+08:00"}},now).warnings,["火災危險警告（紅色）"]);
});
test("one Apple occurrence appears once, distinct appointments survive; deadlines remain on their dates",()=>{
  const e:BriefEvent={id:"one",uid:"a",title:"行程",start:"2026-11-21",end:"2026-11-24",allDay:true,source:"Apple"};
  const other={...e,start:"2026-11-22",end:"2026-11-23"};
  const data=[{date:"2026-11-21",events:[e],deadlines:[]},{date:"2026-11-22",events:[e,other],deadlines:[{id:"d",title:"期限",due:"2026-11-22",priority:3,status:"open"}]}];
  const result=visibleAgendaDays(data);assert.deepEqual(result.map(d=>d.events.length),[1,1]);assert.equal(result[1].events[0].start,other.start);
  assert.equal(result[1].deadlines[0].title,"期限");assert.equal(data[1].events.length,2);
});
