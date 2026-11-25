import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';

// Runs inside grok-agent-access.mjs's isolated PostgreSQL, after the original
// school and standard Agent migrations. The real functions and RLS run here.
export async function testStandardAgentCodeLifetime({db,asRole,owner,other,task,hidden,foreign,tag,directory}) {
  const value=async(sql,params=[])=>(await db.query(sql,params)).rows[0]?.v;
  const root=()=>db.exec('reset role');
  const selected=(hash,days,ids=[task])=>value("select public.create_my_agent_access($1,'Selected test bot',$2,$3::uuid[],'{}',$4::uuid[]) v",[hash,days,ids,[tag]]);
  const workspace=(hash,days)=>value("select public.create_my_owner_workspace_agent($1,'Workspace test bot',$2) v",[hash,days]);
  const school=(hash,days)=>value("select public.create_my_school_only_bot($1,'School test bot',$2,'omit') v",[hash,days]);
  const operation=(hash,action='status',payload={})=>value('select public.agent_access_operation($1,$2,$3::jsonb) v',[hash,action,JSON.stringify(payload)]);
  const insert=(hash,who,ids,days)=>value("insert into public.agent_access_grants (owner_id,label,token_hash,create_tag_ids,expires_at) values($1,'Direct insert fixture',$2,$3::uuid[],now()+make_interval(days=>$4)) returning id v",[who,hash,ids,days]);
  const key=()=>crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');
  const state=async()=>(await db.query('select id,owner_id,label,token_hash,create_tag_ids,created_at,expires_at,revoked_at,owner_workspace from public.agent_access_grants order by id')).rows;
  const schoolDefinition=()=>value("select pg_get_functiondef('public.create_my_school_only_bot(text,text,integer,text)'::regprocedure) v");
  const tenure=id=>value("select (expires_at = created_at + interval '365 days') v from public.agent_access_grants where id=$1",[id]);
  const name=(await readdir(directory)).find(file=>file.endsWith('_standard_agent_code_lifetime_365.sql'));
  assert.ok(name,'Supabase CLI-generated duration migration exists');

  await root();
  const before=await state(), schoolBefore=await schoolDefinition();
  await asRole('authenticated',owner);
  await assert.rejects(workspace(key(),365),/AGENT_INVALID/);
  await assert.rejects(selected(key(),365),/AGENT_INVALID/);
  await root();
  await db.exec(await readFile(new URL(name,directory),'utf8'));
  assert.deepEqual(await state(),before,'Migration does not rotate, renew, rescope or rewrite any old row');
  assert.equal(await schoolDefinition(),schoolBefore,'School-only RPC stays unchanged');
  assert.equal(await value("select relrowsecurity v from pg_class where oid='public.agent_access_grants'::regclass"),true);

  // The school ceiling holds even without RLS (e.g. migration/admin writes).
  await assert.rejects(insert(key(),owner,[],365),/agent_access_grants_expiration_check/);
  await assert.rejects(insert(key(),owner,[tag],366),/agent_access_grants_expiration_check/);
  await asRole('anon');
  await assert.rejects(workspace(key(),365),/permission denied/);
  await assert.rejects(selected(key(),365),/permission denied/);
  await asRole('authenticated',other);
  await assert.rejects(workspace(key(),365),/AGENT_ADMIN_REQUIRED/);
  await assert.rejects(selected(key(),365),/AGENT_ADMIN_REQUIRED/);
  await asRole('authenticated',owner);
  await assert.rejects(school(key(),365),/SCHOOL_INVALID/);
  const school90=await school(key(),90);
  assert.equal(await value("select (expires_at = created_at + interval '90 days') v from public.agent_access_grants where id=$1",[school90]),true);
  await value('select public.revoke_my_agent_access($1) v',[school90]);
  await assert.rejects(workspace(key(),366),/AGENT_INVALID/);
  await assert.rejects(selected(key(),366),/AGENT_INVALID/);
  await assert.rejects(selected(key(),365,[foreign]),/AGENT_INVALID/);
  await assert.rejects(insert(key(),owner,[],365),/row-level security/);
  await assert.rejects(insert(key(),owner,[tag],366),/row-level security/);
  await assert.rejects(insert(key(),other,[tag],365),/row-level security/);

  const selectedHash=key(), workspaceHash=key();
  const narrow=await selected(selectedHash,365), wide=await workspace(workspaceHash,365);
  assert.equal(await tenure(narrow.id),true);
  assert.equal(await tenure(wide.id),true);
  await assert.rejects(db.query('select token_hash from public.agent_access_grants'),/permission denied/);
  await assert.rejects(db.query('update public.agent_access_grants set expires_at=now() where id=$1',[wide.id]),/permission denied/);
  await asRole('service_role');
  assert.equal((await operation(workspaceHash)).scope,'owner_workspace');
  assert.equal((await operation(workspaceHash,'detail',{kind:'task',id:hidden})).item.id,hidden);
  await assert.rejects(operation(workspaceHash,'detail',{kind:'task',id:foreign}),/AGENT_NOT_FOUND/);
  assert.equal((await operation(selectedHash,'detail',{kind:'task',id:task})).item.id,task);
  await assert.rejects(operation(selectedHash,'detail',{kind:'task',id:hidden}),/AGENT_NOT_FOUND/);
  await assert.rejects(operation(selectedHash,'detail',{kind:'task',id:foreign}),/AGENT_NOT_FOUND/);

  await root();
  const otherAdmin=crypto.randomUUID();
  await db.query('insert into auth.users values($1)',[otherAdmin]);
  await db.query('insert into public.user_profiles values($1,true,true)',[otherAdmin]);
  const expiredHash=key();
  await db.query("insert into public.agent_access_grants (owner_id,label,token_hash,create_tag_ids,created_at,expires_at,owner_workspace) values($1,'Expired workspace fixture',$2,'{}',now()-interval '366 days',now()-interval '1 day',true)",[owner,expiredHash]);
  await asRole('service_role');
  await assert.rejects(operation(expiredHash),/AGENT_UNAUTHORIZED/);
  await asRole('authenticated',otherAdmin);
  assert.equal(await value('select count(*)::int v from public.agent_access_grants where id=any($1::uuid[])',[[narrow.id,wide.id]]),0);
  await assert.rejects(value('select public.revoke_my_agent_access($1) v',[wide.id]),/AGENT_FORBIDDEN/);
  await assert.rejects(insert(key(),owner,[tag],365),/row-level security/);
  await asRole('authenticated',owner);
  await value('select public.revoke_my_agent_access($1) v',[wide.id]);
  await asRole('service_role');
  await assert.rejects(operation(workspaceHash),/AGENT_UNAUTHORIZED/);

  await root();
  const beforeRollback=await state();
  await db.exec(await readFile(new URL('../../supabase/rollback-standard-agent-code-lifetime-365.sql',import.meta.url),'utf8'));
  assert.deepEqual(await state(),beforeRollback,'Rollback must not alter valid longer leases or revive revoked codes');
  await asRole('service_role');
  assert.ok((await operation(selectedHash)).permissions.read,'An issued 365-day code remains valid after issuer rollback');
  await asRole('authenticated',owner);
  await assert.rejects(workspace(key(),365),/AGENT_INVALID/);
  await assert.rejects(selected(key(),365),/AGENT_INVALID/);
  await assert.rejects(insert(key(),owner,[tag],365),/row-level security/);
  // With the tiered table CHECK still present, a grandfathered lease can be revoked.
  await value('select public.revoke_my_agent_access($1) v',[narrow.id]);
  await asRole('service_role');
  await assert.rejects(operation(selectedHash),/AGENT_UNAUTHORIZED/);
  await root();
  console.log('PASS standard Agent expiry SQL: 365/366, unchanged school limit and rows, owner-only RLS, revocation and non-disruptive rollback');
}
