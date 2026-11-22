// Local, isolated PostgreSQL smoke test. Does not use hosted data.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
if (!process.env.PGLITE_MODULE) throw new Error("Set PGLITE_MODULE to local PGlite");
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
const db = new PGlite();
const owner = crypto.randomUUID();
const other = crypto.randomUUID();
const unverified = crypto.randomUUID();
const session = crypto.randomUUID();
const otherSession = crypto.randomUUID();
const expiredSession = crypto.randomUUID();
const hash = "a".repeat(64);
const newHash = "b".repeat(64);
const oldOnlyHash = "c".repeat(64);
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0]?.v;
const asRole = async (role, claims = null) => {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify(claims)]);
  await db.exec(`set role ${role}`);
};
const raw = () => db.exec("reset role");
const service = () => asRole("service_role");
const human = (sub = owner, sessionId = session, ageSeconds = 0, anonymous = false) => asRole("authenticated", {
  role: "authenticated", sub, session_id: sessionId, is_anonymous: anonymous,
  amr: [{ method: "oauth", timestamp: Math.floor(Date.now() / 1000) - ageSeconds }]
});
const connect = (action, token = null, sessionId = null, who = owner) =>
  one("select public.grok_personal_connection($1,$2,$3,$4) v", [who, action, token, sessionId]);
const resolve = (token = hash) => one("select public.grok_personal_owner($1) v", [token]);
const queue = (dataset, id, token = hash) =>
  one("select public.grok_personal_request_archive($1,$2,$3) v", [token, dataset, id]);
const inbox = (who = owner) => one("select public.grok_personal_archives($1) v", [who]);
const decision = (id, ordered = true, confirm = "archive", sid = session, who = owner, action = "confirm") =>
  one("select public.grok_personal_decide_archive($1,$2,$3,$4,$5,$6) v", [who, id, action, sid, ordered, confirm]);
try {
  await db.exec(`
    create role authenticated; create role anon; create role service_role bypassrls;
    create schema auth;
    create function auth.jwt() returns jsonb language sql stable as $$select current_setting('request.jwt.claims',true)::jsonb$$;
    create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);
    create table public.user_profiles(user_id uuid primary key,is_admin boolean,active boolean);
    create table public.tasks(id uuid primary key default gen_random_uuid(),owner_id uuid,created_by_id uuid,title text not null,
      visibility text not null default 'private',household_id uuid,assignee_id uuid,needs_decision_from_id uuid,description text,
      parent_task_id uuid references public.tasks(id),project_id uuid,recurrence_rule_id uuid,archived_at timestamptz,deleted_at timestamptz);
    create table public.operating_items(id uuid primary key default gen_random_uuid(),owner_id uuid,created_by_id uuid,title text not null,
      item_type text not null,area text not null default 'personal',visibility text not null default 'private',household_id uuid,
      assignee_id uuid, description text,calendar_target text not null default 'none',archived_at timestamptz);
    create table public.transactions(id uuid primary key default gen_random_uuid(),user_id uuid,item text not null,scope text not null,
      type text not null default 'expense',amount numeric, expected_date date, actual_date date,
      archived_at timestamptz,recurring_expense_rule_id uuid,recurring_income_rule_id uuid);
    create table public.task_dependencies(task_id uuid,depends_on_task_id uuid);
    create table public.task_resources(linked_item_id uuid references public.operating_items(id),task_id uuid,owner_id uuid);
    create table public.task_handoff_notes(task_id uuid,author_id uuid);
    create table public.task_checkpoints(task_id uuid,author_id uuid);
    create table public.task_steps(task_id uuid,created_by_id uuid,updated_by_id uuid);
    create table public.task_recurrence_rules(seed_task_id uuid);
    create table public.focus_sessions(task_id uuid,user_id uuid,status text);
    create table public.share_records(resource_type text,resource_id uuid,shared_with_user_id uuid,revoked_at timestamptz,expires_at timestamptz);
    create table public.joint_memberships(resource_type text,resource_id uuid,user_id uuid,removed_at timestamptz);
    create table public.assignments(resource_type text,resource_id uuid,assigned_to_id uuid,assigned_by_id uuid,status text);
    create table public.task_followers(task_id uuid references public.tasks(id),follower_id uuid);
    create table public.calendar_event_links(operating_item_id uuid);
    -- Existing permission triggers require the genuine human subject even inside
    -- a definer. This equivalent guard catches accidentally using the service JWT.
    create function public.require_archive_owner() returns trigger language plpgsql as $$
      begin if new.archived_at is distinct from old.archived_at and auth.uid() is distinct from old.owner_id
        then raise exception 'AUTH_REQUIRED'; end if; return new; end; $$;
    create trigger require_task_owner before update on public.tasks for each row execute function public.require_archive_owner();
    create trigger require_item_owner before update on public.operating_items for each row execute function public.require_archive_owner();
    grant usage on schema auth to service_role,authenticated;
    grant select on public.tasks,public.operating_items,public.transactions to service_role;
    create table public.dayline_web_links(id uuid,title text,shelf text,owner_id uuid,archived_at timestamptz,updated_at timestamptz,url text);
  `);
  await db.query("insert into auth.users values($1,'DerekCY0309@gmail.com',now()),($2,'other@example.test',now()),($3,'derekcy0309@gmail.com',null)", [owner, other, unverified]);
  await db.query("insert into public.user_profiles values($1,true,true),($2,true,true),($3,true,true)", [owner, other, unverified]);
  await db.query("insert into auth.sessions values($1,$2,null),($3,$4,null),($5,$2,now()-interval '1 minute')", [session, owner, otherSession, other, expiredSession]);
  const task = async (label, who = owner, creator = who, visibility = "private") =>
    one("insert into public.tasks(owner_id,created_by_id,title,description,visibility) values($1,$2,$3,'NONSAMPLE_BODY',$4) returning id v", [who, creator, label, visibility]);
  const item = async (kind, label, area = "personal") =>
    one("insert into public.operating_items(owner_id,created_by_id,item_type,title,area) values($1,$1,$2,$3,$4) returning id v", [owner, kind, label, area]);
  const transaction = async (label, scope = "home", who = owner, recurring = null) =>
    one("insert into public.transactions(user_id,item,scope,amount,recurring_expense_rule_id) values($1,$2,$3,400,$4) returning id v", [who, label, scope, recurring]);
  const personalTask = await task("Personal fixture");
  const foreignTask = await task("Another owner's task", other);
  const differentCreator = await task("Other creator", owner, other);
  const sharedTask = await task("Private label with an active share");
  const followedTask = await task("Private label with a follower");
  const householdTask = await task("Household task", owner, owner, "household");
  const pendingAssignment = await task("Private label with an active assignment");
  const joinedTask = await task("Private label with a joint member");
  const hasChild = await task("Parent linked to child");
  const child = await task("Child");
  const dependent = await task("Dependency task");
  const independent = await task("Dependency prerequisite");
  const recurringTask = await task("Recurring task");
  const thirdPartyResourceTask = await task("Has a resource belonging to another user");
  const thirdPartyStepTask = await task("Has a step written by another user");
  const focusedTask = await task("Active timer");
  const note = await item("note", "Note fixture");
  const school = await item("school", "School fixture", "family");
  const family = await item("event", "Family event fixture", "family");
  const personalDocument = await item("document", "Document fixture");
  const excludedWorkDocument = await item("document", "Work document excluded", "work");
  const linkedNote = await item("note", "Note linked to a task");
  const providerCalendar = await item("event", "Synced event", "family");
  const cash = await transaction("Own home finance");
  const company = await transaction("Company finance", "company");
  const foreignCash = await transaction("Other user's home finance", "home", other);
  const generatedCash = await transaction("Generated recurring payment", "home", owner, crypto.randomUUID());
  await db.query("insert into public.share_records values('task',$1,$2,null,now()+interval '1 day')", [sharedTask, other]);
  await db.query("insert into public.task_followers values($1,$2)", [followedTask, other]);
  await db.query("insert into public.assignments values('task',$1,$2,$3,'pending_acceptance')", [pendingAssignment, other, owner]);
  await db.query("insert into public.joint_memberships values('task',$1,$2,null)", [joinedTask, other]);
  await db.query("update public.tasks set parent_task_id=$1 where id=$2", [hasChild, child]);
  await db.query("insert into public.task_dependencies values($1,$2)", [dependent, independent]);
  await db.query("update public.tasks set recurrence_rule_id=gen_random_uuid() where id=$1", [recurringTask]);
  await db.query("insert into public.task_resources(linked_item_id) values($1)", [linkedNote]);
  await db.query("insert into public.task_resources(task_id,owner_id) values($1,$2)", [thirdPartyResourceTask,other]);
  await db.query("insert into public.task_steps values($1,$2,$3)", [thirdPartyStepTask,owner,other]);
  await db.query("insert into public.focus_sessions values($1,$2,'running')", [focusedTask,owner]);
  await db.query("insert into public.calendar_event_links values($1)", [providerCalendar]);
  const migration = new URL("../../supabase/migrations/20261122032557_grok_personal_approved_archive.sql", import.meta.url);
  await db.exec(await readFile(migration, "utf8"));
  assert.equal(await one("select count(*)::int v from grok_personal_internal.connections"), 0);
  await asRole("anon");
  await assert.rejects(resolve(), /permission denied/i);
  await human();
  await assert.rejects(resolve(), /permission denied/i);
  await assert.rejects(connect("rotate", hash, session), /permission denied/i);
  await assert.rejects(db.query("select token_hash from grok_personal_internal.connections"), /permission denied/i);
  await service();
  assert.deepEqual((await db.query("select id,title,shelf,owner_id,archived_at,updated_at from public.dayline_web_links")).rows, []);
  await assert.rejects(db.query("select url from public.dayline_web_links"), /permission denied/i);
  assert.equal((await connect("status")).connected, false);
  assert.equal(await resolve(), null);
  assert.equal((await connect("rotate", hash, null)).status, "reauth");
  assert.equal((await connect("rotate", hash, otherSession)).status, "reauth");
  assert.equal((await connect("rotate", hash, expiredSession)).status, "reauth");
  assert.equal((await connect("rotate", hash, otherSession, other)).status, "disabled");
  assert.equal((await connect("status", null, null, unverified)).status, "disabled");
  assert.equal((await connect("rotate", hash, session)).connected, true);
  assert.equal((await resolve()).ownerId, owner);
  assert.equal(await resolve(oldOnlyHash), null);
  assert.deepEqual(await one("select public.grok_personal_unshared_ids($1,'tasks',$2::uuid[]) v",
    [owner, [personalTask, foreignTask, differentCreator, sharedTask, followedTask, householdTask, pendingAssignment, joinedTask]]), [personalTask]);
  for (const blockedTask of [foreignTask, differentCreator, sharedTask, followedTask, householdTask, pendingAssignment, joinedTask, hasChild, child, dependent, independent, recurringTask, thirdPartyResourceTask, thirdPartyStepTask, focusedTask]) {
    assert.equal(await queue("tasks", blockedTask), null);
  }
  assert.equal(await queue("notes", linkedNote), null);
  assert.equal(await queue("family", providerCalendar), null);
  assert.equal(await queue("school", family), null);
  assert.equal(await queue("medications", note), null);
  assert.equal(await queue("icloud", family), null);
  assert.deepEqual(await one("select public.grok_personal_unshared_ids($1,'personal_records',$2::uuid[]) v",
    [owner, [personalDocument, excludedWorkDocument, note]]), [personalDocument]);
  assert.equal(await queue("personal_records", personalDocument), null);
  assert.equal(await queue("tasks", personalTask, oldOnlyHash), null);
  for (const blockedCash of [company, foreignCash, generatedCash]) assert.equal(await queue("finance_transactions", blockedCash), null);
  const request = await queue("tasks", personalTask);
  assert.deepEqual(Object.keys(request).sort(), ["requestId","status"]);
  assert.equal(request.status, "pending");
  assert.deepEqual(await queue("tasks", personalTask), request);
  assert.equal((await inbox())[0].label, "Personal fixture");
  assert.deepEqual(await inbox(other), []);
  assert.equal(await one("select archived_at is null v from public.tasks where id=$1", [personalTask]), true);
  await assert.rejects(decision(request.requestId), /permission denied/i);
  await human(other, otherSession);
  assert.equal((await decision(request.requestId, true, "archive", otherSession)).status, "missing");
  assert.equal((await decision(request.requestId, true, "archive", otherSession, other)).status, "missing");
  await human(owner, session, 610);
  assert.equal((await decision(request.requestId)).status, "reauth");
  await human(owner, session, 0, true);
  assert.equal((await decision(request.requestId)).status, "missing");
  await human();
  assert.equal((await decision(request.requestId, false)).status, "invalid");
  assert.equal((await decision(request.requestId, true, "yes")).status, "invalid");
  assert.equal((await decision(request.requestId, true, "archive", otherSession)).status, "reauth");
  assert.equal((await decision(request.requestId)).status, "archived");
  assert.equal((await decision(request.requestId)).status, "archived");
  await service();
  assert.equal(await one("select archived_at is not null v from public.tasks where id=$1", [personalTask]), true);
  assert.equal(await one("select archived_at is null v from public.tasks where id=$1", [foreignTask]), true);
  assert.equal(await queue("tasks", personalTask), null);
  assert.deepEqual(await inbox(), []);
  const qNote = await queue("notes", note);
  const qSchool = await queue("school", school);
  const qFamily = await queue("family", family);
  const qCash = await queue("finance_transactions", cash);
  assert.match((await inbox()).find(row => row.id === qCash.requestId)?.label ?? "", /Own home finance.*HK\$400\.00/);
  await raw();
  await db.query("update public.operating_items set description='Changed after proposal' where id=$1", [school]);
  await human();
  assert.equal((await decision(qNote.requestId, false, null, null, owner, "dismiss")).status, "dismissed");
  assert.equal((await decision(qSchool.requestId)).status, "conflict");
  assert.equal((await decision(qFamily.requestId)).status, "archived");
  assert.equal((await decision(qCash.requestId)).status, "archived");
  await service();
  assert.equal(await one("select archived_at is not null v from public.transactions where id=$1", [cash]), true);
  assert.equal(await one("select archived_at is null v from public.transactions where id=$1", [company]), true);
  assert.equal(await one("select archived_at is null v from public.operating_items where id=$1", [school]), true);
  const toExpire = await queue("school", school);
  await raw();
  await db.query("update grok_personal_internal.archive_requests set expires_at=now()-interval '1 second' where id=$1", [toExpire.requestId]);
  await human();
  assert.equal((await decision(toExpire.requestId)).status, "expired");
  await service();
  const toDisable = await queue("school", school);
  assert.equal((await connect("rotate", newHash, session)).connected, true);
  assert.equal(await resolve(hash), null);
  assert.equal(await queue("school", school, hash), null);
  await human();
  assert.equal((await decision(toDisable.requestId)).status, "disabled");
  await service();
  assert.equal(await queue("school", school, newHash).then(x => x?.status), "pending");
  assert.equal((await connect("revoke")).connected, false);
  assert.equal(await resolve(newHash), null);
  assert.equal(await queue("school", school, newHash), null);
  await raw();
  assert.equal(await one("select count(*)::int v from grok_personal_internal.connection_events where owner_id=$1 and action='revoke'", [owner]), 1);
  assert.equal(await one("select count(*)::int v from grok_personal_internal.archive_requests where dataset='finance_transactions' and status='archived'"), 1);
  assert.equal(await one("select count(*)::int v from grok_personal_internal.archive_requests where row_to_json(archive_requests)::text like '%NONSAMPLE_BODY%'", []), 0);
  await service();
  assert.equal((await connect("rotate", hash, session)).connected, true);
  const stopped = await queue("school", school);
  await raw();
  await db.exec(await readFile(new URL("../../supabase/rollback-20261122032557-grok-personal-approved-archive.sql",import.meta.url),"utf8"));
  assert.equal(await one("select status v from grok_personal_internal.archive_requests where id=$1", [stopped.requestId]), "disabled");
  assert.equal(await one("select archived_at is not null v from public.transactions where id=$1", [cash]), true);
  assert.equal(await one("select archived_at is null v from public.operating_items where id=$1", [school]), true);
  await service();
  await assert.rejects(resolve(), /permission denied/i);
  await assert.rejects(queue("school", school), /permission denied/i);
  await human();
  await assert.rejects(decision(stopped.requestId), /permission denied/i);
  console.log("PASS Grok personal SQL: default off, verified Derek owner, no credential bypass, no foreign/shared/linked records, explicit recent human approval, reversible archive, replay, scope change, expiry and rollback");
} finally {
  await db.close();
}
