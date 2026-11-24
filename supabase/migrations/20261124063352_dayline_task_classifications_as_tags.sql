-- Materialize existing task classifications into the existing owner-private tag
-- model. Do not update tasks, ACLs or old tag rows. Legacy task fields remain
-- available to older deployments, automations and task ordering.
create table if not exists private.dayline_task_classification_tag_runs (
  migration_key text primary key,
  applied_at timestamptz not null default statement_timestamp(),
  created_tags bigint not null default 0,
  created_links bigint not null default 0,
  initialized_accounts bigint not null default 0,
  skipped_oversize_labels bigint not null default 0
);
alter table private.dayline_task_classification_tag_runs enable row level security;
revoke all on private.dayline_task_classification_tag_runs from public, anon, authenticated;

do $$
declare
  run_key constant text := 'task_classifications_as_tags_v1';
  claim text;
  new_tags bigint;
  new_links bigint;
  new_preferences bigint;
begin
  insert into private.dayline_task_classification_tag_runs(migration_key)
    values (run_key) on conflict do nothing returning migration_key into claim;
  -- Important even in a manually replayed migration: the previous import must
  -- never recreate a link or tag a person has since removed in the UI.
  if claim is null then return; end if;

  perform set_config('lock_timeout', '5s', true);
  lock table public.task_tag_preferences, public.personal_task_tags, public.task_tag_assignments
    in share row exclusive mode;

  create temporary table dayline_classification_candidates (
    user_id uuid not null, task_id uuid, stable_key text, name text not null
  ) on commit drop;

  insert into pg_temp.dayline_classification_candidates(user_id, task_id, stable_key, name)
  with requester as (
    -- A user-requested set of editable presets. Never infer classifications
    -- from a Task name or description.
    select u.id from auth.users u join public.user_profiles p on p.user_id = u.id
    where lower(u.email) = 'derekcy0309@gmail.com' and u.email_confirmed_at is not null
      and p.active and p.is_admin
  ), owners as (
    select t.id, coalesce(t.owner_id, t.user_id) as user_id, t.area, t.scope,
           coalesce(t.requested_priority, 3) as priority, t.task_type, t.task_type_label
    from public.tasks t
    join auth.users u on u.id = coalesce(t.owner_id, t.user_id)
    where t.deleted_at is null
  ), categories(key, label) as (
    values ('personal','個人'), ('wecare','Wecare'), ('family','家庭'), ('sec','SEC')
  ), classification_keys as (
    -- Explicit legacy classification wins over broad area/scope defaults.
    -- A user's existing tag assignments are not removed by this import.
    select o.*, coalesce(explicit.key, case when o.area = 'personal' then 'personal'
      when o.area = 'family' or (o.area is null and o.scope = 'home') then 'family'
      when o.scope = 'company' then 'wecare' else 'sec' end) as area_key,
      case when o.priority <= 2 then 'p1' when o.priority <= 4 then 'p2' else 'p3' end as priority_key
    from owners o
    left join categories explicit on lower(explicit.label) = lower(btrim(o.task_type_label))
      or (explicit.key = 'sec' and btrim(o.task_type_label) = '恩海居')
  ), priorities(key,label) as (
    values ('p1','P1'), ('p2','P2'), ('p3','P3')
  ), task_types(key,label) as (
    values ('intake','待整理'), ('scheduling','時間安排'), ('materials','文件整理'),
      ('rn_coordination','等待別人'), ('follow_up','跟進'), ('sop','工作流程'),
      ('ai_document','文件草稿'), ('system_issue','系統工作'), ('compliance','檢查事項'),
      ('training','學習及進修'), ('assessment','等待覆核'), ('family_conference','會議工作')
  ), pending_initialization as (
    select distinct o.user_id from owners o
    where not exists (select 1 from public.task_tag_preferences p where p.user_id = o.user_id)
  )
  select o.user_id,o.id,c.key,c.label from classification_keys o join categories c on c.key = o.area_key
  union all
  select o.user_id,o.id,'priority_' || p.key,p.label from classification_keys o join priorities p on p.key = o.priority_key
  union all
  select o.user_id,o.id,'task_type_' || ty.key,ty.label from owners o join task_types ty on ty.key = o.task_type
    where nullif(btrim(o.task_type_label),'') is null
  union all
  select o.user_id,o.id,null,btrim(o.task_type_label) from owners o
    where char_length(btrim(o.task_type_label)) between 1 and 40
      and lower(btrim(o.task_type_label)) not in ('p1','p2','p3','恩海居')
      and not exists (select 1 from categories c where lower(c.label) = lower(btrim(o.task_type_label)))
  union all
  -- Preserve first-use presets for an existing owner who has not visited Tags.
  -- Otherwise the lazy initializer could try to recreate the same definitions.
  select p.user_id,null,c.key,c.label from pending_initialization p cross join categories c
    where c.key in ('personal','wecare') or p.user_id in (select id from requester)
  union all
  select r.id,null,'priority_' || p.key,p.label from requester r cross join priorities p
  union all
  select r.id,null,c.key,c.label from requester r cross join categories c;

  with names as (
    select distinct on (user_id,lower(btrim(name))) user_id, stable_key, name
    from pg_temp.dayline_classification_candidates
    order by user_id,lower(btrim(name)),stable_key nulls last,name
  )
  insert into public.personal_task_tags(user_id, name, legacy_key)
    select n.user_id,n.name,n.stable_key from names n
    where not exists (
      select 1 from public.personal_task_tags t where t.user_id = n.user_id
        and (t.legacy_key = n.stable_key or lower(btrim(t.name)) = lower(btrim(n.name)))
    ) on conflict do nothing;
  get diagnostics new_tags = row_count;

  if exists (
    select 1 from public.personal_task_tags t
    where t.deleted_at is null and t.user_id in (select c.user_id from pg_temp.dayline_classification_candidates c)
    group by t.user_id having count(*) > 60
  ) then raise exception 'Task classification conversion would exceed 60 active tags for an account'; end if;

  create temporary table dayline_classification_links (
    user_id uuid not null, task_id uuid not null, tag_id uuid not null,
    primary key(user_id, task_id, tag_id)
  ) on commit drop;

  insert into pg_temp.dayline_classification_links(user_id,task_id,tag_id)
    select distinct c.user_id,c.task_id,tag.id
    from pg_temp.dayline_classification_candidates c
    join lateral (
      select t.id,t.deleted_at from public.personal_task_tags t where t.user_id = c.user_id
        and (t.legacy_key = c.stable_key or lower(btrim(t.name)) = lower(btrim(c.name)))
      -- Match the original tag id even after a rename. If that stable tag was
      -- removed, do not attach the old classification to a recreated name.
      order by (t.legacy_key = c.stable_key) desc nulls last, t.deleted_at nulls first, t.created_at, t.id
      limit 1
    ) tag on tag.deleted_at is null
    where c.task_id is not null;

  if exists (
    select 1 from (
      select a.user_id,a.task_id,a.tag_id from public.task_tag_assignments a
      join public.personal_task_tags t on t.id = a.tag_id and t.user_id = a.user_id and t.deleted_at is null
      where exists (select 1 from pg_temp.dayline_classification_links m where m.user_id = a.user_id and m.task_id = a.task_id)
      union
      select m.user_id,m.task_id,m.tag_id from pg_temp.dayline_classification_links m
    ) proposed group by user_id,task_id having count(*) > 20
  ) then raise exception 'Task classification conversion would exceed 20 active tags for a task'; end if;

  insert into public.task_tag_assignments(user_id,task_id,tag_id)
    select user_id,task_id,tag_id from pg_temp.dayline_classification_links on conflict do nothing;
  get diagnostics new_links = row_count;

  insert into public.task_tag_preferences(user_id)
    select distinct c.user_id from pg_temp.dayline_classification_candidates c
    on conflict do nothing;
  get diagnostics new_preferences = row_count;

  update private.dayline_task_classification_tag_runs set
    created_tags = new_tags, created_links = new_links, initialized_accounts = new_preferences,
    skipped_oversize_labels = (select count(*) from public.tasks t
      where t.deleted_at is null and char_length(btrim(t.task_type_label)) > 40)
  where migration_key = run_key;
end;
$$;

-- First-use presets provide choices only. Historical assignments were copied
-- above; visiting Tags must never classify newly created or shared tasks.
create or replace function public.ensure_my_task_tags(p_keep_legacy boolean default false)
returns void language plpgsql security invoker set search_path = '' as $$
declare actor uuid := auth.uid(); initialized uuid;
begin
  if actor is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  insert into public.task_tag_preferences(user_id) values (actor)
    on conflict do nothing returning user_id into initialized;
  if initialized is null then return; end if;
  insert into public.personal_task_tags(user_id,name,legacy_key)
    select actor,seed.name,seed.key
    from (values ('個人','personal'), ('Wecare','wecare'), ('家庭','family'), ('SEC','sec')) seed(name,key)
    where (seed.key in ('personal','wecare') or p_keep_legacy)
      and not exists (select 1 from public.personal_task_tags t where t.user_id = actor
        and (t.legacy_key = seed.key or lower(btrim(t.name)) = lower(btrim(seed.name))))
    on conflict do nothing;
end;
$$;
revoke all on function public.ensure_my_task_tags(boolean) from public, anon;
grant execute on function public.ensure_my_task_tags(boolean) to authenticated;
