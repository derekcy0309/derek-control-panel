// Isolated fixture: no network, customer data, or production credentials.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
if (!process.env.PGLITE_MODULE) throw new Error("Set PGLITE_MODULE to a local @electric-sql/pglite installation");
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
const db = new PGlite();
const accounts = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"];
const ids = Array.from({ length: 11 }, (_, n) => `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa${n.toString(16)}`);
const note = (dir, file) => readFile(new URL(`../../supabase/${dir}/${file}`, import.meta.url), "utf8");
const baseline = await note("migrations", "20261113172120_personal_task_tags.sql");
const migration = await note("migrations", "20261124061808_dayline_task_classifications_as_tags.sql");
const role = async i => {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [accounts[i]]);
  await db.exec("set role authenticated");
};
const labels = async id => (await db.query(`
  select t.name from public.task_tag_assignments a
  join public.personal_task_tags t on t.user_id=a.user_id and t.id=a.tag_id
  where a.task_id=$1 and t.deleted_at is null order by t.name
`, [id])).rows.map(row => row.name).sort();
const dump = async sql => JSON.stringify((await db.query(sql)).rows);
try {
  await db.exec(`
    create role authenticated; create role anon;
    create schema auth; create schema private;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create table public.user_profiles(user_id uuid primary key,active boolean,is_admin boolean);
    create table public.tasks(id uuid primary key,user_id uuid,owner_id uuid,area text,scope text,title text,deleted_at timestamptz,
      archived_at timestamptz,requested_priority int,task_type text,task_type_label text);
    create table public.activity_logs(id uuid primary key default gen_random_uuid(),resource_type text,resource_id uuid,actor_id uuid,action text,summary text);
    create table public.test_shares(task_id uuid,user_id uuid);
    alter table public.tasks enable row level security;
    create policy task_read on public.tasks for select to authenticated using (coalesce(owner_id,user_id)=(select auth.uid()) or exists (
      select 1 from public.test_shares s where s.task_id=id and s.user_id=(select auth.uid())
    ));
    alter table public.activity_logs enable row level security;
    create policy activity_read on public.activity_logs for select to authenticated using(actor_id=(select auth.uid()));
    create policy activity_insert on public.activity_logs for insert to authenticated with check (actor_id=(select auth.uid()) and resource_type='task');
    grant usage on schema public,auth to authenticated,anon;
    grant select on public.tasks, public.test_shares to authenticated;
    grant select,insert on public.activity_logs to authenticated;
  `);
  for (let i = 0; i < accounts.length; i++) {
    await db.query("insert into auth.users values($1,$2,now())", [accounts[i], i ? `account-${i}@example.test` : "DerekCY0309@gmail.com"]);
    await db.query("insert into public.user_profiles values($1,true,$2)", [accounts[i], i === 0]);
  }
  await db.exec(baseline);
  const seedTask = (n, creator, owner, area, scope, priority, taskType = "general", label = null, archived = false, deleted = false) =>
    db.query(`insert into public.tasks values($1,$2,$3,$4,$5,$6,case when $7::bool then now() end,case when $8::bool then now() end,$9,$10,$11)`,
      [ids[n],accounts[creator],owner === null ? null : accounts[owner],area,scope,n === 0 ? "恩海居 — ambiguous title" : `Fixture ${n}`,deleted,archived,priority,taskType,label]);
  await seedTask(0, 0, 0, "work", "company", 2);
  await seedTask(1, 0, 0, "family", "home", 3, "general", null, true);
  await seedTask(2, 0, 0, "personal", "home", 5, "general", null, false, true);
  await seedTask(3, 0, 0, "personal", "home", 4, "training", "我的舊類型");
  await seedTask(4, 1, 0, "work", "home", 1);
  await seedTask(5, 1, null, "family", "home", 5, "follow_up");
  await seedTask(6, 0, 0, "personal", "home", 3, "general", "長".repeat(41));
  await seedTask(7, 1, 1, "work", "company", 5, "general", "恩海居");
  await seedTask(8, 1, 1, "work", "company", 5, "general", "sec");
  await seedTask(9, 1, 1, "work", "company", 5, "general", "家庭");
  await db.query("insert into public.test_shares values($1,$2)", [ids[0], accounts[1]]);
  await db.query("insert into public.task_tag_preferences(user_id) values($1)", [accounts[0]]);
  const renamedTag = (await db.query("insert into public.personal_task_tags(user_id,name,legacy_key) values($1,'已改名的公司標籤','wecare') returning id", [accounts[0]])).rows[0].id;
  await db.query("insert into public.personal_task_tags(user_id,name,legacy_key,deleted_at) values($1,'以前的 SEC','sec',now())", [accounts[0]]);
  const recreated = (await db.query("insert into public.personal_task_tags(user_id,name) values($1,'SEC') returning id", [accounts[0]])).rows[0].id;
  const existing = (await db.query("insert into public.personal_task_tags(user_id,name) values($1,'自訂') returning id", [accounts[0]])).rows[0].id;
  const manualWecare = (await db.query("insert into public.personal_task_tags(user_id,name) values($1,'Wecare') returning id", [accounts[1]])).rows[0].id;
  await db.query("insert into public.task_tag_assignments values($1,$2,$3)", [accounts[0],ids[0],existing]);
  await db.query("insert into public.task_tag_assignments values($1,$2,$3)", [accounts[1],ids[8],manualWecare]);
  const before = await dump("select * from public.tasks order by id");

  await db.exec(migration);
  assert.equal(await dump("select * from public.tasks order by id"),before,"existing tasks and priorities unchanged");
  assert.ok((await db.query("select id from public.task_tag_assignments a join public.personal_task_tags t on t.id=a.tag_id where a.task_id=$1 and t.id=$2", [ids[0],renamedTag])).rows.length);
  assert.equal((await db.query("select count(*)::int n from public.task_tag_assignments where tag_id=$1", [recreated])).rows[0].n,0,"old deletion cannot revive under recreated name");
  const stats = (await db.query("select created_tags,created_links,initialized_accounts,skipped_oversize_labels from private.dayline_task_classification_tag_runs")).rows[0];
  assert.equal(Number(stats.initialized_accounts),1);
  assert.equal(Number(stats.skipped_oversize_labels),1);
  assert.ok(Number(stats.created_links) > 0 && Number(stats.created_tags) > 0);

  await role(0);
  assert.deepEqual(await labels(ids[0]),["P1","已改名的公司標籤","自訂"].sort());
  assert.deepEqual(await labels(ids[1]),["P2","家庭"].sort(),"archived task classification retained");
  assert.deepEqual(await labels(ids[2]),[],"deleted task not revived or assigned");
  assert.deepEqual(await labels(ids[3]),["P2","我的舊類型","個人"].sort());
  assert.deepEqual(await labels(ids[4]),["P1"],"actual owner, not task creator, receives tags");
  assert.deepEqual(await labels(ids[6]),["P2","個人"].sort(),"40-char limit must not truncate original label");
  assert.equal((await db.query("select count(*)::int n from public.personal_task_tags where name='恩海居'")).rows[0].n,0,"do not add a second label for SEC");
  assert.deepEqual((await db.query("select name from public.personal_task_tags where name in ('個人','家庭','SEC','P1','P2','P3') and deleted_at is null")).rows.map(r=>r.name).sort(),["個人","家庭","SEC","P1","P2","P3"].sort());
  const p1 = (await db.query("select id from public.personal_task_tags where name='P1'")).rows[0].id;
  await db.query("select public.set_my_task_tags($1,array[$2]::uuid[])",[ids[0],existing]);
  await db.query("select public.manage_my_task_tag('delete',$1)",[p1]);
  await role(1);
  assert.deepEqual(await labels(ids[0]),[],"visible shared task cannot expose owner's migrated tags");
  assert.deepEqual(await labels(ids[4]),[],"creator is not automatically the owner");
  assert.deepEqual(await labels(ids[5]),["P3","家庭","跟進"].sort());
  assert.deepEqual(await labels(ids[7]),["P3","SEC"].sort(),"explicit historical 恩海居 overrides generic Wecare for company tasks");
  assert.deepEqual(await labels(ids[8]),["P3","SEC","Wecare"].sort(),"manual Wecare assignment is retained when explicit SEC is imported");
  assert.deepEqual(await labels(ids[9]),["P3","家庭"].sort(),"explicit 家庭 also overrides generic Wecare");
  assert.ok((await db.query("select name from public.personal_task_tags where name in ('個人','Wecare')")).rows.length === 2);
  assert.ok((await db.query("select name from public.personal_task_tags where name in ('恩海居','P1','P2')")).rows.length === 0);
  await db.query("select public.ensure_my_task_tags(false)");
  assert.deepEqual(await labels(ids[5]),["P3","家庭","跟進"].sort(),"old initializer compatible with pre-initialization");
  await role(2);
  assert.equal((await db.query("select count(*)::int n from public.personal_task_tags")).rows[0].n,0,"unrelated accounts are not seeded");
  await db.exec("reset role");
  await seedTask(10, 2, 2, "personal", "home", 3);
  await role(2);
  await db.query("select public.ensure_my_task_tags(false)");
  assert.deepEqual((await db.query("select name from public.personal_task_tags order by name")).rows.map(t=>t.name).sort(),["Wecare","個人"].sort());
  assert.deepEqual(await labels(ids[10]),[],"opening Tags after title-only creation must not silently attach presets");
  await db.exec("reset role");
  await db.exec(migration);
  await role(0);
  assert.deepEqual(await labels(ids[0]),["自訂"],"replay must not add removed labels back");
  assert.equal((await db.query("select count(*)::int n from public.personal_task_tags where name='P1' and deleted_at is null")).rows[0].n,0);
  await assert.rejects(db.query("select * from private.dayline_task_classification_tag_runs"),/permission denied/);
  await db.exec("reset role; set role anon");
  await assert.rejects(db.query("select * from public.task_tag_assignments"),/permission denied/);
  await assert.rejects(db.query("select public.ensure_my_task_tags(false)"),/permission denied/);
  console.log("PASS classifications-as-tags: owner-only copy, archived tasks, presets, privacy, no title inference, old data unchanged and replay respects removals");
} finally {
  await db.close();
}
