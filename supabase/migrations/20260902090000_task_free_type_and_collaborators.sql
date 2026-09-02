-- Free-text task labels and multi-person task follow-up. Existing task types,
-- handoffs and notification recipients remain intact for backwards compatibility.

alter table public.tasks
  add column if not exists task_type_label text;

alter table public.tasks
  drop constraint if exists tasks_task_type_label_length_check;

alter table public.tasks
  add constraint tasks_task_type_label_length_check
  check (task_type_label is null or char_length(btrim(task_type_label)) between 1 and 120);

create table if not exists public.task_followers (
  task_id uuid not null references public.tasks(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  follower_id uuid not null references auth.users(id) on delete cascade,
  share_record_id uuid references public.share_records(id) on delete set null,
  owns_share boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (task_id, follower_id),
  constraint task_followers_not_self check (owner_id <> follower_id)
);

create index if not exists task_followers_follower_idx
  on public.task_followers(follower_id, created_at desc);

alter table public.task_followers enable row level security;

drop policy if exists task_followers_select_participant on public.task_followers;
create policy task_followers_select_participant
  on public.task_followers for select to authenticated
  using (owner_id = (select auth.uid()) or follower_id = (select auth.uid()));

revoke all on public.task_followers from anon, authenticated;
grant select on public.task_followers to authenticated;

create or replace function public.set_task_followers(
  p_task_id uuid,
  p_follower_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  target uuid;
  share_id uuid;
  owns_new_share boolean;
  requested_ids uuid[];
begin
  if actor is null then raise exception 'AUTH_REQUIRED'; end if;

  select array_agg(distinct requested.follower_id) into requested_ids
  from unnest(coalesce(p_follower_ids, '{}'::uuid[])) as requested(follower_id)
  where requested.follower_id <> actor;
  requested_ids := coalesce(requested_ids, '{}'::uuid[]);

  if cardinality(requested_ids) > 20 then raise exception 'TOO_MANY_TASK_FOLLOWERS'; end if;

  if not exists (
    select 1 from public.tasks task
    where task.id = p_task_id and task.owner_id = actor
      and task.deleted_at is null and task.archived_at is null
    for update
  ) then raise exception 'TASK_FOLLOWER_FORBIDDEN'; end if;

  if exists (
    select 1
    from unnest(requested_ids) requested(id)
    where not exists (
      select 1 from public.participant_profiles() participant
      where participant.user_id = requested.id
    )
  ) then raise exception 'TASK_FOLLOWER_NOT_CONNECTED'; end if;

  update public.share_records share
  set revoked_at = now()
  where share.id in (
    select follower.share_record_id
    from public.task_followers follower
    where follower.task_id = p_task_id and follower.owner_id = actor
      and follower.owns_share
      and not (follower.follower_id = any(requested_ids))
  )
    and share.revoked_at is null
    and not exists (
      select 1 from public.task_notice_recipients notice
      where notice.share_record_id = share.id
    );

  delete from public.task_followers follower
  where follower.task_id = p_task_id and follower.owner_id = actor
    and not (follower.follower_id = any(requested_ids));

  foreach target in array requested_ids loop
    if not exists (
      select 1 from public.task_followers follower
      where follower.task_id = p_task_id and follower.follower_id = target
    ) then
      select share.id into share_id
      from public.share_records share
      where share.resource_type = 'task' and share.resource_id = p_task_id
        and share.shared_with_user_id = target and share.revoked_at is null
      order by share.created_at desc
      limit 1;

      owns_new_share := false;
      if share_id is null then
        insert into public.share_records(
          resource_type, resource_id, owner_id, shared_with_user_id,
          permission, share_type, include_comments, accepted_at
        ) values (
          'task', p_task_id, actor, target,
          'update_status', 'reference', true, now()
        ) returning id into share_id;
        owns_new_share := true;
      else
        update public.share_records
        set permission = 'update_status', include_comments = true
        where id = share_id;
      end if;

      insert into public.task_followers(task_id, owner_id, follower_id, share_record_id, owns_share)
      values (p_task_id, actor, target, share_id, owns_new_share);
    end if;
  end loop;

  if cardinality(requested_ids) > 0 then
    update public.tasks
    set visibility = case
      when visibility in ('household', 'assigned', 'joint') then visibility
      else 'shared'
    end,
    last_progress_at = now()
    where id = p_task_id and owner_id = actor;
  end if;

  return cardinality(requested_ids);
end;
$$;

revoke all on function public.set_task_followers(uuid, uuid[]) from public, anon;
grant execute on function public.set_task_followers(uuid, uuid[]) to authenticated;
