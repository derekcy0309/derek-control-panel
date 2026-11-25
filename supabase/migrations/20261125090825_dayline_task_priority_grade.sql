-- Task grade and explicit escalation anchor are independent of the editable
-- due_date. NULL keeps old/ungraded workflows and deadline-free routines valid.
alter table public.tasks
  add column if not exists priority_grade smallint,
  add column if not exists priority_selected_grade smallint,
  add column if not exists priority_escalation_date date;
alter table public.tasks drop constraint if exists dayline_task_priority_grade_check;
alter table public.tasks add constraint dayline_task_priority_grade_check check (
  (priority_grade is null and priority_selected_grade is null and priority_escalation_date is null)
  or (
    priority_grade is not null and priority_selected_grade is not null
    and priority_grade between 1 and 4 and priority_selected_grade between 1 and 4
    and priority_grade <= priority_selected_grade
    and (priority_escalation_date is null or priority_escalation_date between date '0001-01-01' and date '9999-12-31')
  )
);

-- Copy explicit existing owner tags once, without renaming user tags, changing
-- due dates, or copying a second viewer's private labels to the shared task.
-- The existing task update trigger expects auth.uid(), even for server jobs.
drop trigger if exists dayline_task_priority_guard_trigger on public.tasks;
do $$
declare
  owner_group record;
  prior_sub text := current_setting('request.jwt.claim.sub', true);
  prior_claims text := current_setting('request.jwt.claims', true);
begin
  for owner_group in
    with owners_grades as (
      select task.owner_id, task.id, min(case
        when tag.legacy_key = 'priority_p1' then 1
        when tag.legacy_key = 'priority_p2' then 2
        when tag.legacy_key = 'priority_p3' then 3
        when tag.legacy_key = 'priority_p4' then 4
        when lower(btrim(tag.name)) in ('p1','first priority') then 1
        when lower(btrim(tag.name)) in ('p2','urgent') then 2
        when lower(btrim(tag.name)) in ('p3','semi urgent') then 3
        when lower(btrim(tag.name)) in ('p4','non urgent') then 4
      end) as grade
      from public.tasks task
      join public.task_tag_assignments link on link.task_id = task.id and link.user_id = task.owner_id
      join public.personal_task_tags tag on tag.id = link.tag_id and tag.user_id = task.owner_id
        and tag.deleted_at is null
      where task.deleted_at is null and task.priority_grade is null
      group by task.owner_id, task.id
    )
    select owner_id, jsonb_agg(jsonb_build_object('id', id, 'grade', grade)) as rows
    from owners_grades where grade is not null group by owner_id
  loop
    perform set_config('request.jwt.claim.sub', owner_group.owner_id::text, true);
    perform set_config('request.jwt.claims', jsonb_build_object('sub', owner_group.owner_id, 'role', 'authenticated')::text, true);
    update public.tasks task
    set priority_grade = existing.grade,
      priority_selected_grade = existing.grade,
      priority_escalation_date = case when task.due_date between date '0001-01-01' and date '9999-12-31' then task.due_date end
    from jsonb_to_recordset(owner_group.rows) existing(id uuid, grade smallint)
    where task.id = existing.id and task.owner_id = owner_group.owner_id
      and task.priority_grade is null and task.deleted_at is null;
  end loop;
  perform set_config('request.jwt.claim.sub', coalesce(prior_sub, ''), true);
  perform set_config('request.jwt.claims', coalesce(prior_claims, ''), true);
end;
$$;

create or replace function private.guard_dayline_task_priority()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  inherited_grade smallint;
begin
  if tg_op = 'INSERT' then
    -- The existing definer recurrence generator first claims a generation row
    -- and then inserts that occurrence. Match the exact pending owner/rule/day;
    -- do not copy the previous run's automatically promoted level or anchor.
    if new.recurrence_rule_id is not null and new.priority_grade is null
      and pg_trigger_depth() > 1
      and current_user not in ('anon', 'authenticated', 'service_role')
      and current_user = (
        select pg_get_userbyid(proc.proowner)
        from pg_proc proc join pg_namespace namespace on namespace.oid = proc.pronamespace
        where namespace.nspname = 'private' and proc.proname = 'generate_next_recurring_task'
          and proc.pronargs = 0
      )
    then
      select source.priority_selected_grade into inherited_grade
      from public.task_recurrence_generations gen
      join public.tasks source on source.id = gen.source_task_id
        and source.owner_id = new.owner_id and source.recurrence_rule_id = new.recurrence_rule_id
        and source.status = 'done' and source.deleted_at is null
      where gen.recurrence_rule_id = new.recurrence_rule_id
        and gen.generated_task_id is null
        and gen.scheduled_for = coalesce(new.due_date, new.planned_date)
      order by gen.generated_at desc, gen.id desc
      limit 1;
      if inherited_grade is not null then
        new.priority_grade := inherited_grade;
        new.priority_selected_grade := inherited_grade;
        new.priority_escalation_date := new.due_date;
      end if;
    end if;
    if new.priority_grade is null and new.priority_selected_grade is null and new.priority_escalation_date is null then
      return new;
    end if;
    if inherited_grade is null and not (
      current_user = 'authenticated' and actor is not null
      and actor = coalesce(new.owner_id, new.user_id, actor)
    ) then
      raise exception 'TASK_PRIORITY_OWNER_REQUIRED' using errcode = '42501';
    end if;
  elsif (new.priority_grade, new.priority_selected_grade, new.priority_escalation_date)
      is not distinct from (old.priority_grade, old.priority_selected_grade, old.priority_escalation_date) then
    -- Older API/agent writes may still send the legacy number. They cannot
    -- silently change the grade or even its legacy compatibility value.
    if old.priority_grade is not null then new.requested_priority := old.requested_priority; end if;
    return new;
  elsif not (
    (current_user = 'authenticated' and actor is not null and actor = old.owner_id)
    or (
      current_user = 'service_role' and actor is not null and actor = old.owner_id
      and old.priority_grade is not null and new.priority_grade is not null
      and new.priority_grade < old.priority_grade
      and new.priority_selected_grade = old.priority_selected_grade
      and new.priority_escalation_date is not distinct from old.priority_escalation_date
    )
  ) then
    raise exception 'TASK_PRIORITY_OWNER_REQUIRED' using errcode = '42501';
  end if;

  if new.priority_grade is not null then
    new.requested_priority := case new.priority_grade when 1 then 1 when 2 then 3 when 3 then 4 else 5 end;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_dayline_task_priority() from public, anon, authenticated, service_role;
create trigger dayline_task_priority_guard_trigger
before insert or update on public.tasks for each row
execute function private.guard_dayline_task_priority();

create index if not exists tasks_dayline_priority_escalation_idx
on public.tasks (priority_escalation_date, owner_id)
where priority_grade > 1 and priority_escalation_date is not null
  and deleted_at is null and archived_at is null and status not in ('done','cancelled');

create or replace function public.promote_dayline_task_priorities()
returns integer language plpgsql security invoker set search_path = '' as $$
declare
  hk_today date := (statement_timestamp() at time zone 'Asia/Hong_Kong')::date;
  task_owner uuid;
  affected integer;
  total integer := 0;
  prior_sub text := current_setting('request.jwt.claim.sub', true);
  prior_claims text := current_setting('request.jwt.claims', true);
begin
  if current_user <> 'service_role' then
    raise exception 'TASK_PRIORITY_SERVICE_REQUIRED' using errcode = '42501';
  end if;
  for task_owner in
    select distinct t.owner_id from public.tasks t
    where t.owner_id is not null and t.priority_grade > 1 and t.priority_escalation_date is not null
      and t.deleted_at is null and t.archived_at is null and t.status not in ('done','cancelled')
      and (t.priority_escalation_date <= hk_today + 7
        or (t.priority_grade > 2 and t.priority_escalation_date <= hk_today + 14)
        or (t.priority_grade > 3 and t.priority_escalation_date <= (hk_today + interval '1 month')::date))
    order by t.owner_id
  loop
    -- This matches the existing trusted service RPC pattern: only the scoped
    -- task owner is set, for this fixed statement, never a human SQL role.
    perform set_config('request.jwt.claim.sub', task_owner::text, true);
    perform set_config('request.jwt.claims', jsonb_build_object('sub',task_owner,'role','service_role')::text,true);
    update public.tasks t set priority_grade =
      case when t.priority_escalation_date <= hk_today + 7 then 1
        when t.priority_escalation_date <= hk_today + 14 then 2 else 3 end
    where t.owner_id = task_owner and t.priority_grade > 1 and t.priority_escalation_date is not null
      and t.deleted_at is null and t.archived_at is null and t.status not in ('done','cancelled')
      and (t.priority_escalation_date <= hk_today + 7
        or (t.priority_grade > 2 and t.priority_escalation_date <= hk_today + 14)
        or (t.priority_grade > 3 and t.priority_escalation_date <= (hk_today + interval '1 month')::date));
    get diagnostics affected = row_count;
    total := total + affected;
  end loop;
  perform set_config('request.jwt.claim.sub', coalesce(prior_sub,''), true);
  perform set_config('request.jwt.claims', coalesce(prior_claims,''), true);
  return total;
end;
$$;
revoke all on function public.promote_dayline_task_priorities() from public, anon, authenticated;
grant execute on function public.promote_dayline_task_priorities() to service_role;

-- Keep the same file format and preserve optional priority fields only on rows
-- inserted by this restore. Neither an old backup nor a concurrent insert may
-- overwrite the grade on an existing task.
create or replace function public.restore_backup_v4(p_backup jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  tasks_json jsonb := coalesce(p_backup -> 'data' -> 'tasks', '[]'::jsonb);
  absent_graded_ids uuid[];
  restored_counts jsonb;
  priority_count integer;
begin
  if actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if jsonb_typeof(tasks_json) is distinct from 'array'
    or jsonb_typeof(p_backup) is distinct from 'object'
    or p_backup ->> 'ownerId' is distinct from actor::text then
    raise exception 'BACKUP_INVALID';
  end if;
  if jsonb_array_length(tasks_json) > 10000 then raise exception 'BACKUP_INVALID'; end if;
  if exists (
    select 1 from jsonb_array_elements(tasks_json) entry
    where jsonb_typeof(entry) is distinct from 'object'
      or (
        (entry->>'priority_grade' is not null or entry->>'priority_selected_grade' is not null or entry->>'priority_escalation_date' is not null)
        and (
          jsonb_typeof(entry->'priority_grade') is distinct from 'number'
          or jsonb_typeof(entry->'priority_selected_grade') is distinct from 'number'
          or coalesce(entry->>'priority_grade','') not in ('1','2','3','4')
          or coalesce(entry->>'priority_selected_grade','') not in ('1','2','3','4')
          or entry->>'priority_grade' > entry->>'priority_selected_grade'
          or entry->>'id' is null
          or (entry->>'priority_escalation_date' is not null and (
            jsonb_typeof(entry->'priority_escalation_date') is distinct from 'string'
            or entry->>'priority_escalation_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
          ))
        )
      )
  ) then raise exception 'BACKUP_INVALID'; end if;
  begin
    if exists (
      select 1 from jsonb_to_recordset(tasks_json) fields(id uuid, priority_grade smallint, priority_escalation_date date)
      group by fields.id having count(*) > 1 and count(fields.priority_grade) > 0
    ) then raise exception 'BACKUP_INVALID'; end if;
    select coalesce(array_agg(fields.id), '{}'::uuid[]) into absent_graded_ids
    from jsonb_to_recordset(tasks_json) fields(id uuid, priority_grade smallint, priority_escalation_date date)
    where fields.priority_grade is not null and not exists (
      select 1 from public.tasks t where t.id = fields.id
    );
  exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range
    then raise exception 'BACKUP_INVALID';
  end;

  restored_counts := public.restore_backup_v3(p_backup);
  update public.tasks t
  set priority_grade = fields.priority_grade,
    priority_selected_grade = fields.priority_selected_grade,
    priority_escalation_date = fields.priority_escalation_date
  from jsonb_to_recordset(tasks_json)
    fields(id uuid, priority_grade smallint, priority_selected_grade smallint, priority_escalation_date date)
  where t.id = fields.id and t.id = any(absent_graded_ids) and t.owner_id = actor
    and t.priority_grade is null and t.xmin = pg_current_xact_id()::xid;
  get diagnostics priority_count = row_count;
  return restored_counts || jsonb_build_object('taskPriorities', priority_count);
end;
$$;
revoke all on function public.restore_backup_v4(jsonb) from public, anon, service_role;
grant execute on function public.restore_backup_v4(jsonb) to authenticated;
