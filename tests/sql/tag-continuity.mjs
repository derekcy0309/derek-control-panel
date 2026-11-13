// Isolated PostgreSQL fixture: real tag migrations + real recurrence generator.
// V2 is a minimal add-only restore fixture; the real V1/V2 chain is also verified
// in a ROLLBACK-only transaction against Supabase before release. No network here.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
if (!process.env.PGLITE_MODULE) throw new Error('Set PGLITE_MODULE to the local PGlite installation');
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
const db = new PGlite();
const users = ['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333'];
const directory = new URL('../../supabase/migrations/',import.meta.url);
const load = async name => db.exec(await readFile(new URL(name,directory),'utf8'));
const asUser = async index => {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[users[index]]);
  await db.exec('set role authenticated');
};
const backup = (index,data={}) => ({format:'derek-control-panel-backup',version:1,ownerId:users[index],exportedAt:'2026-11-14T00:00:00Z',data});
const restore = async value => (await db.query('select public.restore_backup_v3($1::jsonb) as result',[JSON.stringify(value)])).rows[0].result;
try {
  await db.exec(`
    create role authenticated; create role anon;
    create schema auth; create schema private;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table auth.users(id uuid primary key);
    create table public.tasks(
      id uuid primary key default gen_random_uuid(),user_id uuid,owner_id uuid,created_by_id uuid,
      scope text default 'home',area text default 'personal',source_type text default 'follow_up',title text not null,
      description text,due_date date,follow_up_date date,planned_date date,status text default 'not_started',
      next_action text,definition_of_done text,estimated_minutes integer,energy_level text,context text,
      risk text default 'low',critical_path boolean,safety_impact boolean,child_impact boolean,legal_impact boolean,
      estimated_duration_days integer,buffer_days integer,project_id uuid,visibility text default 'private',
      deleted_at timestamptz,archived_at timestamptz
    );
    create table public.operating_items(id uuid primary key,item_type text,owner_id uuid,archived_at timestamptz);
    create table public.test_shares(task_id uuid,user_id uuid);
    create table public.transactions(id integer primary key,amount numeric); insert into public.transactions values(1,9876);
    create table public.activity_logs(id uuid primary key default gen_random_uuid(),resource_type text,resource_id uuid,actor_id uuid,action text,summary text);
    create table public.notification_preferences(user_id uuid primary key,today_reminder_time time,timezone text);
    create table public.test_notifications(user_id uuid,kind text,resource_id uuid,dedupe_key text unique);
    create function private.notification_local_time(d date,t time,z text) returns timestamptz language sql as $$select (d+t) at time zone z$$;
    create function private.enqueue_notification(u uuid,k text,r text,i uuid,t timestamptz,d text) returns void language sql as $$insert into public.test_notifications values(u,k,i,d) on conflict do nothing$$;
    create table public.backup_restore_audit_logs(id uuid primary key default gen_random_uuid(),user_id uuid,event_kind text,backup_exported_at timestamptz,record_counts jsonb);
    alter table public.tasks enable row level security;
    create policy tasks_read on public.tasks for select to authenticated using(owner_id=(select auth.uid()) or exists(select 1 from public.test_shares s where s.task_id=id and s.user_id=(select auth.uid())));
    create policy tasks_insert on public.tasks for insert to authenticated with check(owner_id=(select auth.uid()));
    create policy tasks_update on public.tasks for update to authenticated using(owner_id=(select auth.uid()) or exists(select 1 from public.test_shares s where s.task_id=id and s.user_id=(select auth.uid())));
    alter table public.activity_logs enable row level security;
    create policy activity_read on public.activity_logs for select to authenticated using(actor_id=(select auth.uid()));
    create policy activity_insert on public.activity_logs for insert to authenticated with check(actor_id=(select auth.uid()) and resource_type='task' and exists(select 1 from public.tasks where id=resource_id));
    alter table public.backup_restore_audit_logs enable row level security;
    create policy audit_self on public.backup_restore_audit_logs for all to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
    grant usage on schema public,auth to authenticated,anon;
    grant select,insert,update on public.tasks to authenticated;
    grant select on public.test_shares to authenticated;
    grant select,insert on public.activity_logs,public.backup_restore_audit_logs to authenticated;
    create function public.restore_backup_v2(b jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
    declare n integer;
    begin
      if b->>'ownerId' is distinct from auth.uid()::text then raise exception 'BACKUP_INVALID'; end if;
      insert into public.tasks(id,user_id,owner_id,title)
        select (t->>'id')::uuid,auth.uid(),auth.uid(),t->>'title' from jsonb_array_elements(coalesce(b->'data'->'tasks','[]'::jsonb)) t on conflict do nothing;
      get diagnostics n=row_count;
      insert into public.backup_restore_audit_logs(user_id,event_kind,record_counts) values(auth.uid(),'restore',jsonb_build_object('tasks',n));
      return jsonb_build_object('tasks',n);
    end; $$;
    revoke all on function public.restore_backup_v2(jsonb) from public,anon; grant execute on function public.restore_backup_v2(jsonb) to authenticated;
  `);
  for (const user of users) await db.query('insert into auth.users values($1)',[user]);
  await load('20260724173935_recurring_task_routines.sql');
  await db.exec("alter table public.task_recurrence_rules add column deadline_mode text not null default 'scheduled'");
  await load('20260910150051_routine_interval_schedule.sql');
  await load('20260913121000_weekly_routine_end_date.sql');
  await load('20261113172120_personal_task_tags.sql');
  const newMigration=(await readdir(directory)).find(name=>name.endsWith('_recurrence_and_backup_tags.sql'));
  assert.ok(newMigration); await load(newMigration);
  console.log('PASS: migration applies without replacing the existing recurrence generator');

  const ownTags=[];
  for(let i=0;i<3;i++) {
    await asUser(i); await db.query('select public.ensure_my_task_tags($1)',[i===0]);
    ownTags[i]=(await db.query('select * from public.personal_task_tags where deleted_at is null order by name')).rows;
    const tag={id:crypto.randomUUID(),user_id:users[i],name:`Fixture Tag ${i}`};
    const taskId=crypto.randomUUID();
    const value=backup(i,{tasks:[{id:taskId,title:`Restored ${i}`}],personalTaskTags:[tag],taskTagAssignments:[{user_id:users[i],task_id:taskId,tag_id:tag.id}],taskTagPreferences:[{user_id:users[i],initialized_at:'2026-11-14T00:00:00Z'}]});
    const first=await restore(value); assert.equal(first.personalTaskTags,1); assert.equal(first.taskTagAssignments,1);
    const second=await restore(value); assert.equal(second.tasks,0); assert.equal(second.personalTaskTags,0); assert.equal(second.taskTagAssignments,0);
    assert.equal((await db.query('select tag_id from public.task_tag_assignments where task_id=$1',[taskId])).rows[0].tag_id,tag.id);
    const foreign=structuredClone(value); foreign.data.personalTaskTags[0].user_id=users[(i+1)%3];
    await assert.rejects(restore(foreign),/BACKUP_INVALID/);
    const old=await restore(backup(i)); assert.equal(old.personalTaskTags,0); assert.equal(old.taskTagAssignments,0);
  }
  console.log('PASS: all three roles round-trip tags and links; repeated/old backups are safe; foreign ownership is rejected');

  await asUser(0);
  const taskId=crypto.randomUUID(); await db.query('insert into public.tasks(id,user_id,owner_id,title) values($1,$2,$2,$3)',[taskId,users[0],'Same-name restore']);
  const existing=ownTags[0][0]; const incoming={...existing,id:crypto.randomUUID(),name:` ${existing.name.toUpperCase()} `};
  const duplicate=backup(0,{personalTaskTags:[incoming],taskTagAssignments:[{user_id:users[0],task_id:taskId,tag_id:incoming.id}]});
  const reused=await restore(duplicate); assert.equal(reused.personalTaskTags,0); assert.equal(reused.taskTagAssignments,1);
  assert.equal((await db.query('select tag_id from public.task_tag_assignments where task_id=$1',[taskId])).rows[0].tag_id,existing.id);
  const renamed={...existing,name:'Old backup name'};
  assert.equal((await restore(backup(0,{personalTaskTags:[renamed]}))).personalTaskTags,0);
  assert.equal((await db.query('select name from public.personal_task_tags where id=$1',[existing.id])).rows[0].name,existing.name);
  await db.query("select public.manage_my_task_tag('delete',$1)",[existing.id]);
  const removed=await restore(duplicate); assert.equal(removed.taskTagAssignments,1,'different ID/name is a new tag, not a resurrection');
  const removedExact=await restore(backup(0,{personalTaskTags:[existing],taskTagAssignments:[{user_id:users[0],task_id:taskId,tag_id:existing.id}]}));
  assert.equal(removedExact.personalTaskTags,0); assert.equal(removedExact.taskTagAssignments,0);
  assert.ok((await db.query('select deleted_at from public.personal_task_tags where id=$1',[existing.id])).rows[0].deleted_at);
  console.log('PASS: same-name mapping reuses IDs; existing renames and deletions are never overwritten');

  // A recurring task is generated by the real production trigger, including
  // no-deadline reminders and end dates; an assignee can complete the source.
  for(const [index,frequency,mode] of [[0,'daily','scheduled'],[1,'weekly','none'],[2,'monthly','scheduled'],[0,'custom','scheduled'],[2,'interval','scheduled']]) {
    await asUser(index);
    const seed=crypto.randomUUID(),rule=crypto.randomUUID();
    await db.query('insert into public.tasks(id,user_id,owner_id,created_by_id,title,due_date) values($1,$2,$2,$2,$3,$4)',[seed,users[index],`Routine ${frequency}`,'2026-11-14']);
    await db.query(`insert into public.task_recurrence_rules(id,seed_task_id,owner_id,created_by_id,frequency,weekdays,custom_interval_days,template,deadline_mode,interval_value,interval_unit)
      values($1,$2,$3,$3,$4,$5,$6,$7::jsonb,$8,$9,$10)`,[rule,seed,users[index],frequency,frequency==='weekly'?[1,4]:[],frequency==='custom'?3:null,JSON.stringify({title:`Routine ${frequency}`,scope:'home',area:'personal',sourceType:'follow_up',risk:'low'}),mode,frequency==='interval'?2:null,frequency==='interval'?'day':null]);
    await db.query('update public.tasks set recurrence_rule_id=$1 where id=$2',[rule,seed]);
    const active=(await db.query('select id from public.personal_task_tags where deleted_at is null order by id limit 2')).rows.map(tag=>tag.id);
    await db.query('select public.set_my_task_tags($1,$2::uuid[])',[seed,active]);
    if(frequency==='custom') {
      const retired=(await db.query("select (public.manage_my_task_tag('create',null,'Retired routine tag')).id")).rows[0].id;
      await db.query('select public.set_my_task_tags($1,$2::uuid[])',[seed,[...active,retired]]);
      await db.query("select public.manage_my_task_tag('delete',$1)",[retired]);
    }
    if(frequency==='daily') {
      await db.exec('reset role'); await db.query('insert into public.test_shares values($1,$2)',[seed,users[1]]);
      await asUser(1); await db.query('select public.set_my_task_tags($1,$2::uuid[])',[seed,[ownTags[1][0].id]]);
    }
    await db.query("update public.tasks set status='done' where id=$1",[seed]);
    await asUser(index);
    const next=(await db.query('select generated_task_id from public.task_recurrence_generations where source_task_id=$1',[seed])).rows[0].generated_task_id;
    assert.deepEqual((await db.query('select tag_id from public.task_tag_assignments where task_id=$1 order by tag_id',[next])).rows.map(row=>row.tag_id),active.sort());
    await db.query("update public.tasks set status='not_started' where id=$1",[seed]);
    await db.query("update public.tasks set status='done' where id=$1",[seed]);
    assert.equal((await db.query('select count(*)::int n from public.task_recurrence_generations where source_task_id=$1',[seed])).rows[0].n,1);
    if(frequency==='daily') {
      await asUser(1); assert.equal((await db.query('select id from public.tasks where id=$1',[next])).rows.length,0);
      assert.equal((await db.query('select task_id from public.task_tag_assignments where task_id=$1',[next])).rows.length,0);
      await asUser(index);
      await db.query('select public.set_my_task_tags($1,$2::uuid[])',[next,[active[0]]]);
      await db.query("update public.tasks set status='done' where id=$1",[next]);
      const later=(await db.query('select generated_task_id from public.task_recurrence_generations where source_task_id=$1',[next])).rows[0].generated_task_id;
      assert.deepEqual((await db.query('select tag_id from public.task_tag_assignments where task_id=$1',[later])).rows.map(row=>row.tag_id),[active[0]],'later rounds inherit the latest occurrence, not stale seed tags');
    }
  }
  console.log('PASS: daily/weekly/monthly/custom/interval + no deadline inherit current owner tags; assignee private labels stay private; no duplicate generation');

  await asUser(2);
  const all=(await db.query('select id from public.personal_task_tags where deleted_at is null')).rows;
  for(const tag of all) await db.query("select public.manage_my_task_tag('delete',$1)",[tag.id]);
  const zero=await restore(backup(2,{personalTaskTags:[],taskTagAssignments:[],taskTagPreferences:[{user_id:users[2],initialized_at:'2026-11-14T00:00:00Z'}]}));
  assert.equal(zero.personalTaskTags,0); await db.query('select public.ensure_my_task_tags(false)');
  assert.equal((await db.query('select count(*)::int n from public.personal_task_tags where deleted_at is null')).rows[0].n,0);
  const privateTask=crypto.randomUUID(); await db.exec('reset role');
  await db.query('insert into public.tasks(id,user_id,owner_id,title) values($1,$2,$2,$3)',[privateTask,users[0],'Private fixture']);
  await asUser(1);
  const linkAttempt=await restore(backup(1,{personalTaskTags:[ownTags[1][0]],taskTagAssignments:[{user_id:users[1],task_id:privateTask,tag_id:ownTags[1][0].id}]}));
  assert.equal(linkAttempt.taskTagAssignments,0);
  console.log('PASS: deleted-all presets stay deleted; restore cannot grant access to a private task');

  // Force a capacity failure after V2 inserts a task: the WHOLE restore must undo.
  await asUser(1);
  for(let i=0;i<58;i++) await db.query('insert into public.personal_task_tags(user_id,name) values($1,$2) on conflict do nothing',[users[1],`Limit ${i}`]);
  const failedTask=crypto.randomUUID(),failedTag=crypto.randomUUID();
  await assert.rejects(restore(backup(1,{tasks:[{id:failedTask,title:'Must rollback'}],personalTaskTags:[{id:failedTag,user_id:users[1],name:'Over the limit'}]})),/BACKUP_TAG_LIMIT/);
  assert.equal((await db.query('select id from public.tasks where id=$1',[failedTask])).rows.length,0);
  assert.equal((await db.query('select id from public.personal_task_tags where id=$1',[failedTag])).rows.length,0);
  await db.exec('reset role'); assert.equal((await db.query('select amount from public.transactions')).rows[0].amount,'9876');
  assert.equal((await db.query('select count(*)::int n from public.test_notifications')).rows[0].n,1);
  await db.exec('set role anon'); await assert.rejects(restore(backup(0)),/permission denied/);
  console.log('PASS: tag failure rolls back new tasks and tags atomically; finance unchanged; reminder dedupe preserved; anonymous RPC rejected');
} finally { await db.close(); }
