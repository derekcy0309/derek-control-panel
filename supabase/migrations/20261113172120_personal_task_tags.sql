-- Additive, private organization only. Existing tasks, scopes and sharing stay unchanged.
-- Version aligned to the migration ID assigned by the Supabase apply_migration tool.
create table public.personal_task_tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  legacy_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, user_id)
);
create unique index personal_task_tags_active_name on public.personal_task_tags(user_id, lower(btrim(name))) where deleted_at is null;
create index personal_task_tags_owner on public.personal_task_tags(user_id);

create table public.task_tag_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  initialized_at timestamptz not null default now()
);
create table public.task_tag_assignments (
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  tag_id uuid not null,
  primary key (user_id, task_id, tag_id),
  foreign key (tag_id, user_id) references public.personal_task_tags(id, user_id) on delete cascade
);
create index task_tag_assignments_task on public.task_tag_assignments(task_id);
create index task_tag_assignments_tag on public.task_tag_assignments(tag_id, user_id);

alter table public.personal_task_tags enable row level security;
alter table public.task_tag_preferences enable row level security;
alter table public.task_tag_assignments enable row level security;
create policy tags_self on public.personal_task_tags for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy tag_preferences_read_self on public.task_tag_preferences for select to authenticated using (user_id = (select auth.uid()));
create policy tag_preferences_insert_self on public.task_tag_preferences for insert to authenticated with check (user_id = (select auth.uid()));
create policy tag_links_self on public.task_tag_assignments for all to authenticated
  using (user_id = (select auth.uid()) and exists (select 1 from public.tasks t where t.id = task_id))
  with check (user_id = (select auth.uid()) and exists (select 1 from public.tasks t where t.id = task_id)
    and exists (select 1 from public.personal_task_tags tag where tag.id = tag_id and tag.user_id = (select auth.uid()) and tag.deleted_at is null));
revoke all on public.personal_task_tags, public.task_tag_preferences, public.task_tag_assignments from public, anon, authenticated;
grant select, insert, update on public.personal_task_tags to authenticated;
grant select, insert on public.task_tag_preferences to authenticated;
grant select, insert, delete on public.task_tag_assignments to authenticated;

-- Tag events contain generic text only, not task notes or label names.
create policy activity_insert_own_tag on public.activity_logs for insert to authenticated with check (
  actor_id = (select auth.uid()) and resource_type = 'personal_task_tag'
  and exists (select 1 from public.personal_task_tags tag where tag.id = resource_id and tag.user_id = (select auth.uid()))
);

create function public.ensure_my_task_tags(p_keep_legacy boolean default false) returns void
language plpgsql security invoker set search_path = '' as $$
declare actor uuid := auth.uid(); initialized uuid;
begin
  if actor is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  insert into public.task_tag_preferences(user_id) values (actor) on conflict do nothing returning user_id into initialized;
  if initialized is null then return; end if;
  insert into public.personal_task_tags(user_id, name, legacy_key)
    values (actor, '個人', 'personal'), (actor, 'Wecare', 'wecare');
  if p_keep_legacy then
    insert into public.personal_task_tags(user_id, name, legacy_key) values (actor, '家庭', 'family'), (actor, 'SEC', 'sec');
  end if;
  insert into public.task_tag_assignments(user_id, task_id, tag_id)
    select actor, t.id, tag.id from public.tasks t
    join public.personal_task_tags tag on tag.user_id = actor and tag.legacy_key = case
      when not p_keep_legacy then case when t.scope = 'company' then 'wecare' else 'personal' end
      when t.area = 'personal' then 'personal'
      when t.area = 'family' or (t.area is null and t.scope = 'home') then 'family'
      when t.scope = 'company' then 'wecare' else 'sec' end
    where t.deleted_at is null and t.archived_at is null
    on conflict do nothing;
end;
$$;

create function public.manage_my_task_tag(p_action text, p_tag_id uuid default null, p_name text default null)
returns public.personal_task_tags language plpgsql security invoker set search_path = '' as $$
declare actor uuid := auth.uid(); result public.personal_task_tags;
begin
  if actor is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_action not in ('create','rename','delete') then raise exception 'Invalid tag action' using errcode = '22023'; end if;
  if p_action <> 'delete' and (p_name is null or char_length(btrim(p_name)) not between 1 and 40) then
    raise exception 'Invalid tag name' using errcode = '22023';
  end if;
  if p_action = 'create' then
    if (select count(*) from public.personal_task_tags where user_id = actor and deleted_at is null) >= 60 then
      raise exception '最多可保留 60 個 Tags。' using errcode = '22023';
    end if;
    insert into public.personal_task_tags(user_id,name) values(actor,btrim(p_name)) returning * into result;
  else
    update public.personal_task_tags set name = case when p_action = 'rename' then btrim(p_name) else name end,
      deleted_at = case when p_action = 'delete' then now() else null end, updated_at = now()
      where id = p_tag_id and user_id = actor and deleted_at is null returning * into result;
    if result.id is null then raise exception 'Tag not found' using errcode = '42501'; end if;
  end if;
  insert into public.activity_logs(resource_type,resource_id,actor_id,action,summary)
    values('personal_task_tag',result.id,actor,'tag_' || p_action,'更新自己的任務 Tags；任務內容及分享權限不變');
  return result;
end;
$$;

create function public.set_my_task_tags(p_task_id uuid, p_tag_ids uuid[]) returns void
language plpgsql security invoker set search_path = '' as $$
declare actor uuid := auth.uid();
begin
  if actor is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_tag_ids is null or cardinality(p_tag_ids) > 20 or array_position(p_tag_ids, null) is not null then
    raise exception 'Invalid task tags' using errcode = '22023';
  end if;
  if not exists (select 1 from public.tasks where id = p_task_id and deleted_at is null) then
    raise exception 'Task not found' using errcode = '42501';
  end if;
  if exists (select 1 from unnest(p_tag_ids) selected(id) where not exists (
    select 1 from public.personal_task_tags tag where tag.id = selected.id and tag.user_id = actor and tag.deleted_at is null
  )) then raise exception 'Tag not allowed' using errcode = '42501'; end if;
  -- Serialize updates to this user's label set for this task, not other users' tags.
  perform pg_advisory_xact_lock(hashtextextended(actor::text || ':' || p_task_id::text, 0));
  delete from public.task_tag_assignments where user_id = actor and task_id = p_task_id;
  insert into public.task_tag_assignments(user_id, task_id, tag_id)
    select distinct actor, p_task_id, id from unnest(p_tag_ids) selected(id);
  insert into public.activity_logs(resource_type,resource_id,actor_id,action,summary)
    values ('task',p_task_id,actor,'personal_tags_updated','更新自己的任務 Tags；分享權限不變');
end;
$$;
revoke all on function public.ensure_my_task_tags(boolean), public.manage_my_task_tag(text,uuid,text), public.set_my_task_tags(uuid,uuid[]) from public, anon;
grant execute on function public.ensure_my_task_tags(boolean), public.manage_my_task_tag(text,uuid,text), public.set_my_task_tags(uuid,uuid[]) to authenticated;
comment on table public.personal_task_tags is 'Viewer-private task organization. Never grants task or resource access.';
comment on table public.task_tag_preferences is 'One-time defaults marker. Removing tags must not recreate presets on next sign-in.';
