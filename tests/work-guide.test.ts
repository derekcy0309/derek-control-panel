import test from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { defaultCaptureTag, guideInstruction, guideReview, guideContinue, type GuideDetail } from "../lib/work-guide.ts";
import { simpleToday } from "../lib/simple-mode.ts";
import type { Task, Assignment, PlanningMetadata } from "../lib/types.ts";
import { readDashboardFamilyDates } from "../lib/server/dashboard-family-dates.ts";
import { dashboardAgendaHighlights } from "../lib/dashboard-agenda.ts";
import { makeCalendarBrief, type BriefEvent } from "../lib/calendar-brief.ts";

test("at-a-glance picks the next timed appointment ahead of an all-day entry, never a past time",()=>{
 const event=(title:string,start:string,end:string,allDay=false):BriefEvent=>({id:title,uid:title,title,start,end,allDay,source:"Apple"});
 const now=new Date("2026-11-19T03:00:00Z"),allDay=event("通告日","2026-11-19","2026-11-20",true),past=event("早上","2026-11-19T00:00:00Z","2026-11-19T01:00:00Z"),next=event("家長日","2026-11-19T05:00:00Z","2026-11-19T06:00:00Z");
 const read=(events:BriefEvent[])=>dashboardAgendaHighlights(makeCalendarBrief(events,[],[],now))?.event.title;
 assert.equal(read([allDay,past,next]),"家長日");assert.equal(read([past,allDay]),"通告日");assert.equal(read([past]),undefined);
 assert.equal(dashboardAgendaHighlights({...makeCalendarBrief([],[],[],now),generatedAt:"invalid"}),null);
});

test("title-only capture uses the viewer's active IDs, even after rename or deletion; never creates a tag",()=>{
 const personal={id:"a",legacy_key:"personal",name:"自己"},work={id:"b",legacy_key:null,name:"工作"};
 assert.equal(defaultCaptureTag([work,personal])?.id,"a");assert.equal(defaultCaptureTag([work,personal],"b")?.id,"b");
 assert.equal(defaultCaptureTag([work],"deleted")?.id,"b");assert.equal(defaultCaptureTag([],"a"),null);
});
test("guide and dashboard share manual order; pending handoffs do not follow an outdated personal plan",()=>{
 const t=(id:string,priority:number,due:string)=>({id,user_id:"me",owner_id:"me",requested_priority:priority,due_date:due,status:"not_started"}) as Task;
 const tasks=[t("a",5,"2026-11-23"),t("b",1,"2026-11-26"),t("c",1,"2026-11-20"),t("d",1,"2026-11-19")];
 const input={tasks,dependencies:[],assignments:[{resource_type:"task",resource_id:"d",assigned_to_id:"other",status:"accepted"}] as Assignment[],userId:"me",today:"2026-11-19"};
 const planning=["d","a","b"].map((id,i)=>({resource_type:"task",resource_id:id,user_id:"me",planned_date:input.today,plan_role:"later",plan_source:"manual",plan_position:i})) as PlanningMetadata[];
 assert.deepEqual(simpleToday({...input,planning}).top.map(x=>x.id),["a","b"]);
 assert.deepEqual(simpleToday({...input,planning:[]}).top.map(x=>x.id),["c","b","a"]);
 assert.deepEqual(simpleToday({...input,planning,tasks:tasks.map(t=>({...t,snoozed_until:t.id==="a"?"2026-11-19T16:00:00Z":"2026-11-18T16:00:00Z"}))}).top.map(x=>x.id),["b"]);
});
test("a title-only task can start, resume its real next step, and gets an explicit closure decision",()=>{
 const task={title:"交學校回條",next_action:null},d:GuideDetail={steps:[],checkpoint:null,openChildren:false};
 const first=guideInstruction(task,d);assert.equal(first.kind,"starter");assert.match(first.text,/份表/);assert.equal(first.smaller.includes("連結"),true);
 const cp={current_position:guideContinue,completed_summary:first.text,next_minimum_step:first.follow};
 assert.equal(guideInstruction(task,{...d,checkpoint:cp}).text,first.follow);
 assert.equal(guideInstruction(task,{...d,checkpoint:{...cp,current_position:guideReview,next_minimum_step:null}}).kind,"review");
 const step={id:"step",title:"先簽名",status:"todo" as const,updated_at:"v1",sort_order:1};
 assert.equal(guideInstruction(task,{...d,steps:[step],checkpoint:cp}).text,"先簽名");
 assert.equal(guideInstruction(task,{...d,steps:[{...step,status:"waiting"}]}).kind,"waiting");
 assert.equal(guideInstruction(task,{...d,steps:[{...step,status:"done"}]}).kind,"review");
});
test("human family lookup is owner-bound, three HK dates, bounded, excludes cancelled and duplicate scheduled events",async()=>{
 const calls:unknown[][]=[];
 const rows=[{id:"s",title:"回條",item_type:"school",due_date:"2026-11-20"},{id:"h",title:"家居維修",item_type:"household",due_date:"2026-11-21"},{id:"e",title:"家長會",item_type:"event",schedule_start_at:"2026-11-19T16:15:00Z",due_date:"2026-11-20"},{id:"e2",title:"另一截止",item_type:"event",schedule_start_at:"2026-11-21T02:00:00Z",due_date:"2026-11-20"},{id:"x",schedule_status:"cancelled"}];
 const builder=new Proxy({}, {get:(_,key)=>key==="then"?undefined:(...args:unknown[])=>{calls.push([key,...args]);return key==="limit"?Promise.resolve({data:rows,error:null}):builder;}});
 const client={from:(t:string)=>{assert.equal(t,"operating_items");return builder;}} as unknown as SupabaseClient;
 const result=await readDashboardFamilyDates(client,"owner",new Date("2026-11-19T16:00:00Z"));
 assert.deepEqual(result.dates.map(i=>i.id),["s","h","e2"]);
 for(const call of [["eq","owner_id","owner"],["eq","area","family"],["gte","due_date","2026-11-20"],["lt","due_date","2026-11-23"],["is","archived_at",null],["not","status","in","(completed,cancelled)"],["limit",201]])assert.ok(calls.some(c=>JSON.stringify(c)===JSON.stringify(call)));
 assert.doesNotMatch(String(calls[0][1]),/metadata|description|notes/);
});
