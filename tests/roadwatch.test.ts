import {test} from "node:test";
import assert from "node:assert/strict";
import {journeys,notices,hkMoment,holidayClass,tollRates} from "../lib/server/traffic-data.ts";
import {trafficHighlights,recentReading} from "../lib/roadwatch.ts";
import {usefulLinks} from "../lib/start-links.ts";
const day=(s:string)=>new Date(s+"+08:00");
const jt=(loc:string,dest:string,type:string,num:string,colour:string,at="2026-11-21T18:35:00")=>'<jtis_journey_time><LOCATION_ID>'+loc+'</LOCATION_ID><DESTINATION_ID>'+dest+'</DESTINATION_ID><JOURNEY_TYPE>'+type+'</JOURNEY_TYPE><JOURNEY_DATA>'+num+'</JOURNEY_DATA><COLOUR_ID>'+colour+'</COLOUR_ID><CAPTURE_DATE>'+at+'</CAPTURE_DATE></jtis_journey_time>';
test("direction-specific road time and colours; blank signage and stale data are not free-flow traffic",()=>{
 const rows=journeys('<jtis_journey_list>'+jt("SJ5","TWTM","1","19","2")+jt("H1","CH","2","3","1")+jt("K04","CH","2","4","3")+jt("UNKNOWN","CH","1","1","3")+'</jtis_journey_list>');
 assert.equal(rows.length,3);assert.equal(rows[0].area,"新界");assert.match(rows[0].start,/屯門公路南行/);assert.equal(rows[0].minutes,19);assert.equal(rows[1].status,"closed");assert.equal(rows[1].minutes,null);assert.equal(rows[2].status,"unknown");
 assert.equal(trafficHighlights(rows,day("2026-11-21T18:37:00").getTime())[0].key,"H1:CH");
 assert.deepEqual(trafficHighlights(rows,day("2026-11-21T19:01:00").getTime()),[]);assert.equal(recentReading("broken",Date.now()),false);assert.throws(()=>journeys("<html/>"));
});
test("traffic messages honour latest status; closed incident cannot reappear as a new blockage",()=>{
 const record=(state:string,date:string)=>'<message><INCIDENT_NUMBER>I1</INCIDENT_NUMBER><INCIDENT_STATUS_EN>'+state+'</INCIDENT_STATUS_EN><LOCATION_CN>屯門公路</LOCATION_CN><DIRECTION_CN>九龍</DIRECTION_CN><CONTENT_CN>測試消息</CONTENT_CN><ANNOUNCEMENT_DATE>'+date+'</ANNOUNCEMENT_DATE></message>';
 assert.equal(notices('<list>'+record("NEW","2026-11-21T18:10:00")+'</list>')[0].direction,"九龍");
 assert.deepEqual(notices('<list>'+record("CLOSED","2026-11-21T18:30:00")+record("NEW","2026-11-21T18:10:00")+'</list>'),[]);
});
test("Hong Kong tariff day and holidays: Saturday is not automatically a holiday, missing coverage never guessed",()=>{
 const vevent=Array.from({length:12},(_,i)=>({dtstart:["2026"+String(i+1).padStart(2,"0")+"01",{}]}));
 assert.deepEqual(hkMoment(new Date("2026-11-21T16:01:00Z")),{date:"2026-11-22",time:"00:01:00",sunday:true});
 assert.equal(holidayClass({vcalendar:[{vevent}]},day("2026-11-21T18:00:00")),"weekday");
 assert.equal(holidayClass({vcalendar:[{vevent}]},day("2026-12-01T09:00:00")),"holiday");
 assert.equal(holidayClass(null,day("2026-11-22T10:00:00")),"holiday");assert.equal(holidayClass(null,day("2026-11-21T18:00:00")),"unknown");
});
const header="TUNNEL_BRIDGE_CHINESE_NAME,EFFECTIVE_DATE,DAY_OF_WEEK,START_TIME,END_TIME,GAZETTED_TOLL,VEHICLE_CLASS_DESCRIPTION,LAST_UPDATED_DATE";
const csv=[header,"海底隧道,17/07/2026,A,07:30:00,07:31:59,22,PC,14/07/2026","海底隧道,17/07/2026,A,07:32:00,07:33:59,24,PC,14/07/2026","海底隧道,17/07/2026,B,00:00:00,10:10:59,20,PC,14/07/2026","海底隧道,17/07/2026,A,07:30:00,07:31:59,8.8,MC,14/07/2026","海底隧道,01/01/2028,A,00:00:00,23:59:59,999,PC,14/07/2026","海底隧道 (備用收費點),17/07/2026,A,07:30:00,07:31:59,22,PC,14/07/2026"].join("\n");
test("rates use exact minute, vehicle, effective date; no expired, backup, conflicting or unknown holiday fares",()=>{
 const at=day("2026-11-21T07:31:59"),x=tollRates(csv,true,"PC","weekday",at);
 assert.equal(x.length,1);assert.equal(x[0].fee,22);assert.equal(x[0].until,day("2026-11-21T07:32:00").toISOString());
 assert.equal(tollRates(csv,true,"PC","weekday",day("2026-11-21T07:32:00"))[0].fee,24);assert.equal(tollRates(csv,true,"MC","weekday",at)[0].fee,8.8);assert.equal(tollRates(csv,true,"PC","holiday",at)[0].fee,20);
 assert.deepEqual(tollRates(csv,true,"PC","unknown",at),[]);assert.deepEqual(tollRates(csv+"\n海底隧道,17/07/2026,A,07:30:00,07:31:59,35,PC,14/07/2026",true,"PC","weekday",at),[]);
 const fixed="TUNNEL_BRIDGE_CHINESE_NAME,EFFECTIVE_DATE,GAZETTED_TOLL,CONCESS_TOLL,VEHICLE_CLASS_DESCRIPTION,LAST_UPDATED_DATE\n測試隧道,01/01/2020,20,8,PC,10/10/2026";assert.equal(tollRates(fixed,false,"PC","unknown",at)[0].fee,8);
});
test("useful shortcuts ready without account writes and no government press feed",async()=>{
 assert.equal(usefulLinks.length,5);assert.ok(usefulLinks.every(x=>new URL(x.url).protocol==="https:"));assert.equal(new Set(usefulLinks.map(x=>x.url)).size,5);
 const {feeds}=await import("../lib/server/briefing-feeds.ts");assert.ok(Object.values(feeds).flat().every(x=>!x.rss.includes("info.gov.hk/gia")));
});
