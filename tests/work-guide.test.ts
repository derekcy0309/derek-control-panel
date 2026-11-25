import test from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { defaultCaptureTag, guideInstruction, guidePausePosition, pauseForCurrentStep, readGuidePause, guideReview, guideContinue, type GuideDetail } from "../lib/work-guide.ts";
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
 const first=guideInstruction(task,d);assert.equal(first.kind,"starter");assert.match(first.text,/表格/);assert.equal(first.smaller.includes("連結"),true);
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

test("outbound email progresses one confirmed action at a time", () => {
  const task = { title: "SEND EMAIL TO swd - 7 月ccsv attendance", next_action: null };
  const detail: GuideDetail = { steps: [], checkpoint: null, openChildren: false };
  let guide = guideInstruction(task, detail);
  for (const expected of [/電郵/, /Compose/, /主旨/, /內文/, /附件/, /收件人/, /核對/, /傳送/]) {
    assert.match(guide.text, expected);
    assert.ok(guide.smaller);
    detail.checkpoint = { completed_summary: guide.text, current_position: guide.follow ? guideContinue : guideReview, next_minimum_step: guide.follow };
    guide = guideInstruction(task, detail);
  }
  assert.equal(guide.kind, "review");
  detail.checkpoint = { completed_summary: null, current_position: guideContinue, next_minimum_step: "先同同事確認附件" };
  assert.equal(guideInstruction(task, detail).follow, "");
  assert.match(guideInstruction({title:"回覆電郵", next_action:null}, {...detail, checkpoint:null}).text, /對話/);
});

test("pause is not completion: restores position and preparation, never resurrects a completed checklist step",()=>{
 const task={title:"完成文件",next_action:null}, empty:GuideDetail={steps:[],checkpoint:null,openChildren:false};
 const original=guideInstruction(task,empty);
 const cp={current_position:guidePausePosition(null,true,"第 3 頁\n表格底部"),completed_summary:null,next_minimum_step:original.text};
 assert.deepEqual(readGuidePause(cp),{stepNumber:null,preparation:true,location:"第 3 頁\n表格底部",next:original.text});
 const resumed=guideInstruction(task,{...empty,checkpoint:cp});assert.equal(resumed.text,original.text);assert.equal(resumed.follow,original.follow);
 const step={id:"s",title:"覆核金額",sort_order:4,updated_at:"t",status:"todo" as const};
 const real={...cp,current_position:guidePausePosition(step.sort_order,false,"第 4 行"),next_minimum_step:step.title};
 const lookup=(steps:GuideDetail["steps"])=>{const d={...empty,checkpoint:real,steps};return pauseForCurrentStep(d,guideInstruction(task,d))};
 assert.equal(lookup([step])?.location,"第 4 行");
 assert.equal(lookup([{...step,status:"done"},{...step,id:"other",sort_order:7}]),null);
 assert.equal(lookup([{...step,title:"新名稱"}]),null);assert.equal(lookup([{...step,status:"waiting"}]),null);
 assert.equal(guideInstruction(task,{...empty,checkpoint:real,steps:[step]}).text,step.title);
 assert.equal(guideInstruction(task,{...empty,checkpoint:real,steps:[{...step,status:"waiting"}]}).kind,"waiting");
 assert.equal(guideInstruction(task,{...empty,checkpoint:real,steps:[{...step,status:"done"}]}).kind,"review");
 assert.equal(guideInstruction(task,{...empty,checkpoint:real,steps:[]}).kind,"starter");
});
test("legacy generated email checkpoints advance without rewriting a manually entered next step",()=>{
 const task={title:"send email",next_action:null},detail={steps:[],openChildren:false};
 const old={current_position:"開工導航：下次由呢一步接住",completed_summary:"打開你平時用嚟寄信嘅 inbox。",next_minimum_step:"撳「新增郵件 / Compose」，開一封空白草稿。"};
 const resumed=guideInstruction(task,{...detail,checkpoint:old});assert.match(resumed.text,/選擇/);assert.match(resumed.follow,/主旨/);
 assert.equal(guideInstruction(task,{...detail,checkpoint:{...old,completed_summary:null}}).text,old.next_minimum_step);
 assert.equal(guideInstruction(task,{...detail,checkpoint:{...old,current_position:"開工導航：呢一步已做完，等你決定是否結案",next_minimum_step:null}}).kind,"review");
});
