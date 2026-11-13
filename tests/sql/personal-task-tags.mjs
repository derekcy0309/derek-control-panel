// Isolated PostgreSQL WASM fixture. Never connects to Supabase or uses real task data.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
if (!process.env.PGLITE_MODULE) throw new Error('PGLITE_MODULE must point to a local @electric-sql/pglite installation');
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
const db = new PGlite();
const users = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333'];
const tasks = ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'];
try {
  await db.exec(`
    create role authenticated; create role anon;
    create schema auth; create schema private;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table auth.users(id uuid primary key);
    create table public.tasks(id uuid primary key, user_id uuid, owner_id uuid, area text, scope text, title text, deleted_at timestamptz, archived_at timestamptz);
    create table public.test_shares(task_id uuid,user_id uuid);
    create table public.transactions(id integer primary key,amount numeric);
    insert into public.transactions values(1,1234);
    create table public.activity_logs(id uuid primary key default gen_random_uuid(),resource_type text,resource_id uuid,actor_id uuid,action text,summary text,created_at timestamptz default now());
    alter table public.tasks enable row level security;
    create policy task_read on public.tasks for select to authenticated using(owner_id=(select auth.uid()) or exists(select 1 from public.test_shares s where s.task_id=id and s.user_id=(select auth.uid())));
    alter table public.activity_logs enable row level security;
    create policy activity_read on public.activity_logs for select to authenticated using(actor_id=(select auth.uid()));
    create policy activity_insert on public.activity_logs for insert to authenticated with check(actor_id=(select auth.uid()) and resource_type='task' and exists(select 1 from public.tasks where id=resource_id));
    grant usage on schema public,auth to authenticated,anon;
    grant select on public.tasks,public.test_shares to authenticated;
    grant select,insert on public.activity_logs to authenticated;
  `);
  for (let i=0;i<3;i++) {
    await db.query('insert into auth.users values($1)',[users[i]]);
    await db.query('insert into public.tasks(id,user_id,owner_id,area,scope,title) values($1,$2,$2,$3,$4,$5)',[tasks[i],users[i],i===0?'family':'work',i===1?'company':'home',`Fixture ${i}`]);
  }
  await db.query('insert into public.test_shares values($1,$2)',[tasks[0],users[1]]);
  const before = JSON.stringify((await db.query('select * from public.tasks order by id')).rows);
  const migration = await readFile(new URL('../../supabase/migrations/20261113172120_personal_task_tags.sql',import.meta.url),'utf8');
  await db.exec(migration);
  const asUser = async(index) => { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub',$1,false)",[users[index]]); await db.exec('set role authenticated'); };
  const tags = [];
  for(let i=0;i<3;i++) {
    await asUser(i);
    await db.query('select public.ensure_my_task_tags($1)',[i===0]);
    tags[i] = (await db.query('select id,name from public.personal_task_tags where deleted_at is null order by name')).rows;
    assert.deepEqual(tags[i].map(t=>t.name).sort(),(i===0?['個人','家庭','SEC','Wecare']:['個人','Wecare']).sort());
    assert.equal((await db.query('select count(*)::int n from public.task_tag_preferences')).rows[0].n,1);
  }
  console.log('PASS: Derek keeps four legacy tags; Suki/Amigo start with only Personal/Wecare; RLS isolates definitions');
  await asUser(1);
  await assert.rejects(db.query("select public.manage_my_task_tag('rename',$1,'Not yours')",[tags[0][0].id]),/Tag not found/);
  await assert.rejects(db.query('insert into public.personal_task_tags(user_id,name) values($1,$2)',[users[0],'forbidden']),/row-level security/);
  await assert.rejects(db.query('select public.set_my_task_tags($1,$2::uuid[])',[tasks[2],[tags[1][0].id]]),/Task not found/);
  await assert.rejects(db.query('select public.set_my_task_tags($1,$2::uuid[])',[tasks[0],[tags[0][0].id]]),/Tag not allowed/);
  console.log('PASS: foreign tag edits, foreign tag links and private task linking are rejected');
  await db.query('select public.set_my_task_tags($1,$2::uuid[])',[tasks[0],[tags[1][0].id]]);
  await asUser(0);
  assert.equal((await db.query('select tag_id from public.task_tag_assignments where task_id=$1',[tasks[0]])).rows.length,1);
  assert.notEqual((await db.query('select tag_id from public.task_tag_assignments where task_id=$1',[tasks[0]])).rows[0].tag_id,tags[1][0].id);
  await db.query("select public.manage_my_task_tag('rename',$1,'New label')",[tags[0][0].id]);
  await asUser(1);
  assert.ok((await db.query('select name from public.personal_task_tags')).rows.every(t=>t.name!=='New label'));
  console.log('PASS: shared task labels and renames remain viewer-private');
  await db.exec('reset role'); await db.query('delete from public.test_shares where user_id=$1',[users[1]]); await asUser(1);
  assert.equal((await db.query('select id from public.tasks where id=$1',[tasks[0]])).rows.length,0);
  assert.equal((await db.query('select task_id from public.task_tag_assignments where task_id=$1',[tasks[0]])).rows.length,0);
  console.log('PASS: a saved tag never grants access after sharing is revoked');
  await asUser(2);
  for(const tag of tags[2]) await db.query("select public.manage_my_task_tag('delete',$1)",[tag.id]);
  await db.query('select public.ensure_my_task_tags(false)');
  assert.equal((await db.query('select count(*)::int n from public.personal_task_tags where deleted_at is null')).rows[0].n,0);
  await assert.rejects(db.exec('delete from public.task_tag_preferences'),/permission denied/);
  const created = (await db.query("select (public.manage_my_task_tag('create',null,'個人')).id")).rows[0].id;
  assert.ok(!tags[2].some(t=>t.id===created));
  console.log('PASS: removing all presets does not recreate them; recreating a name does not revive old links');
  const audit = (await db.query('select action,summary from public.activity_logs')).rows;
  assert.ok(audit.length>=3 && audit.every(row=>!row.summary.includes('New label')));
  await db.exec('reset role');
  assert.equal(JSON.stringify((await db.query('select * from public.tasks order by id')).rows),before);
  assert.equal((await db.query('select amount from public.transactions')).rows[0].amount,'1234');
  await db.exec('set role anon');
  await assert.rejects(db.exec('select * from public.personal_task_tags'),/permission denied/);
  await assert.rejects(db.exec('select public.ensure_my_task_tags(false)'),/permission denied/);
  console.log('PASS: audit is generic; original tasks/finance unchanged; anonymous access denied');
} finally { await db.close(); }
