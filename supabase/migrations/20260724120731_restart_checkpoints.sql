-- Persistent restart checkpoints for tasks and Focus Mode.
-- This migration is additive: it does not alter or remove existing task data.

create table if not exists public.task_checkpoints (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  state text not null default 'draft',
  completed_summary text,
  current_position text,
  next_minimum_step text,
  resource_links jsonb not null default '[]'::jsonb,
  blocked_reason text,
  last_worked_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint task_checkpoints_state_check check (state in ('draft', 'saved')),
  constraint task_checkpoints_resource_links_check check (
    jsonb_typeof(resource_links) = 'array' and jsonb_array_length(resource_links) <= 10
  ),
  constraint task_checkpoints_completed_summary_length check (char_length(completed_summary) <= 4000),
  constraint task_checkpoints_current_position_length check (char_length(current_position) <= 4000),
  constraint task_checkpoints_next_step_length check (char_length(next_minimum_step) <= 2000),
  constraint task_checkpoints_blocked_reason_length check (char_length(blocked_reason) <= 2000)
);

create unique index if not exists task_checkpoints_one_draft_idx
  on public.task_checkpoints(task_id, author_id)
  where state = 'draft';
create index if not exists task_checkpoints_task_history_idx
  on public.task_checkpoints(task_id, state, last_worked_at desc, created_at desc);
create index if not exists task_checkpoints_author_idx
  on public.task_checkpoints(author_id, updated_at desc);

create or replace function private.current_user_can_checkpoint(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select (select auth.uid()) is not null and (
    exists (
      select 1
      from public.tasks t
      where t.id = p_task_id
        and t.owner_id = (select auth.uid())
        and t.deleted_at is null
        and t.archived_at is null
    )
    or exists (
      select 1
      from public.share_records s
      where s.resource_type = 'task'
        and s.resource_id = p_task_id
        and s.shared_with_user_id = (select auth.uid())
        and s.permission in ('update_status', 'edit', 'co_owner')
        and s.revoked_at is null
        and (s.expires_at is null or s.expires_at > now())
    )
    or exists (
      select 1
      from public.assignments a
      where a.resource_type = 'task'
        and a.resource_id = p_task_id
        and a.assigned_to_id = (select auth.uid())
        and a.status in ('accepted', 'in_progress', 'waiting', 'blocked')
    )
  );
$$;
revoke all on function private.current_user_can_checkpoint(uuid) from public, anon;
grant execute on function private.current_user_can_checkpoint(uuid) to authenticated;

create or replace function private.validate_task_checkpoint()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  resource jsonb;
  resource_url text;
begin
  if new.author_id <> (select auth.uid()) then
    raise exception 'CHECKPOINT_AUTHOR_REQUIRED';
  end if;
  if not (select private.current_user_can_checkpoint(new.task_id)) then
    raise exception 'CHECKPOINT_FORBIDDEN';
  end if;
  if tg_op = 'UPDATE' then
    if old.state <> 'draft' then
      raise exception 'CHECKPOINT_IMMUTABLE';
    end if;
    if new.id <> old.id or new.task_id <> old.task_id or new.author_id <> old.author_id
       or new.created_at <> old.created_at then
      raise exception 'CHECKPOINT_IDENTITY_IMMUTABLE';
    end if;
  end if;
  for resource in select value from jsonb_array_elements(new.resource_links)
  loop
    if jsonb_typeof(resource) <> 'object'
       or char_length(coalesce(resource->>'label', '')) > 200
       or char_length(coalesce(resource->>'url', '')) > 2000 then
      raise exception 'CHECKPOINT_RESOURCE_INVALID';
    end if;
    resource_url := coalesce(resource->>'url', '');
    if resource_url !~ '^https://[^[:space:]]+$' then
      raise exception 'CHECKPOINT_RESOURCE_INVALID';
    end if;
  end loop;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function private.validate_task_checkpoint() from public, anon, authenticated;

drop trigger if exists validate_task_checkpoint_trigger on public.task_checkpoints;
create trigger validate_task_checkpoint_trigger
before insert or update on public.task_checkpoints
for each row execute function private.validate_task_checkpoint();

alter table public.task_checkpoints enable row level security;

create policy task_checkpoints_select_authorized
on public.task_checkpoints
for select
to authenticated
using (
  (
    state = 'saved'
    and (select private.current_user_can_read('task', task_id))
  )
  or (
    state = 'draft'
    and author_id = (select auth.uid())
    and (select private.current_user_can_checkpoint(task_id))
  )
);

create policy task_checkpoints_insert_author
on public.task_checkpoints
for insert
to authenticated
with check (
  author_id = (select auth.uid())
  and (select private.current_user_can_checkpoint(task_id))
);

create policy task_checkpoints_update_own_draft
on public.task_checkpoints
for update
to authenticated
using (
  author_id = (select auth.uid())
  and state = 'draft'
  and (select private.current_user_can_checkpoint(task_id))
)
with check (
  author_id = (select auth.uid())
  and (select private.current_user_can_checkpoint(task_id))
);

create policy task_checkpoints_delete_own_draft
on public.task_checkpoints
for delete
to authenticated
using (
  author_id = (select auth.uid())
  and state = 'draft'
  and (select private.current_user_can_checkpoint(task_id))
);

revoke all on public.task_checkpoints from anon;
grant select, insert, update, delete on public.task_checkpoints to authenticated;

create or replace function public.save_task_checkpoint(
  p_task_id uuid,
  p_state text,
  p_completed_summary text default null,
  p_current_position text default null,
  p_next_minimum_step text default null,
  p_resource_links jsonb default '[]'::jsonb,
  p_blocked_reason text default null
)
returns public.task_checkpoints
language plpgsql
security invoker
set search_path = public, private, pg_temp
as $$
declare
  actor uuid := (select auth.uid());
  checkpoint public.task_checkpoints;
begin
  if actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_state not in ('draft', 'saved') then raise exception 'CHECKPOINT_STATE_INVALID'; end if;
  if not (select private.current_user_can_checkpoint(p_task_id)) then
    raise exception 'CHECKPOINT_FORBIDDEN';
  end if;
  if p_state = 'saved'
     and nullif(btrim(coalesce(p_completed_summary, '')), '') is null
     and nullif(btrim(coalesce(p_current_position, '')), '') is null
     and nullif(btrim(coalesce(p_next_minimum_step, '')), '') is null
     and nullif(btrim(coalesce(p_blocked_reason, '')), '') is null then
    raise exception 'CHECKPOINT_CONTENT_REQUIRED';
  end if;

  -- Serialise saves for one task/author so retries and rapid autosaves cannot
  -- create duplicate draft rows.
  perform pg_advisory_xact_lock(hashtextextended(p_task_id::text || ':' || actor::text, 0));

  select *
  into checkpoint
  from public.task_checkpoints
  where task_id = p_task_id and author_id = actor and state = 'draft'
  for update;

  if checkpoint.id is null then
    insert into public.task_checkpoints (
      task_id, author_id, state, completed_summary, current_position,
      next_minimum_step, resource_links, blocked_reason, last_worked_at
    )
    values (
      p_task_id, actor, p_state, nullif(btrim(p_completed_summary), ''),
      nullif(btrim(p_current_position), ''), nullif(btrim(p_next_minimum_step), ''),
      coalesce(p_resource_links, '[]'::jsonb), nullif(btrim(p_blocked_reason), ''), now()
    )
    returning * into checkpoint;
  else
    update public.task_checkpoints
    set state = p_state,
        completed_summary = nullif(btrim(p_completed_summary), ''),
        current_position = nullif(btrim(p_current_position), ''),
        next_minimum_step = nullif(btrim(p_next_minimum_step), ''),
        resource_links = coalesce(p_resource_links, '[]'::jsonb),
        blocked_reason = nullif(btrim(p_blocked_reason), ''),
        last_worked_at = now()
    where id = checkpoint.id
    returning * into checkpoint;
  end if;

  return checkpoint;
end;
$$;
revoke all on function public.save_task_checkpoint(uuid, text, text, text, text, jsonb, text) from public, anon;
grant execute on function public.save_task_checkpoint(uuid, text, text, text, text, jsonb, text) to authenticated;

create or replace view public.latest_task_checkpoints
with (security_invoker = true)
as
select distinct on (task_id)
  id, task_id, author_id, state, completed_summary, current_position,
  next_minimum_step, resource_links, blocked_reason, last_worked_at,
  created_at, updated_at
from public.task_checkpoints
where state = 'saved'
order by task_id, last_worked_at desc, created_at desc;

revoke all on public.latest_task_checkpoints from anon;
grant select on public.latest_task_checkpoints to authenticated;
