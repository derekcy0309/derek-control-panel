// Real isolated Postgres: no network, production credentials, or account data.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

if (!process.env.PGLITE_MODULE) throw new Error("Set PGLITE_MODULE to a local PGlite installation");
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
const db = new PGlite();
const migration = name => readFile(new URL("../../supabase/" + name, import.meta.url), "utf8");
const previous = await migration("migrations/20260804100000_three_role_daily_workflow.sql");
const permissionGuard = previous.slice(previous.indexOf("create or replace function private.enforce_task_update_permission()"), previous.indexOf("alter table public.notification_preferences"));
const forward = await migration("migrations/20261125090825_dayline_task_priority_grade.sql");
const rollback = await migration("rollback-20261125090825-dayline-task-priority-grade.sql");
const user = n => "11111111-1111-4111-8111-11111111111" + n;
const task = n => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa" + String(n).padStart(4, "0");
const tag = n => "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbb" + String(n).padStart(4, "0");
const rule = n => "cccccccc-cccc-4ccc-8ccc-cccccccc" + String(n).padStart(4, "0");
const switchRole = async (name, id = "") => {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)", [id, JSON.stringify({ sub: id, role: name })]);
  await db.exec("set role " + name);
};
const row = async n => (await db.query("select id, title, due_date, planned_date, requested_priority, priority_grade, priority_selected_grade, priority_escalation_date from public.tasks where id=$1", [task(n)])).rows[0];
const grade = async n => (await row(n))?.priority_grade;
const restore = async tasks => (await db.query("select public.restore_backup_v4($1) as result", [JSON.stringify({ ownerId: user(1), version: 1, data: { tasks } })])).rows[0].result;

try {
  await db.exec(`
    create role authenticated;
    create role anon;
    create role service_role bypassrls;
    create schema private;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
    $$;
    grant usage on schema auth,public to authenticated,anon,service_role;
    create table public.tasks (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null, owner_id uuid not null, created_by_id uuid,
      title text not null, requested_priority integer not null default 3,
      due_date date, planned_date date, status text not null default 'not_started',
      deleted_at timestamptz, archived_at timestamptz,
      recurrence_rule_id uuid,
      area text default 'personal', visibility text default 'private', household_id uuid,
      assignee_id uuid, needs_decision_from_id uuid, decision_resolved_at timestamptz, decision_resolved_by_id uuid
    );
    create table public.share_records(resource_type text,resource_id uuid,shared_with_user_id uuid,revoked_at timestamptz,
      expires_at timestamptz,created_at timestamptz default now(),permission text);
    create table public.assignments(resource_type text,resource_id uuid,assigned_to_id uuid,assigned_by_id uuid,status text,created_at timestamptz);
    create table public.household_members(household_id uuid,user_id uuid,status text);
    create table public.joint_memberships(resource_type text,resource_id uuid,user_id uuid,accepted_at timestamptz,removed_at timestamptz);
    create table public.personal_task_tags(id uuid primary key,user_id uuid,name text,legacy_key text,deleted_at timestamptz);
    create table public.task_tag_assignments(user_id uuid,task_id uuid,tag_id uuid);
    create table public.task_recurrence_generations(
      id uuid primary key default gen_random_uuid(),recurrence_rule_id uuid,source_task_id uuid,
      generated_task_id uuid,scheduled_for date,generated_at timestamptz default now()
    );
    grant select on public.share_records to authenticated;
    grant select, insert, update on public.tasks to authenticated,service_role;
    alter table public.tasks enable row level security;
    create policy read_task on public.tasks for select to authenticated
      using(owner_id=(select auth.uid()) or exists(select 1 from public.share_records s where s.resource_id=id and s.shared_with_user_id=(select auth.uid())));
    create policy update_task on public.tasks for update to authenticated
      using(owner_id=(select auth.uid()) or exists(select 1 from public.share_records s where s.resource_id=id and s.shared_with_user_id=(select auth.uid())));
    create policy insert_task on public.tasks for insert to authenticated with check (owner_id=(select auth.uid()));
    -- Stub the established generator's exact claim -> insert -> link order.
    -- Its SECURITY DEFINER context matters even when a shared editor completes.
    create function private.generate_next_recurring_task() returns trigger language plpgsql security definer set search_path='' as $$
    declare
      gen uuid; successor uuid;
      next_day date := coalesce(new.due_date,new.planned_date) + 1;
    begin
      if new.status='done' and old.status<>'done' and new.recurrence_rule_id is not null then
        insert into public.task_recurrence_generations(recurrence_rule_id,source_task_id,scheduled_for)
          values(new.recurrence_rule_id,new.id,next_day) returning id into gen;
        insert into public.tasks(user_id,owner_id,created_by_id,title,due_date,planned_date,recurrence_rule_id)
          values(new.owner_id,new.owner_id,new.owner_id,new.title,
            case when new.due_date is not null then next_day end,
            case when new.due_date is null then next_day end,new.recurrence_rule_id) returning id into successor;
        update public.task_recurrence_generations set generated_task_id=successor where id=gen;
      end if;
      return new;
    end;
    $$;
    create trigger generate_next_recurring_task_trigger after update of status on public.tasks
      for each row execute function private.generate_next_recurring_task();
    -- Existing add-only restore skeleton. Preserve its ownership/ON CONFLICT
    -- contract to test transaction provenance without unrelated backup tables.
    create function public.restore_backup_v3(p_backup jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
    declare
      inserted_count integer;
    begin
      insert into public.tasks(id,owner_id,user_id,title,due_date)
      select (t->>'id')::uuid,(select auth.uid()),(select auth.uid()),t->>'title',(t->>'due_date')::date
      from jsonb_array_elements(p_backup->'data'->'tasks') t on conflict do nothing;
      get diagnostics inserted_count = row_count;
      return jsonb_build_object('tasks',inserted_count);
    end;
    $$;
    revoke all on function public.restore_backup_v3(jsonb) from public;
    grant execute on function public.restore_backup_v3(jsonb) to authenticated;
  `);
  await db.exec(permissionGuard);
  await db.exec("create trigger enforce_task_update_permission_trigger before update on public.tasks for each row execute function private.enforce_task_update_permission()");
  await db.query(`
    insert into public.personal_task_tags values
      ($1,$5,'Old renamed semi','priority_p3',null),
      ($2,$5,'non urgent',null,null),
      ($3,$5,'P2',null,null),
      ($4,$6,'P1','priority_p1',null),
      ($7,$5,'P1','priority_p1',now())
  `, [tag(1),tag(2),tag(3),tag(4),user(1),user(2),tag(5)]);
  const offsets = [14, 7, 7, -2, 7, 7, null, 7, 7, "month", "outside"];
  for (let n = 0; n < offsets.length; n++) {
    const offset = typeof offsets[n] === "number" ? offsets[n] : offsets[n] === "month" ? 0 : offsets[n] === "outside" ? 1 : null;
    const today = "(now() at time zone 'Asia/Hong_Kong')::date";
    const due = offsets[n] === "month" || offsets[n] === "outside"
      ? "(" + today + " + interval '1 month')::date + $4::integer"
      : today + " + $4::integer";
    await db.query(`
      insert into public.tasks(id,owner_id,user_id,title,due_date,archived_at,deleted_at,status)
      values($1,$2,$2,$3,${due},case when $5::bool then now() end,case when $6::bool then now() end,$7)
    `, [task(n),user(1),"Fixture " + n,offset,n === 4,n === 8,n === 5 ? "done" : "not_started"]);
    if (n !== 7) await db.query("insert into public.task_tag_assignments values($1,$2,$3)", [user(1),task(n),tag(n === 1 || n >= 9 ? 2 : n === 2 ? 3 : 1)]);
  }
  await db.query("insert into public.task_tag_assignments values($1,$2,$3),($4,$2,$5)", [user(1),task(7),tag(5),user(2),tag(4)]);
  for (const n of [0,7]) await db.query("insert into public.share_records(resource_type,resource_id,shared_with_user_id,permission) values('task',$1,$2,'edit')", [task(n),user(2)]);
  const pre = (await db.query("select * from public.tasks order by id")).rows;
  const originalLinks = (await db.query("select * from public.task_tag_assignments order by task_id,user_id")).rows;
  await db.exec(forward);
  const after = (await db.query("select * from public.tasks order by id")).rows
    .map(({priority_grade,priority_selected_grade,priority_escalation_date,...rest}) => rest);
  assert.deepEqual(after,pre,"migration doesn't change legacy due date/status or visibility");
  assert.deepEqual((await db.query("select * from public.task_tag_assignments order by task_id,user_id")).rows,originalLinks);
  assert.deepEqual(await Promise.all(offsets.map((_,n) => grade(n))),[3,4,2,3,3,3,3,null,null,4,4]);
  assert.deepEqual((await row(0)).priority_escalation_date,(await row(0)).due_date);

  await switchRole("authenticated",user(2));
  assert.ok(await row(0),"editor can read the shared task");
  await assert.rejects(db.query("update public.tasks set priority_grade=4,priority_selected_grade=4 where id=$1",[task(0)]),/TASK_PRIORITY_OWNER_REQUIRED/);
  await assert.rejects(db.query("select public.promote_dayline_task_priorities()"),/permission denied/);
  await db.query("update public.tasks set due_date=due_date+40,requested_priority=5 where id=$1",[task(0)]);
  assert.equal((await row(0)).requested_priority,3,"legacy priority-only changes cannot overwrite a managed grade");
  assert.equal(await row(1),undefined,"unshared owner tasks remain private");
  await assert.rejects(restore([{id:task(18),title:"wrong owner",priority_grade:2,priority_selected_grade:1}]),/BACKUP_INVALID/);
  await db.query("insert into public.tasks(id,user_id,owner_id,title,priority_grade,priority_selected_grade) values($1,$2,$2,'Other account',2,2)",[task(17),user(2)]);

  await switchRole("service_role",user(1));
  await assert.rejects(db.query("update public.tasks set priority_grade=4,priority_selected_grade=4 where id=$1",[task(0)]),/TASK_PRIORITY_OWNER_REQUIRED/);
  const promoted = (await db.query("select public.promote_dayline_task_priorities() n")).rows[0].n;
  assert.equal(promoted,5);
  assert.deepEqual(await Promise.all(offsets.map((_,n) => grade(n))),[2,1,1,1,3,3,3,null,null,3,4]);
  assert.equal((await db.query("select public.promote_dayline_task_priorities() n")).rows[0].n,0);
  assert.equal((await db.query("select auth.uid() id")).rows[0].id,user(1),"cron restores incoming request context");

  await switchRole("authenticated",user(1));
  assert.equal((await row(0)).priority_selected_grade,3,"automatic promotion leaves the manually selected tier");
  assert.notDeepEqual((await row(0)).due_date,(await row(0)).priority_escalation_date,"actual deadline was postponed independently");
  await db.query("update public.tasks set priority_grade=4,priority_selected_grade=4,priority_escalation_date=(now() at time zone 'Asia/Hong_Kong')::date+42 where id=$1",[task(0)]);
  assert.equal(await grade(0),4,"owner can explicitly downgrade");
  assert.equal((await row(0)).requested_priority,5);

  for (const n of [12,13]) {
    await db.query(`
      insert into public.tasks(id,user_id,owner_id,created_by_id,title,due_date,planned_date,
        recurrence_rule_id,priority_grade,priority_selected_grade,priority_escalation_date)
      values($1,$2,$2,$2,$3,case when $5 then null else date '2026-12-31' end,
        case when $5 then date '2026-12-31' else null end,$4,1,4,case when $5 then null else date '2026-12-01' end)
    `,[task(n),user(1),"Recurring fixture " + n,rule(n),n === 13]);
    await db.query("update public.tasks set status='done' where id=$1",[task(n)]);
    const successor = (await db.query("select priority_grade,priority_selected_grade,priority_escalation_date,due_date,planned_date from public.tasks where recurrence_rule_id=$1 and id<>$2",[rule(n),task(n)])).rows[0];
    assert.equal(successor.priority_grade,4);
    assert.equal(successor.priority_selected_grade,4);
    assert.deepEqual(successor.priority_escalation_date,successor.due_date);
    assert.equal(successor.due_date === null,n === 13);
    assert.equal(successor.planned_date !== null,n === 13);
  }

  const restoreFirst = await restore([
    { id: task(18), title: "new restore", due_date: "2027-01-06", priority_grade: 1, priority_selected_grade: 4, priority_escalation_date: "2026-12-19" },
    { id: task(0), title: "never overwrite", priority_grade: 1, priority_selected_grade: 1 },
    { id: task(19), title: "legacy backup" },
    { id: task(17), title: "other user's task", priority_grade: 1, priority_selected_grade: 1 }
  ]);
  assert.deepEqual(restoreFirst,{tasks:2,taskPriorities:1});
  assert.equal(await grade(18),1);
  assert.equal((await row(18)).priority_selected_grade,4);
  assert.equal(await grade(19),null);
  assert.equal(await grade(0),4,"restore cannot replace existing managed priority");
  assert.equal(await row(17),undefined,"restore cannot read another account or claim a colliding ID");
  assert.deepEqual(await restore([{id:task(18),title:"never overwrite",priority_grade:4,priority_selected_grade:4}]),{tasks:0,taskPriorities:0});
  for (const fields of [
    {priority_grade:3,priority_selected_grade:2},
    {priority_grade:1,priority_selected_grade:1,priority_escalation_date:"2026-02-31"},
    {priority_grade:1,priority_selected_grade:1,priority_escalation_date:"infinity"},
    {priority_escalation_date:"2026-12-31"}
  ]) await assert.rejects(restore([{id:task(20),title:"rejected",...fields}]),/BACKUP_INVALID/);
  assert.equal(await row(20),undefined,"a rejected graded backup leaves no partial task");
  await switchRole("authenticated",user(2));
  assert.equal(await grade(17),2,"a colliding backup leaves the other account's priority untouched");

  await db.exec("reset role");
  await db.exec(rollback);
  await switchRole("authenticated",user(1));
  await assert.rejects(db.query("select public.promote_dayline_task_priorities()"),/does not exist/);
  await db.query("update public.tasks set requested_priority=3 where id=$1",[task(18)]);
  assert.equal((await row(18)).requested_priority,3,"rollback restores legacy field edits");
  assert.equal(await grade(18),1,"rollback retains grade and anchor values");
  await assert.rejects(db.query("update public.tasks set priority_grade=2 where id=$1",[task(18)]),/TASK_PRIORITY_UNAVAILABLE/);
  console.log("PASS priority-grade migration: owner-only independent grades, owner-tag backfill, inclusive HK monotone cron, recurrence, add-only backup, and non-destructive rollback");
} finally {
  await db.close();
}
