// Isolated PostgreSQL/PLpgSQL fixture; no live credentials or external requests.
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";

if (!process.env.PGLITE_MODULE) throw new Error("Set PGLITE_MODULE to local PGlite");
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
const db = new PGlite();
const dir = new URL("../../supabase/migrations/", import.meta.url);
const migrations = await readdir(dir);
const name = migrations.find(file => /_owner_workspace_agent_archive\.sql$/.test(file));
assert.ok(name);
const grok = await readFile(new URL("20261122032557_grok_personal_approved_archive.sql", dir), "utf8");
const migration = await readFile(new URL(name, dir), "utf8");
const rollback = await readFile(new URL("../../supabase/rollback-owner-workspace-agent-archive.sql", import.meta.url), "utf8");
const IDs = { actor: crypto.randomUUID(), other: crypto.randomUUID(), session: crypto.randomUUID(),
  otherSession: crypto.randomUUID(), ownerAgent: crypto.randomUUID(), otherAgent: crypto.randomUUID(),
  restricted: crypto.randomUUID(), task: crypto.randomUUID(), note: crypto.randomUUID(), shared: crypto.randomUUID(),
  otherTask: crypto.randomUUID(), linked: crypto.randomUUID(), child: crypto.randomUUID(), handle: crypto.randomUUID() };
const hash = "a".repeat(64), otherHash = "b".repeat(64), restrictedHash = "c".repeat(64);
const value = async (sql, args = []) => (await db.query(sql, args)).rows[0]?.value;
const queue = (kind, id, token = hash) => value("select public.request_owner_workspace_archive($1,$2,$3) value", [token, kind, id]);
const reviews = () => value("select public.owner_workspace_archive_reviews() value");
const decision = (id, session = IDs.session, ordered = true, confirm = "archive", action = "confirm") =>
  value("select public.decide_owner_workspace_archive($1,$2,$3,$4,$5) value", [id, action, session, ordered, confirm]);
const reset = () => db.exec("reset role");
const who = async (role, claims = {}) => {
  assert.ok(["anon", "service_role", "authenticated"].includes(role));
  await reset();
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify(claims)]);
  await db.exec(`set role ${role}`);
};
const human = (sub = IDs.actor, session = IDs.session, age = 0, isAnonymous = false) => who("authenticated", {
  sub, session_id: session, role: "authenticated", is_anonymous: isAnonymous,
  amr: [{ method: "oauth", timestamp: Math.floor(Date.now() / 1000) - age }]
});

try {
  await db.exec(`
    create role authenticated; create role anon; create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key,email_confirmed_at timestamptz);
    create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);
    create function auth.jwt() returns jsonb language sql stable as $$select current_setting('request.jwt.claims',true)::jsonb$$;
    create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
    create table public.user_profiles(user_id uuid primary key,active boolean,is_admin boolean);
    create table public.agent_access_grants(id uuid primary key, owner_id uuid not null, label text not null, token_hash text not null,
      expires_at timestamptz not null, revoked_at timestamptz, last_used_at timestamptz, owner_workspace boolean not null, unique(id,owner_id));
    create table public.agent_access_events(grant_id uuid,owner_id uuid,action text,resource_type text,resource_id uuid,created_at timestamptz default now());
    create table public.tasks(id uuid primary key,owner_id uuid not null,created_by_id uuid not null,title text not null,
      visibility text not null default 'private',household_id uuid,assignee_id uuid,needs_decision_from_id uuid,
      deleted_at timestamptz,archived_at timestamptz,parent_task_id uuid,project_id uuid,recurrence_rule_id uuid);
    create table public.operating_items(id uuid primary key,owner_id uuid not null,created_by_id uuid not null,
      item_type text not null,title text not null,visibility text not null default 'private',household_id uuid,assignee_id uuid,
      archived_at timestamptz,calendar_target text not null default 'none');
    create table public.task_dependencies(task_id uuid,depends_on_task_id uuid);
    create table public.task_recurrence_rules(seed_task_id uuid);
    create table public.task_resources(task_id uuid,owner_id uuid,linked_item_id uuid);
    create table public.task_handoff_notes(task_id uuid,author_id uuid);
    create table public.task_checkpoints(task_id uuid,author_id uuid);
    create table public.task_steps(task_id uuid,created_by_id uuid,updated_by_id uuid);
    create table public.focus_sessions(task_id uuid,status text);
    create table public.calendar_event_links(operating_item_id uuid);
    create table public.share_records(resource_type text,resource_id uuid,shared_with_user_id uuid,revoked_at timestamptz,expires_at timestamptz);
    create table public.joint_memberships(resource_type text,resource_id uuid,user_id uuid,removed_at timestamptz);
    create table public.assignments(resource_type text,resource_id uuid,assigned_to_id uuid,assigned_by_id uuid,status text);
    create table public.task_followers(task_id uuid,follower_id uuid);
    create table public.activity_logs(resource_type text,resource_id uuid,actor_id uuid,action text,summary text);
    grant select,update on public.agent_access_grants to service_role;
    grant select,insert on public.agent_access_events to service_role;
    create schema grok_personal_internal;
    create function archive_requires_native_actor() returns trigger language plpgsql as $$
      begin
        if new.archived_at is distinct from old.archived_at and auth.uid() is distinct from old.owner_id
        then raise exception 'AUTH_REQUIRED'; end if;
        return new;
      end$$;
    create trigger task_archive_native_actor before update of archived_at on public.tasks
      for each row execute function archive_requires_native_actor();
    create trigger note_archive_native_actor before update of archived_at on public.operating_items
      for each row execute function archive_requires_native_actor();
  `);
  for (const fn of ["active_session", "is_private"]) {
    // Same provider-independent helpers installed by the real existing migration.
    const definition = grok.match(new RegExp(`create function grok_personal_internal\\.${fn}\\([\\s\\S]*?\\$\\$;`))?.[0];
    assert.ok(definition);
    await db.exec(definition);
  }
  await db.exec(migration);
  await db.query("insert into auth.users values ($1,now()),($2,now())", [IDs.actor, IDs.other]);
  await db.query("insert into auth.sessions values ($1,$2,null),($3,$4,null)", [IDs.session, IDs.actor, IDs.otherSession, IDs.other]);
  await db.query("insert into public.user_profiles values ($1,true,true),($2,true,true)", [IDs.actor, IDs.other]);
  for (const [id, owner, token, enhanced] of [
    [IDs.ownerAgent, IDs.actor, hash, true],
    [IDs.otherAgent, IDs.other, otherHash, true],
    [IDs.restricted, IDs.actor, restrictedHash, false]
  ]) {
    await db.query("insert into public.agent_access_grants values ($1,$2,'Fixture agent',$3,now()+interval '1 day',null,null,$4)",
      [id, owner, token, enhanced]);
  }
  for (const [id, owner] of [[IDs.task, IDs.actor], [IDs.shared, IDs.actor], [IDs.otherTask, IDs.other], [IDs.linked, IDs.actor], [IDs.child, IDs.actor]]) {
    await db.query("insert into public.tasks(id,owner_id,created_by_id,title) values ($1,$2,$2,'Original task title')", [id, owner]);
  }
  await db.query("insert into public.operating_items(id,owner_id,created_by_id,item_type,title) values ($1,$2,$2,'note','Original note'),($3,$2,$2,'event','Not a note')", [IDs.note, IDs.actor, IDs.handle]);
  await db.query("insert into public.share_records(resource_type,resource_id,shared_with_user_id) values ('task',$1,$2)", [IDs.shared, IDs.other]);
  await db.query("update public.tasks set parent_task_id=$1 where id=$2", [IDs.linked, IDs.child]);

  await who("anon");
  await assert.rejects(reviews, /permission denied/);
  await who("service_role");
  await assert.rejects(reviews, /permission denied/);
  await assert.rejects(() => decision(crypto.randomUUID()), /permission denied/);
  await assert.rejects(() => queue("task", IDs.task, restrictedHash), /AGENT_FORBIDDEN/);
  await assert.rejects(() => queue("settings", IDs.task), /AGENT_INVALID/);
  for (const [kind, id] of [["task", IDs.otherTask], ["task", IDs.shared], ["task", IDs.linked], ["task", IDs.child], ["note", IDs.handle]]) {
    await assert.rejects(() => queue(kind, id), /AGENT_NOT_FOUND/);
  }
  const q = await queue("task", IDs.task);
  assert.equal(q.status, "pending");
  assert.deepEqual(await queue("task", IDs.task), q);
  const originalNote = await queue("note", IDs.note);
  await reset();
  assert.equal(await value("select archived_at value from public.tasks where id=$1", [IDs.task]), null);
  assert.equal(await value("select count(*)::int value from public.agent_access_events where action='request_archive'"), 2);
  assert.doesNotMatch(JSON.stringify((await db.query("select * from owner_workspace_archive_internal.requests")).rows), /Original/);
  await human(IDs.other, IDs.otherSession);
  assert.deepEqual(await reviews(), []);
  assert.equal((await decision(q.requestId, IDs.otherSession)).status, "missing");
  await human(IDs.actor, IDs.session, 601);
  assert.equal((await decision(q.requestId)).status, "reauth");
  await human(IDs.actor, IDs.otherSession);
  assert.equal((await decision(q.requestId, IDs.otherSession)).status, "reauth");
  await human(IDs.actor, IDs.session, 0, true);
  assert.equal((await decision(q.requestId)).status, "missing");
  await human();
  await assert.rejects(() => queue("task", IDs.task), /permission denied/);
  await assert.rejects(() => value("select count(*) value from owner_workspace_archive_internal.requests"), /permission denied/);
  assert.equal((await decision(q.requestId, IDs.session, false)).status, "invalid");
  assert.equal((await decision(q.requestId, IDs.session, true, "yes")).status, "invalid");
  assert.deepEqual((await reviews()).map(row => row.kind).sort(), ["note", "task"]);
  assert.equal((await decision(q.requestId)).status, "archived");
  assert.equal((await decision(q.requestId)).status, "archived");
  await reset();
  assert.ok(await value("select archived_at value from public.tasks where id=$1", [IDs.task]));
  assert.equal(await value("select count(*)::int value from public.activity_logs where action='agent_archive_confirmed'"), 1);
  await db.query("update public.operating_items set title='Changed' where id=$1", [IDs.note]);
  await human();
  assert.deepEqual(await reviews(), []);
  assert.equal((await decision(originalNote.requestId)).status, "conflict");
  await who("service_role");
  const secondNote = await queue("note", IDs.note);
  await reset();
  await db.query("update public.agent_access_grants set revoked_at=now() where id=$1", [IDs.ownerAgent]);
  await human();
  assert.deepEqual(await reviews(), []);
  assert.equal((await decision(secondNote.requestId)).status, "disabled");
  await reset();
  assert.equal(await value("select archived_at value from public.operating_items where id=$1", [IDs.note]), null);
  await db.exec(rollback);
  assert.equal(await value("select count(*)::int value from owner_workspace_archive_internal.requests"), 3);
  await human();
  await assert.rejects(reviews, /permission denied/);
  console.log("Owner Agent archive: owner/session/AMR gate, two-step, revocation, conflict, audit and rollback PASS");
} finally {
  await db.close();
}
