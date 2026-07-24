-- Keep checkpoint resource URLs private to their author.
-- Saved checkpoint text can be shared with task participants, but private
-- document/page URLs are never inherited merely because the task is shared.

create table if not exists public.task_checkpoint_resources (
  id uuid primary key default gen_random_uuid(),
  checkpoint_id uuid not null references public.task_checkpoints(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  label text not null,
  url text not null,
  position smallint not null,
  created_at timestamptz not null default now(),
  constraint task_checkpoint_resources_position_check check (position between 1 and 10),
  constraint task_checkpoint_resources_label_check check (char_length(label) between 1 and 200),
  constraint task_checkpoint_resources_url_check check (
    char_length(url) <= 2000 and url ~ '^https://[^[:space:]]+$'
  ),
  unique(checkpoint_id, position)
);

create index if not exists task_checkpoint_resources_author_idx
  on public.task_checkpoint_resources(author_id, checkpoint_id);

create or replace function private.validate_task_checkpoint_resource()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  checkpoint_task_id uuid;
  checkpoint_author_id uuid;
  checkpoint_state text;
begin
  if new.author_id <> (select auth.uid()) then
    raise exception 'CHECKPOINT_AUTHOR_REQUIRED';
  end if;
  select c.task_id, c.author_id, c.state
  into checkpoint_task_id, checkpoint_author_id, checkpoint_state
  from public.task_checkpoints c
  where c.id = new.checkpoint_id;
  if checkpoint_task_id is null
     or checkpoint_task_id <> new.task_id
     or checkpoint_author_id <> new.author_id then
    raise exception 'CHECKPOINT_RESOURCE_INVALID';
  end if;
  if checkpoint_state <> 'draft' then
    raise exception 'CHECKPOINT_IMMUTABLE';
  end if;
  if tg_op = 'UPDATE' and (
    new.id <> old.id
    or new.checkpoint_id <> old.checkpoint_id
    or new.task_id <> old.task_id
    or new.author_id <> old.author_id
    or new.created_at <> old.created_at
  ) then
    raise exception 'CHECKPOINT_IDENTITY_IMMUTABLE';
  end if;
  return new;
end;
$$;
revoke all on function private.validate_task_checkpoint_resource() from public, anon, authenticated;

drop trigger if exists validate_task_checkpoint_resource_trigger on public.task_checkpoint_resources;
create trigger validate_task_checkpoint_resource_trigger
before insert or update on public.task_checkpoint_resources
for each row execute function private.validate_task_checkpoint_resource();

alter table public.task_checkpoint_resources enable row level security;

create policy task_checkpoint_resources_select_author
on public.task_checkpoint_resources
for select
to authenticated
using (
  author_id = (select auth.uid())
  and (select private.current_user_can_read('task', task_id))
);

create policy task_checkpoint_resources_insert_author_draft
on public.task_checkpoint_resources
for insert
to authenticated
with check (
  author_id = (select auth.uid())
  and (select private.current_user_can_checkpoint(task_id))
  and exists (
    select 1 from public.task_checkpoints c
    where c.id = checkpoint_id and c.author_id = (select auth.uid()) and c.state = 'draft'
  )
);

create policy task_checkpoint_resources_update_author_draft
on public.task_checkpoint_resources
for update
to authenticated
using (
  author_id = (select auth.uid())
  and (select private.current_user_can_checkpoint(task_id))
  and exists (
    select 1 from public.task_checkpoints c
    where c.id = checkpoint_id and c.author_id = (select auth.uid()) and c.state = 'draft'
  )
)
with check (
  author_id = (select auth.uid())
  and (select private.current_user_can_checkpoint(task_id))
);

create policy task_checkpoint_resources_delete_author_draft
on public.task_checkpoint_resources
for delete
to authenticated
using (
  author_id = (select auth.uid())
  and (select private.current_user_can_checkpoint(task_id))
  and exists (
    select 1 from public.task_checkpoints c
    where c.id = checkpoint_id and c.author_id = (select auth.uid()) and c.state = 'draft'
  )
);

revoke all on public.task_checkpoint_resources from anon;
grant select, insert, update, delete on public.task_checkpoint_resources to authenticated;

-- The legacy JSON column remains for backwards-compatible row shape, but is
-- forced empty so direct table reads can never expose private URLs.
create or replace function private.validate_task_checkpoint()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
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
  new.resource_links := '[]'::jsonb;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function private.validate_task_checkpoint() from public, anon, authenticated;

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
  if jsonb_typeof(coalesce(p_resource_links, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_resource_links, '[]'::jsonb)) > 10 then
    raise exception 'CHECKPOINT_RESOURCE_INVALID';
  end if;
  if p_state = 'saved'
     and nullif(btrim(coalesce(p_completed_summary, '')), '') is null
     and nullif(btrim(coalesce(p_current_position, '')), '') is null
     and nullif(btrim(coalesce(p_next_minimum_step, '')), '') is null
     and nullif(btrim(coalesce(p_blocked_reason, '')), '') is null then
    raise exception 'CHECKPOINT_CONTENT_REQUIRED';
  end if;

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
      p_task_id, actor, 'draft', nullif(btrim(p_completed_summary), ''),
      nullif(btrim(p_current_position), ''), nullif(btrim(p_next_minimum_step), ''),
      '[]'::jsonb, nullif(btrim(p_blocked_reason), ''), now()
    )
    returning * into checkpoint;
  else
    update public.task_checkpoints
    set completed_summary = nullif(btrim(p_completed_summary), ''),
        current_position = nullif(btrim(p_current_position), ''),
        next_minimum_step = nullif(btrim(p_next_minimum_step), ''),
        resource_links = '[]'::jsonb,
        blocked_reason = nullif(btrim(p_blocked_reason), ''),
        last_worked_at = now()
    where id = checkpoint.id
    returning * into checkpoint;
  end if;

  delete from public.task_checkpoint_resources where checkpoint_id = checkpoint.id;
  insert into public.task_checkpoint_resources (
    checkpoint_id, task_id, author_id, label, url, position
  )
  select
    checkpoint.id,
    p_task_id,
    actor,
    nullif(btrim(resource.value->>'label'), ''),
    resource.value->>'url',
    resource.ordinality::smallint
  from jsonb_array_elements(coalesce(p_resource_links, '[]'::jsonb))
    with ordinality as resource(value, ordinality);

  if p_state = 'saved' then
    update public.task_checkpoints
    set state = 'saved', last_worked_at = now()
    where id = checkpoint.id
    returning * into checkpoint;
  end if;

  return checkpoint;
end;
$$;
revoke all on function public.save_task_checkpoint(uuid, text, text, text, text, jsonb, text) from public, anon;
grant execute on function public.save_task_checkpoint(uuid, text, text, text, text, jsonb, text) to authenticated;

comment on column public.task_checkpoints.resource_links is
  'Deprecated compatibility column. Always empty; author-private URLs are in task_checkpoint_resources.';
