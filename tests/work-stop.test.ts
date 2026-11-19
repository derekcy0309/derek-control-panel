import test from "node:test";
import assert from "node:assert/strict";
import { makeStopSnapshot, stopSnapshotFromBrief, travelMinutes, workStopAt } from "../lib/work-stop.ts";
import { makeCalendarBrief, type BriefEvent, type BriefSource } from "../lib/calendar-brief.ts";
const iso=(t:string)=>new Date("2026-11-19T"+t+"+08:00").toISOString();
const event=(title:string,start:string,end:string,more:Partial<BriefEvent>={}):BriefEvent=>({id:title,uid:title,title,start:iso(start),end:iso(end),allDay:false,source:"Apple",...more});
const at=(date:string,events:BriefEvent[],margin=20)=>workStopAt(makeStopSnapshot(events,[],false,date),Date.parse(date),margin);
const pickup=event("接放學","15:30:00","16:00:00");

test("15:30 pickup, 20 minutes preparation, 14:52 now → 15:10 wrap and 18 usable minutes",()=>{
 const h=at(iso("14:52:00"),[pickup]);
 assert.ok(h.kind==="countdown");assert.equal(h.stopAt,Date.parse(iso("15:10:00")));assert.equal(h.minutes,18);
 assert.equal(at(iso("15:10:00"),[pickup]).kind,"wrap");assert.equal(at(iso("15:29:55"),[pickup]).kind,"wrap");
 assert.equal(at(iso("15:30:00"),[pickup]).kind,"ongoing");assert.equal(at(iso("16:00:00"),[pickup]).kind,"empty");
 const short=at(iso("15:09:55"),[pickup]);assert.ok(short.kind==="countdown");assert.equal(short.minutes,0);
 const zero=at(iso("15:10:00"),[pickup],0);assert.ok(zero.kind==="countdown");assert.equal(zero.minutes,20);
});
test("only real fixed times count, past/all-day/tentative/invalid entries cannot take over",()=>{
 const list=[event("舊","13:00:00","14:00:00"),event("全日","00:00:00","23:59:59",{allDay:true}),event("未定","15:00:00","15:05:00",{tentative:true}),event("壞資料","16:08:00","16:07:00"),pickup,pickup];
 const snapshot=makeStopSnapshot(list,[],false,iso("14:52:00"));
 assert.deepEqual(snapshot.events.map(e=>e.title),["舊","接放學"]);assert.deepEqual(Object.keys(snapshot.events[1]).sort(),["end","start","title"]);
 const h=at(iso("14:52:00"),list);assert.ok(h.kind==="countdown");assert.equal(h.event.title,"接放學");
 const now=iso("15:30:00"),instant=event("電話","15:30:00","15:30:00");assert.equal(at(now,[instant]).kind,"ongoing");
 assert.equal(at(iso("15:30:01"),[instant]).kind,"empty");
});
test("next-day appointments matter only if their preparation starts before HK midnight",()=>{
 const late=event("深夜","23:00:00","23:20:00",{start:"2026-11-20T00:10:00+08:00",end:"2026-11-20T00:30:00+08:00"});
 const h=at(iso("23:47:00"),[late]);assert.ok(h.kind==="countdown");assert.equal(h.minutes,3);
 assert.equal(at(iso("23:47:00"),[late],5).kind,"empty");
 assert.equal(at(iso("23:58:00"),[late],10).kind,"empty");
});
test("missing, incomplete and old snapshots never promise free time; no deadlines enter the timing view",()=>{
 const now=iso("14:52:00"),apple=(state:BriefSource["state"]):BriefSource=>({label:"Apple Calendar",state,lastSync:null});
 const normal=makeCalendarBrief([pickup],[{id:"d",title:"私人截止",due:"2026-11-19",priority:1,status:"not_started"}],[apple("fresh")],new Date(now));
 const s=stopSnapshotFromBrief(normal);assert.ok(!JSON.stringify(s).includes("私人截止"));
 for(const incomplete of [{...s,incomplete:true},{...s,generatedAt:"bad"},{...s,generatedAt:iso("14:30:00")}])assert.equal(workStopAt(incomplete,Date.parse(now),20).kind,"unknown");
 assert.equal(makeStopSnapshot([pickup],[apple("stale")],false,now).incomplete,true);
 assert.equal(makeStopSnapshot([pickup],[apple("fresh")],true,now).incomplete,true);
 assert.equal(makeStopSnapshot([pickup],[apple("not_connected")],false,now).panelOnly,true);
});
test("travel buffer accepts whole minutes including zero; does not silently clamp invalid values",()=>{
 for(const raw of [null,undefined,"",-1,"1.5","181","2e2",true])assert.equal(travelMinutes(raw),null);
 for(const [raw,n] of [["0",0],[20,20],[" 180 ",180]] as const)assert.equal(travelMinutes(raw),n);
});
