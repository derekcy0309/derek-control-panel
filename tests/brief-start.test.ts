import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { briefStartFooter, briefStartUrl } from "../lib/brief-start.ts";
import { readBriefStartTitle } from "../lib/server/brief-start.ts";

const owner="11111111-1111-4111-8111-111111111111",day="2026-11-25";
const ids=["11111111-2222-4111-8111-111111111111","22222222-2222-4222-8222-222222222222"];
const plans=ids.map((id,i)=>({resource_id:id,plan_position:i+1,plan_source:"manual",plan_role:"later",snoozed_until:null})).reverse();
const own=ids.map(id=>({id,owner_id:owner,status:"not_started",blocked_reason:null,snoozed_until:null,deleted_at:null,archived_at:null}));
type Row=Record<string,unknown>;
function fixture(overrides:{plan?:Row[];tasks?:Row[];steps?:Row[];edges?:Row[];assignments?:Row[];before?:Row[];throws?:boolean}={}) {
 const titles:string[]=[];
 const client=createClient("http://127.0.0.1:1","fixture",{auth:{persistSession:false},global:{fetch:async (input,init)=>{
   const url=new URL(String(input)),table=url.pathname.split("/").at(-1),filter=url.searchParams;
   assert.equal(init?.method,"GET");
   let rows:Row[]=[];
   if(table==="user_planning_metadata"){
     assert.equal(filter.get("user_id"),"eq."+owner);assert.equal(filter.get("planned_date"),"eq."+day);assert.equal(filter.get("hidden_from_today"),"eq.false");
     if(overrides.throws)return new Response("fixture unavailable",{status:503});
     rows=overrides.plan??plans;
   }else if(table==="tasks"){
     assert.equal(filter.get("owner_id"),"eq."+owner);
     if(filter.get("select")==="title"){
       const id=filter.get("id")?.slice(3)??"";titles.push(id);
       assert.ok(ids.includes(id));assert.equal(filter.get("archived_at"),"is.null");assert.equal(filter.get("deleted_at"),"is.null");
       rows=[{title:id===ids[0]?"主動安排嘅第一件":"第二件"}];
     }else if(filter.get("select")==="id,status")rows=overrides.before??[];
     else {assert.doesNotMatch(filter.get("select")??"",/title|notes/i);rows=overrides.tasks??own;}
   }else if(table==="task_current_steps"||table==="task_dependencies"||table==="assignments"){
     const allowed=new Set((overrides.tasks??own).filter(r=>r.owner_id===owner).map(r=>r.id));
     const scope=(filter.get(table==="assignments"?"resource_id":"task_id")??"").slice(4,-1).split(",");
     assert.ok(scope.length&&scope.every(id=>allowed.has(id)));
     rows=(table==="task_current_steps"?overrides.steps:table==="task_dependencies"?overrides.edges:overrides.assignments)??[];
   }else throw Error("Unexpected endpoint "+table);
   return Response.json(rows);
 }}});
 return {client,titles};
}
test("Grok's start footer contains one stable human-login link and no credentials/task IDs",()=>{
 assert.equal(briefStartUrl,"https://derek-control-panel.vercel.app/#dayline-start");
 for(const title of [null,"https://private.example/doc","other@example.hk","[open](x)","first\nsecond","x".repeat(161),"\u202eabc"]) {
   assert.equal(briefStartFooter(title),"登入日序開工："+briefStartUrl);
 }
 assert.equal(briefStartFooter(" 改標題 "),"今日手排第一件可做：改標題｜登入日序開工："+briefStartUrl);
});
test("same owner's actual manual order wins over DB return order; read only winner title",async()=>{
 const f=fixture();assert.equal(await readBriefStartTitle(f.client,owner,day),"主動安排嘅第一件");assert.deepEqual(f.titles,[ids[0]]);
});
test("completed, snoozed, waiting step, incomplete dependency and delegated work are not runnable",async()=>{
 const p={id:"33333333-3333-4333-8333-333333333333",status:"not_started"};
 for(const state of [
   {tasks:[{...own[0],status:"done"},own[1]]}, {tasks:[{...own[0],snoozed_until:"2026-11-25T16:00:00Z"},own[1]]},
   {steps:[{task_id:ids[0],status:"waiting"}]}, {edges:[{task_id:ids[0],depends_on_task_id:p.id}],before:[p]},
   {assignments:[{resource_id:ids[0],resource_type:"task",assigned_to_id:"other",status:"accepted"}]}
 ]){const f=fixture(state);assert.equal(await readBriefStartTitle(f.client,owner,day),"第二件");assert.deepEqual(f.titles,[ids[1]]);}
});
test("ambiguous, shared, auto, failed or truncated data yields only generic CTA, no title fetch",async()=>{
 for(const state of [
   {plan:[]},{plan:plans.map(p=>({...p,plan_source:"auto_plan"}))},{tasks:[own[1]]},
   {edges:[{task_id:ids[0],depends_on_task_id:"outside-owner-scope"}]},
   {tasks:[{...own[0],owner_id:"other"},own[1]]},{throws:true},{plan:Array(101).fill(plans[0])}
 ]){const f=fixture(state);assert.equal(await readBriefStartTitle(f.client,owner,day),null);assert.deepEqual(f.titles,[]);}
});
