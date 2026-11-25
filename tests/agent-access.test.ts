import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { agentSessionMaxAge, validateAgentArchiveRequest, validateAgentCreate, validateAgentGrant, validateAgentUpdate } from "../lib/agent-access.ts";
import { hashAgentKey, newAgentKey } from "../lib/server/agent-key.ts";
const id="11111111-1111-4111-8111-111111111111";
test("Grok key is high entropy, hashed and distinct from human session credentials",()=>{
  const first=newAgentKey(),second=newAgentKey();assert.notEqual(first.key,second.key);
  assert.equal(first.hash.length,64);assert.equal(hashAgentKey(first.key),first.hash);
  assert.equal(hashAgentKey("human-jwt"),null);assert.equal(first.fingerprint.length,12);
});
test("Grok creation accepts only new tasks/notes and validates dates, tags and fields",()=>{
  const input={kind:"task",requestId:id,title:"工作",description:"內容",tagIds:[id],priority:3,dueDate:"2026-11-14"};
  assert.equal(validateAgentCreate(input).action,"create_task");
  assert.ok(validateAgentCreate({...input,ownerId:id}).error);
  assert.ok(validateAgentCreate({...input,status:"done"}).error);
  assert.ok(validateAgentCreate({...input,dueDate:"2026-02-31"}).error);
  assert.ok(validateAgentCreate({...input,tagIds:[]}).error);
  assert.equal(validateAgentCreate({kind:"note",requestId:id,title:"記事",category:"工作"}).action,"create_note");
});
test("Grok grants require explicit consent and cannot introduce arbitrary scopes",()=>{
  const input={action:"create",label:"Grok Bot",days:30,taskIds:[],noteIds:[],tagIds:[id],acknowledged:true};
  assert.ok(validateAgentGrant(input).data);
  assert.ok(validateAgentGrant({...input,acknowledged:false}).error);
  assert.equal(validateAgentGrant({...input,days:365}).data?.days,365);
  assert.ok(validateAgentGrant({...input,days:366}).error);
  assert.ok(validateAgentGrant({...input,days:"365"}).error);
  assert.ok(validateAgentGrant({...input,fullAccess:true}).error);
});
test("new grants default to owner workspace while selected grants keep their scope",()=>{
  const input={action:"create",label:"私人助理",days:7,acknowledged:true};
  assert.deepEqual(validateAgentGrant(input).data,{scope:"owner_workspace",label:"私人助理",days:7});
  assert.equal(validateAgentGrant({...input,taskIds:[id],noteIds:[],tagIds:[id]}).data?.scope,"selected");
  assert.equal(validateAgentGrant({...input,days:365}).data?.days,365);
  for (const invalid of [
    {...input,acknowledged:false},{...input,scope:"owner_workspace",taskIds:[]},
    {...input,scope:"settings"},{...input,scope:"selected"},{...input,permissions:["read_settings"]},
  ]) assert.ok(validateAgentGrant(invalid).error);
});
test("browser Bot sign-in is capped at 365 days and cannot outlive the approved grant",()=>{
  const now=Date.parse("2026-11-25T08:00:00+08:00"), secondsPerDay=86400;
  const expiry=(days:number)=>new Date(now+days*secondsPerDay*1000).toISOString();
  assert.equal(agentSessionMaxAge(expiry(365),now),365*secondsPerDay);
  assert.equal(agentSessionMaxAge(expiry(366),now),365*secondsPerDay);
  assert.equal(agentSessionMaxAge(expiry(30),now),30*secondsPerDay);
  assert.equal(agentSessionMaxAge(expiry(0),now),null);
  assert.equal(agentSessionMaxAge(undefined,now),null);
  assert.equal(agentSessionMaxAge("invalid",now),null);
});
test("owner workspace may create unlabelled tasks without widening other create fields",()=>{
  const base={kind:"task",requestId:id,title:"不需要 Tag"};
  assert.deepEqual(validateAgentCreate(base,true).payload,{
    request_id:id,title:"不需要 Tag",description:"",due_date:null,priority:3,tag_ids:[],
  });
  assert.ok(validateAgentCreate(base).error);
  assert.ok(validateAgentCreate({...base,tagIds:null},true).error);
  assert.ok(validateAgentCreate({...base,ownerId:id},true).error);
});
test("workspace updates only allow task or note content and deliberate field clearing",()=>{
  const base={kind:"task",id,requestId:id,changes:{dueDate:null,tagIds:[],priority:1,title:" 用戶的任務 ",status:"in_progress"}};
  assert.deepEqual(validateAgentUpdate(base).payload,{
    kind:"task",id,request_id:id,changes:{title:"用戶的任務",due_date:null,priority:1,status:"in_progress",tag_ids:[]},
  });
  for (const changes of [
    {},{dueDate:"2026-02-31"},{dueDate:"0000-01-01"},{priority:"3"},{status:"archived"},{category:"不適用"},
    {ownerId:id},{owner_id:id},{assigneeId:id},{archived_at:"2026-11-25"},{user_settings:{}},{share:true},
  ]) assert.ok(validateAgentUpdate({...base,changes}).error);
  assert.ok(validateAgentUpdate({...base,owner_id:id}).error);
  assert.deepEqual(validateAgentUpdate({...base,kind:"note",changes:{category:" 家庭 ",description:""}}).payload?.changes,
    {category:"家庭",description:""});
  assert.ok(validateAgentUpdate({...base,kind:"note",changes:{status:"done"}}).error);
});
test("archive request is single-record only and cannot claim human confirmation",()=>{
  const base={action:"request_archive",kind:"note",id};
  assert.deepEqual(validateAgentArchiveRequest(base),{action:"request_archive",payload:{kind:"note",id}});
  for (const invalid of [{...base,ownerOrdered:true},{...base,approve:true},{...base,kind:"settings"},
    {...base,id:[id]},{...base,action:"archive"},{...base,resourceId:id}]) assert.ok(validateAgentArchiveRequest(invalid).error);
});
test("agent routes never use human cookies as credentials and reject direct delete or replace",async()=>{
  const request=await readFile(new URL("../lib/server/agent-request.ts",import.meta.url),"utf8");
  const route=await readFile(new URL("../app/api/agent/route.ts",import.meta.url),"utf8");
  assert.doesNotMatch(request,/cookies\.get\("dcp_access"\)/);
  assert.match(request,/agent_access_operation/);assert.match(route,/export const DELETE = forbidden/);
  assert.match(route,/export const PUT = forbidden/);
  assert.match(route,/export async function PATCH/);
  assert.match(route,/validateAgentUpdate/);assert.match(route,/validateAgentCreate/);
});
