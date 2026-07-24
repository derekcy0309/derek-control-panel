-- Recurring task routines
--
-- One active recurrence creates at most one successor, only after the current
-- instance is marked done. It never pre-generates a backlog of future tasks.

create table if not exists public.task_recurrence_rules (
  id uuid primary key default gen_random_uuid(),
  seed_task_id uuid not null unique references public.tasks(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete restrict,
  created_by_id uuid not null references auth.users(id) on delete restrict,
  frequency text not null check (frequency in ('daily', 'weekly', 'monthly', 'custom')),
  weekdays smallint[] not null default '{}',
  custom_interval_days integer,
  business_days_only boolean not null default false,
  night_shift_pattern boolean not null default false,
  night_shift_on_days smallint,
  night_shift_off_days smallint,
  cycle_anchor_date date,
  template jsonb not null,
  is_active boolean not null default true,
  last_generated_at timestamptz,
  last_generated_for date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Array containment keeps this a declarative CHECK constraint (Postgres
  -- CHECK expressions cannot contain a subquery) while accepting an empty
  -- array for non-weekly routines.
  constraint recurrence_weekday_values check (
    weekdays <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]
  ),
  constraint recurrence_weekdays_required check (frequency <> 'weekly' or cardinality(weekdays) > 0),
  constraint recurrence_custom_interval check (
    (frequency = 'custom' and custom_interval_days between 1 and 3650)
    or (frequency <> 'custom' and custom_interval_days is null)
  ),
  constraint recurrence_night_shift_cycle check (
    (not night_shift_pattern and night_shift_on_days is null and night_shift_off_days is null)
    or (night_shift_pattern and night_shift_on_days between 1 and 365 and night_shift_off_days between 0 and 365)
  )
);

create table if not exists public.task_recurrence_generations (
  id uuid primary key default gen_random_uuid(),
  recurrence_rule_id uuid not null references public.task_recurrence_rules(id) on delete cascade,
  source_task_id uuid not null references public.tasks(id) on delete cascade,
  generated_task_id uuid references public.tasks(id) on delete set null,
  scheduled_for date not null,
  generated_at timestamptz not null default now(),
  constraint task_recurrence_generations_source_unique unique (recurrence_rule_id, source_task_id)
);

alter table public.tasks
  add column if not exists recurrence_rule_id uuid references public.task_recurrence_rules(id) on delete set null;

create index if not exists task_recurrence_rules_owner_active_idx
  on public.task_recurrence_rules(owner_id, is_active, updated_at desc);
create index if not exists task_recurrence_generations_rule_idx
  on public.task_recurrence_generations(recurrence_rule_id, generated_at desc);
create index if not exists tasks_recurrence_rule_status_idx
  on public.tasks(recurrence_rule_id, status)
  where recurrence_rule_id is not null and deleted_at is null and archived_at is null;

create or replace function private.validate_task_recurrence_rule()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare seed_owner uuid;
begin
  select owner_id into seed_owner from public.tasks where id = new.seed_task_id;
  if seed_owner is null or seed_owner <> new.owner_id then
    raise exception 'RECURRENCE_SEED_TASK_OWNER_INVALID';
  end if;
  if tg_op = 'INSERT' then
    if new.owner_id <> (select auth.uid()) then
      raise exception 'RECURRENCE_OWNER_REQUIRED';
    end if;
    if new.created_by_id <> (select auth.uid()) then
      raise exception 'RECURRENCE_CREATOR_REQUIRED';
    end if;
  elsif new.seed_task_id <> old.seed_task_id
     or new.owner_id <> old.owner_id
     or new.created_by_id <> old.created_by_id then
    raise exception 'RECURRENCE_IDENTITY_IMMUTABLE';
  end if;
  if jsonb_typeof(new.template) <> 'object'
     or nullif(btrim(coalesce(new.template ->> 'title', '')), '') is null
     or coalesce(new.template ->> 'scope', '') not in ('home', 'company')
     or coalesce(new.template ->> 'area', '') not in ('work', 'family', 'personal')
     or coalesce(new.template ->> 'sourceType', '') not in ('meeting_action', 'deadline', 'follow_up')
     or coalesce(new.template ->> 'risk', '') not in ('low', 'medium', 'high')
  then
    raise exception 'RECURRENCE_TEMPLATE_INVALID';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists validate_task_recurrence_rule_trigger on public.task_recurrence_rules;
create trigger validate_task_recurrence_rule_trigger
before insert or update on public.task_recurrence_rules
for each row execute function private.validate_task_recurrence_rule();
revoke all on function private.validate_task_recurrence_rule() from public, anon, authenticated;

create or replace function private.validate_task_recurrence_reference()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare rule_owner uuid;
begin
  if new.recurrence_rule_id is null then
    return new;
  end if;
  select owner_id into rule_owner from public.task_recurrence_rules where id = new.recurrence_rule_id;
  if rule_owner is null or rule_owner <> new.owner_id then
    raise exception 'TASK_RECURRENCE_ACCESS_DENIED';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_task_recurrence_reference_trigger on public.tasks;
create trigger validate_task_recurrence_reference_trigger
before insert or update of recurrence_rule_id on public.tasks
for each row execute function private.validate_task_recurrence_reference();
revoke all on function private.validate_task_recurrence_reference() from public, anon, authenticated;

create or replace function private.next_task_recurrence_date(
  p_frequency text,
  p_weekdays smallint[],
  p_custom_interval_days integer,
  p_anchor date,
  p_business_days_only boolean,
  p_night_shift_pattern boolean,
  p_night_shift_on_days smallint,
  p_night_shift_off_days smallint,
  p_cycle_anchor_date date
)
returns date
language plpgsql
immutable
set search_path = pg_catalog, pg_temp
as $$
declare
  candidate date;
  cycle_anchor date;
  cycle_length integer;
  cycle_position integer;
  month_start date;
  last_day integer;
  attempts integer := 0;
begin
  if p_night_shift_pattern then
    cycle_anchor := coalesce(p_cycle_anchor_date, p_anchor);
    cycle_length := p_night_shift_on_days + p_night_shift_off_days;
    candidate := p_anchor + 1;
    loop
      cycle_position := mod(candidate - cycle_anchor, cycle_length);
      if cycle_position < 0 then cycle_position := cycle_position + cycle_length; end if;
      if cycle_position < p_night_shift_on_days
         and (not p_business_days_only or extract(dow from candidate) not in (0, 6)) then
        return candidate;
      end if;
      candidate := candidate + 1;
      attempts := attempts + 1;
      if attempts > 3660 then raise exception 'RECURRENCE_DATE_NOT_FOUND'; end if;
    end loop;
  end if;

  if p_frequency = 'custom' then
    candidate := p_anchor + p_custom_interval_days;
    while p_business_days_only and extract(dow from candidate) in (0, 6) loop candidate := candidate + 1; end loop;
    return candidate;
  end if;

  if p_frequency = 'monthly' then
    month_start := (date_trunc('month', p_anchor)::date + interval '1 month')::date;
    last_day := extract(day from (month_start + interval '1 month - 1 day'))::integer;
    candidate := month_start + (least(extract(day from p_anchor)::integer, last_day) - 1);
    while p_business_days_only and extract(dow from candidate) in (0, 6) loop candidate := candidate + 1; end loop;
    return candidate;
  end if;

  candidate := p_anchor + 1;
  loop
    if (p_frequency = 'daily' or (p_frequency = 'weekly' and extract(dow from candidate)::smallint = any(p_weekdays)))
       and (not p_business_days_only or extract(dow from candidate) not in (0, 6)) then
      return candidate;
    end if;
    candidate := candidate + 1;
    attempts := attempts + 1;
    if attempts > 3660 then raise exception 'RECURRENCE_DATE_NOT_FOUND'; end if;
  end loop;
end;
$$;
revoke all on function private.next_task_recurrence_date(text, smallint[], integer, date, boolean, boolean, smallint, smallint, date) from public, anon, authenticated;

create or replace function private.generate_next_recurring_task()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  rule public.task_recurrence_rules%rowtype;
  generation_id uuid;
  next_task_id uuid;
  next_due_date date;
  anchor_date date;
  project_reference uuid;
  follow_up_offset integer;
begin
  if new.status <> 'done' or old.status = 'done' or new.recurrence_rule_id is null then
    return new;
  end if;

  select * into rule from public.task_recurrence_rules
  where id = new.recurrence_rule_id and owner_id = new.owner_id and is_active;
  if not found then return new; end if;

  anchor_date := greatest(coalesce(new.due_date, current_date), current_date);
  next_due_date := private.next_task_recurrence_date(
    rule.frequency, rule.weekdays, rule.custom_interval_days, anchor_date,
    rule.business_days_only, rule.night_shift_pattern, rule.night_shift_on_days,
    rule.night_shift_off_days, rule.cycle_anchor_date
  );

  insert into public.task_recurrence_generations (recurrence_rule_id, source_task_id, scheduled_for)
  values (rule.id, new.id, next_due_date)
  on conflict (recurrence_rule_id, source_task_id) do nothing
  returning id into generation_id;
  if generation_id is null then return new; end if;

  if nullif(rule.template ->> 'projectId', '') is not null
     and exists (
       select 1 from public.operating_items project
       where project.id = (rule.template ->> 'projectId')::uuid
         and project.item_type = 'project' and project.archived_at is null
     ) then
    project_reference := (rule.template ->> 'projectId')::uuid;
  end if;
  follow_up_offset := nullif(rule.template ->> 'followUpOffsetDays', '')::integer;

  insert into public.tasks (
    user_id, owner_id, created_by_id, scope, area, source_type, title, description,
    due_date, follow_up_date, status, next_action, definition_of_done,
    estimated_minutes, energy_level, context, risk, critical_path, safety_impact,
    child_impact, legal_impact, estimated_duration_days, buffer_days, project_id,
    recurrence_rule_id, visibility
  ) values (
    rule.owner_id, rule.owner_id, rule.owner_id,
    rule.template ->> 'scope', rule.template ->> 'area', rule.template ->> 'sourceType',
    rule.template ->> 'title', nullif(rule.template ->> 'description', ''),
    next_due_date,
    case when follow_up_offset is null then null else next_due_date + follow_up_offset end,
    'not_started', nullif(rule.template ->> 'nextAction', ''), nullif(rule.template ->> 'definitionOfDone', ''),
    nullif(rule.template ->> 'estimatedMinutes', '')::integer,
    nullif(rule.template ->> 'energyLevel', ''), nullif(rule.template ->> 'context', ''),
    rule.template ->> 'risk', coalesce((rule.template ->> 'criticalPath')::boolean, false),
    coalesce((rule.template ->> 'safetyImpact')::boolean, false),
    coalesce((rule.template ->> 'childImpact')::boolean, false),
    coalesce((rule.template ->> 'legalImpact')::boolean, false),
    nullif(rule.template ->> 'estimatedDurationDays', '')::integer,
    coalesce(nullif(rule.template ->> 'bufferDays', '')::integer, 0),
    project_reference, rule.id, 'private'
  ) returning id into next_task_id;

  update public.task_recurrence_generations set generated_task_id = next_task_id where id = generation_id;
  update public.task_recurrence_rules
  set last_generated_at = now(), last_generated_for = next_due_date, updated_at = now()
  where id = rule.id;
  return new;
end;
$$;

drop trigger if exists generate_next_recurring_task_trigger on public.tasks;
create trigger generate_next_recurring_task_trigger
after update of status on public.tasks
for each row execute function private.generate_next_recurring_task();
revoke all on function private.generate_next_recurring_task() from public, anon, authenticated;

alter table public.task_recurrence_rules enable row level security;
alter table public.task_recurrence_generations enable row level security;

create policy task_recurrence_rules_select_own on public.task_recurrence_rules
for select to authenticated using (owner_id = (select auth.uid()));
create policy task_recurrence_rules_insert_own on public.task_recurrence_rules
for insert to authenticated with check (owner_id = (select auth.uid()) and created_by_id = (select auth.uid()));
create policy task_recurrence_rules_update_own on public.task_recurrence_rules
for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()) and created_by_id = (select auth.uid()));
create policy task_recurrence_rules_delete_own on public.task_recurrence_rules
for delete to authenticated using (owner_id = (select auth.uid()));
create policy task_recurrence_generations_select_own on public.task_recurrence_generations
for select to authenticated using (
  exists (
    select 1 from public.task_recurrence_rules rule
    where rule.id = recurrence_rule_id and rule.owner_id = (select auth.uid())
  )
);

revoke all on table public.task_recurrence_rules, public.task_recurrence_generations from anon;
grant select, insert, update, delete on table public.task_recurrence_rules to authenticated;
grant select on table public.task_recurrence_generations to authenticated;
