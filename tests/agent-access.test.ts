import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateAgentCreate, validateAgentGrant } from "../lib/agent-access.ts";
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
  assert.ok(validateAgentGrant({...input,days:365}).error);
  assert.ok(validateAgentGrant({...input,fullAccess:true}).error);
});
test("agent routes never use human cookies as credentials and reject destructive methods",async()=>{
  const request=await readFile(new URL("../lib/server/agent-request.ts",import.meta.url),"utf8");
  const route=await readFile(new URL("../app/api/agent/route.ts",import.meta.url),"utf8");
  assert.doesNotMatch(request,/cookies\.get\("dcp_access"\)/);
  assert.match(request,/agent_access_operation/);assert.match(route,/export const DELETE = forbidden/);
  assert.match(route,/export const PATCH = forbidden/);assert.match(route,/validateAgentCreate/);
});
