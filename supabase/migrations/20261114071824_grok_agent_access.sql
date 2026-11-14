-- Additive, opt-in Grok browser workspace. No Auth users/providers are changed.
-- Agent credentials are NOT Supabase JWTs. Only the server-only service role
-- can execute the restricted operation RPC; anon/authenticated cannot call it.
create table public.agent_access_grants (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  label text not null check (char_length(btrim(label)) between 1 and 50),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  key_fingerprint text generated always as (substr(token_hash,1,12)) stored,
  create_tag_ids uuid[] not null check (cardinality(create_tag_ids) between 1 and 20 and array_position(create_tag_ids,null) is null),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz,
  unique(id,owner_id),
  check (expires_at > created_at and expires_at <= created_at + interval '90 days')
);
create index agent_access_grants_owner on public.agent_access_grants(owner_id,created_at desc);
create table public.agent_access_resources (
  grant_id uuid not null,
  owner_id uuid not null,
  resource_type text not null check (resource_type in ('task','note')),
  resource_id uuid not null,
  primary key(grant_id,resource_type,resource_id),
  foreign key(grant_id,owner_id) references public.agent_access_grants(id,owner_id) on delete cascade
);
create index agent_access_resources_owner on public.agent_access_resources(owner_id);
create table public.agent_access_events (
  id uuid primary key default gen_random_uuid(),
  grant_id uuid not null,
  owner_id uuid not null,
  action text not null check (action in ('grant_created','grant_revoked','status','list','detail','create_task','create_note')),
  resource_type text check (resource_type in ('task','note')),
  resource_id uuid,
  created_at timestamptz not null default now(),
  foreign key(grant_id,owner_id) references public.agent_access_grants(id,owner_id) on delete cascade
);
create index agent_access_events_grant_time on public.agent_access_events(grant_id,created_at desc);
create index agent_access_events_owner_time on public.agent_access_events(owner_id,created_at desc);
create table public.agent_write_requests (
  grant_id uuid not null,
  owner_id uuid not null,
  request_id uuid not null,
  payload_checksum text not null,
  resource_type text not null check (resource_type in ('task','note')),
  resource_id uuid not null,
  created_at timestamptz not null default now(),
  primary key(grant_id,request_id),
  foreign key(grant_id,owner_id) references public.agent_access_grants(id,owner_id) on delete cascade
);

alter table public.agent_access_grants enable row level security;
alter table public.agent_access_resources enable row level security;
alter table public.agent_access_events enable row level security;
alter table public.agent_write_requests enable row level security;
create policy agent_grants_read_self on public.agent_access_grants for select to authenticated using(owner_id=(select auth.uid()));
create policy agent_grants_create_self on public.agent_access_grants for insert to authenticated with check(
  owner_id=(select auth.uid()) and expires_at > now() and expires_at <= now()+interval '90 days'
  and exists(select 1 from public.user_profiles p where p.user_id=(select auth.uid()) and p.is_admin and p.active)
);
create policy agent_grants_revoke_self on public.agent_access_grants for update to authenticated
  using(owner_id=(select auth.uid()) and exists(select 1 from public.user_profiles p where p.user_id=(select auth.uid()) and p.is_admin and p.active))
  with check(owner_id=(select auth.uid()) and revoked_at is not null and revoked_at <= now()
    and exists(select 1 from public.user_profiles p where p.user_id=(select auth.uid()) and p.is_admin and p.active));
create policy agent_resources_read_self on public.agent_access_resources for select to authenticated using(owner_id=(select auth.uid()));
create policy agent_resources_create_self on public.agent_access_resources for insert to authenticated with check(
  owner_id=(select auth.uid())
  and exists(select 1 from public.agent_access_grants g where g.id=grant_id and g.owner_id=(select auth.uid()) and g.revoked_at is null and g.expires_at>now())
  and exists(select 1 from public.user_profiles p where p.user_id=(select auth.uid()) and p.is_admin and p.active)
  and ((resource_type='task' and exists(select 1 from public.tasks t where t.id=resource_id and t.owner_id=(select auth.uid()) and t.deleted_at is null and t.archived_at is null))
    or (resource_type='note' and exists(select 1 from public.operating_items n where n.id=resource_id and n.owner_id=(select auth.uid()) and n.item_type='note' and n.archived_at is null)))
);
create policy agent_events_read_self on public.agent_access_events for select to authenticated using(owner_id=(select auth.uid()));
create policy agent_events_manage_self on public.agent_access_events for insert to authenticated with check(
  owner_id=(select auth.uid()) and action in ('grant_created','grant_revoked')
  and exists(select 1 from public.agent_access_grants g where g.id=grant_id and g.owner_id=(select auth.uid()))
  and exists(select 1 from public.user_profiles p where p.user_id=(select auth.uid()) and p.is_admin and p.active)
);
revoke all on public.agent_access_grants,public.agent_access_resources,public.agent_access_events,public.agent_write_requests from public,anon,authenticated;
-- Hashes are not readable by browser clients, even by the owning administrator.
grant select(id,owner_id,label,key_fingerprint,create_tag_ids,created_at,expires_at,revoked_at,last_used_at) on public.agent_access_grants to authenticated;
grant insert(id,owner_id,label,token_hash,create_tag_ids,expires_at) on public.agent_access_grants to authenticated;
grant update(revoked_at) on public.agent_access_grants to authenticated;
grant select,insert on public.agent_access_resources,public.agent_access_events to authenticated;
grant all on public.agent_access_grants,public.agent_access_resources,public.agent_access_events,public.agent_write_requests to service_role;

-- Attribution is immutable and is not another task system. No FK is added to
-- legacy task rows, so Auth account deletion/cascades keep their original behavior.
alter table public.tasks add column created_by_agent_id uuid;
alter table public.operating_items add column created_by_agent_id uuid;
create index tasks_created_by_agent on public.tasks(created_by_agent_id,updated_at desc) where created_by_agent_id is not null;
create index notes_created_by_agent on public.operating_items(created_by_agent_id,updated_at desc) where created_by_agent_id is not null;
create function private.guard_agent_attribution() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='UPDATE' and new.created_by_agent_id is distinct from old.created_by_agent_id then raise exception 'AGENT_FORBIDDEN'; end if;
  if tg_op='INSERT' and new.created_by_agent_id is not null then
    if current_user <> 'service_role' or not exists(select 1 from public.agent_access_grants g where g.id=new.created_by_agent_id and g.owner_id=new.owner_id and g.revoked_at is null and g.expires_at>now()) then
      raise exception 'AGENT_FORBIDDEN';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_agent_attribution() from public,anon,authenticated;
create trigger validate_agent_attribution_tasks before insert or update of created_by_agent_id on public.tasks for each row execute function private.guard_agent_attribution();
create trigger validate_agent_attribution_notes before insert or update of created_by_agent_id on public.operating_items for each row execute function private.guard_agent_attribution();

create function public.create_my_agent_access(p_token_hash text,p_label text,p_days integer,p_task_ids uuid[],p_note_ids uuid[],p_tag_ids uuid[])
returns jsonb language plpgsql security invoker set search_path='' as $$
declare actor uuid := (select auth.uid()); new_id uuid; expiry timestamptz;
begin
  if actor is null or not exists(select 1 from public.user_profiles p where p.user_id=actor and p.is_admin and p.active) then raise exception 'AGENT_ADMIN_REQUIRED'; end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' or p_label is null or char_length(btrim(p_label)) not between 1 and 50
    or p_days is null or p_days not in (1,7,30,90) or p_task_ids is null or p_note_ids is null or p_tag_ids is null
    or cardinality(p_task_ids)>100 or cardinality(p_note_ids)>100 or cardinality(p_tag_ids) not between 1 and 20
    or array_position(p_task_ids,null) is not null or array_position(p_note_ids,null) is not null or array_position(p_tag_ids,null) is not null then raise exception 'AGENT_INVALID'; end if;
  if exists(select 1 from unnest(p_task_ids) selected(id) where not exists(select 1 from public.tasks t where t.id=selected.id and t.owner_id=actor and t.deleted_at is null and t.archived_at is null))
    or exists(select 1 from unnest(p_note_ids) selected(id) where not exists(select 1 from public.operating_items n where n.id=selected.id and n.owner_id=actor and n.item_type='note' and n.archived_at is null))
    or exists(select 1 from unnest(p_tag_ids) selected(id) where not exists(select 1 from public.personal_task_tags t where t.id=selected.id and t.user_id=actor and t.deleted_at is null)) then raise exception 'AGENT_INVALID'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text||':agent-grants',0));
  if (select count(*) from public.agent_access_grants g where g.owner_id=actor and g.revoked_at is null and g.expires_at>now()) >= 5 then raise exception 'AGENT_INVALID'; end if;
  expiry := now()+make_interval(days=>p_days);
  insert into public.agent_access_grants(owner_id,label,token_hash,create_tag_ids,expires_at)
    values(actor,btrim(p_label),p_token_hash,p_tag_ids,expiry) returning id into new_id;
  insert into public.agent_access_resources(grant_id,owner_id,resource_type,resource_id)
    select distinct new_id,actor,'task',id from unnest(p_task_ids) selected(id)
    union all select distinct new_id,actor,'note',id from unnest(p_note_ids) selected(id);
  insert into public.agent_access_events(grant_id,owner_id,action) values(new_id,actor,'grant_created');
  return jsonb_build_object('id',new_id,'label',btrim(p_label),'expires_at',expiry);
end;
$$;
create function public.revoke_my_agent_access(p_grant_id uuid) returns void language plpgsql security invoker set search_path='' as $$
declare actor uuid := (select auth.uid()); changed_id uuid;
begin
  if actor is null or not exists(select 1 from public.user_profiles p where p.user_id=actor and p.is_admin and p.active) then raise exception 'AGENT_ADMIN_REQUIRED'; end if;
  if not exists(select 1 from public.agent_access_grants where id=p_grant_id and owner_id=actor) then raise exception 'AGENT_FORBIDDEN'; end if;
  update public.agent_access_grants set revoked_at=now() where id=p_grant_id and owner_id=actor and revoked_at is null returning id into changed_id;
  if changed_id is not null then insert into public.agent_access_events(grant_id,owner_id,action) values(changed_id,actor,'grant_revoked'); end if;
end;
$$;
revoke all on function public.create_my_agent_access(text,text,integer,uuid[],uuid[],uuid[]),public.revoke_my_agent_access(uuid) from public,anon;
grant execute on function public.create_my_agent_access(text,text,integer,uuid[],uuid[],uuid[]),public.revoke_my_agent_access(uuid) to authenticated;

create function public.agent_access_operation(p_token_hash text,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  g public.agent_access_grants%rowtype;
  command_kind text; offset_value integer := 0; target_id uuid;
  item jsonb; items jsonb; total_count integer; event_kind text;
  selected_tags uuid[]; title_value text; description_value text; category_value text;
  due_value date; priority_value integer; request_uuid uuid; checksum_value text;
  previous public.agent_write_requests%rowtype;
  hk_day timestamptz := date_trunc('day',timezone('Asia/Hong_Kong',now())) at time zone 'Asia/Hong_Kong';
begin
  if current_user <> 'service_role' then raise exception 'AGENT_FORBIDDEN'; end if;
  if p_action is null or p_action not in ('status','list','detail','create_task','create_note') then raise exception 'AGENT_FORBIDDEN'; end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'AGENT_UNAUTHORIZED'; end if;
  select grant_row.* into g from public.agent_access_grants grant_row
    join public.user_profiles p on p.user_id=grant_row.owner_id and p.active and p.is_admin
    where grant_row.token_hash=p_token_hash and grant_row.revoked_at is null and grant_row.expires_at>now();
  if not found then raise exception 'AGENT_UNAUTHORIZED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(g.id::text,0));
  -- Recheck after locking: revocation/expiry are not a cached JWT claim.
  select * into g from public.agent_access_grants where id=g.id and revoked_at is null and expires_at>now() for update;
  if not found then raise exception 'AGENT_UNAUTHORIZED'; end if;
  if jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'AGENT_INVALID'; end if;

  if p_action in ('create_task','create_note') then
    if exists(select 1 from jsonb_object_keys(p_payload) field where field <> all(case when p_action='create_task' then array['request_id','title','description','due_date','priority','tag_ids'] else array['request_id','title','description','category'] end)) then raise exception 'AGENT_INVALID'; end if;
    begin request_uuid := (p_payload->>'request_id')::uuid; exception when others then raise exception 'AGENT_INVALID'; end;
    if request_uuid is null then raise exception 'AGENT_INVALID'; end if;
    checksum_value := md5(p_action||p_payload::text);
    select * into previous from public.agent_write_requests where grant_id=g.id and request_id=request_uuid;
    if found then
      if previous.payload_checksum<>checksum_value then raise exception 'AGENT_REQUEST_CONFLICT'; end if;
      return jsonb_build_object('id',previous.resource_id,'kind',previous.resource_type,'duplicate',true);
    end if;
  end if;
  if (select count(*) from public.agent_access_events where grant_id=g.id and created_at>now()-interval '1 minute') >= 60 then raise exception 'AGENT_RATE_LIMIT'; end if;
  if p_action in ('create_task','create_note') and (select count(*) from public.agent_access_events where grant_id=g.id and action in ('create_task','create_note') and created_at>=hk_day)>=50 then raise exception 'AGENT_RATE_LIMIT'; end if;

  if p_action='status' then
    if p_payload <> '{}'::jsonb then raise exception 'AGENT_INVALID'; end if;
    select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'name',t.name) order by t.name),'[]'::jsonb) into items
      from public.personal_task_tags t where t.user_id=g.owner_id and t.id=any(g.create_tag_ids) and t.deleted_at is null;
    item := jsonb_build_object('id',g.id,'label',g.label,'expiresAt',g.expires_at,'tags',items,'permissions',jsonb_build_object('read',true,'create',true,'update',false,'delete',false));
  elsif p_action in ('list','detail') then
    if exists(select 1 from jsonb_object_keys(p_payload) field where field not in ('kind','id','offset')) then raise exception 'AGENT_INVALID'; end if;
    command_kind := p_payload->>'kind';
    if command_kind is null or command_kind not in ('task','note') then raise exception 'AGENT_INVALID'; end if;
    begin
      offset_value := coalesce((p_payload->>'offset')::integer,0);
      if p_action='detail' then target_id := (p_payload->>'id')::uuid; end if;
    exception when others then raise exception 'AGENT_INVALID'; end;
    if offset_value<0 or offset_value>10000 or (p_action='detail' and target_id is null) then raise exception 'AGENT_INVALID'; end if;
    if command_kind='task' then
      if p_action='list' then
        select count(*) into total_count from public.tasks t where t.owner_id=g.owner_id and t.deleted_at is null and t.archived_at is null
          and (t.created_by_agent_id=g.id or exists(select 1 from public.agent_access_resources r where r.grant_id=g.id and r.resource_type='task' and r.resource_id=t.id));
        select coalesce(jsonb_agg(row_data order by updated_at desc,id),'[]'::jsonb) into items from (
          select t.id,t.updated_at,jsonb_build_object('id',t.id,'kind','task','title',t.title,'due_date',t.due_date,'status',t.status,'requested_priority',t.requested_priority) row_data
          from public.tasks t where t.owner_id=g.owner_id and t.deleted_at is null and t.archived_at is null
            and (t.created_by_agent_id=g.id or exists(select 1 from public.agent_access_resources r where r.grant_id=g.id and r.resource_type='task' and r.resource_id=t.id))
          order by t.updated_at desc,t.id limit 25 offset offset_value
        ) permitted;
      else
        select jsonb_build_object('id',t.id,'kind','task','title',t.title,'description',t.description,'notes',t.notes,'due_date',t.due_date,'status',t.status,'requested_priority',t.requested_priority,
          'tags',(select coalesce(jsonb_agg(jsonb_build_object('id',tag.id,'name',tag.name)),'[]'::jsonb) from public.task_tag_assignments link join public.personal_task_tags tag on tag.id=link.tag_id and tag.user_id=g.owner_id and tag.deleted_at is null where link.task_id=t.id and link.user_id=g.owner_id)) into item
        from public.tasks t where t.id=target_id and t.owner_id=g.owner_id and t.deleted_at is null and t.archived_at is null
          and (t.created_by_agent_id=g.id or exists(select 1 from public.agent_access_resources r where r.grant_id=g.id and r.resource_type='task' and r.resource_id=t.id));
      end if;
    else
      if p_action='list' then
        select count(*) into total_count from public.operating_items n where n.owner_id=g.owner_id and n.item_type='note' and n.archived_at is null
          and (n.created_by_agent_id=g.id or exists(select 1 from public.agent_access_resources r where r.grant_id=g.id and r.resource_type='note' and r.resource_id=n.id));
        select coalesce(jsonb_agg(row_data order by updated_at desc,id),'[]'::jsonb) into items from (
          select n.id,n.updated_at,jsonb_build_object('id',n.id,'kind','note','title',n.title,'category',n.metadata->>'noteCategory') row_data
          from public.operating_items n where n.owner_id=g.owner_id and n.item_type='note' and n.archived_at is null
            and (n.created_by_agent_id=g.id or exists(select 1 from public.agent_access_resources r where r.grant_id=g.id and r.resource_type='note' and r.resource_id=n.id))
          order by n.updated_at desc,n.id limit 25 offset offset_value
        ) permitted;
      else
        select jsonb_build_object('id',n.id,'kind','note','title',n.title,'description',n.description,'category',n.metadata->>'noteCategory') into item
        from public.operating_items n where n.id=target_id and n.owner_id=g.owner_id and n.item_type='note' and n.archived_at is null
          and (n.created_by_agent_id=g.id or exists(select 1 from public.agent_access_resources r where r.grant_id=g.id and r.resource_type='note' and r.resource_id=n.id));
      end if;
    end if;
    if p_action='detail' and item is null then raise exception 'AGENT_NOT_FOUND'; end if;
    item := case when p_action='list' then jsonb_build_object('items',items,'nextOffset',case when offset_value+25<total_count then offset_value+25 else null end) else jsonb_build_object('item',item) end;
  else
    if jsonb_typeof(p_payload->'title') is distinct from 'string' or (p_payload ? 'description' and jsonb_typeof(p_payload->'description') is distinct from 'string') then raise exception 'AGENT_INVALID'; end if;
    title_value := btrim(p_payload->>'title'); description_value := nullif(btrim(p_payload->>'description'),'');
    if title_value is null or char_length(title_value) not between 1 and 500 or char_length(description_value)>10000 then raise exception 'AGENT_INVALID'; end if;
    if p_action='create_task' then
      if jsonb_typeof(p_payload->'tag_ids') is distinct from 'array' or jsonb_array_length(p_payload->'tag_ids') not between 1 and 20 then raise exception 'AGENT_TAG_INVALID'; end if;
      begin
        select array_agg(distinct id::uuid) into selected_tags from jsonb_array_elements_text(p_payload->'tag_ids') selected(id);
        due_value := nullif(p_payload->>'due_date','')::date;
        priority_value := coalesce((p_payload->>'priority')::integer,3);
      exception when others then raise exception 'AGENT_INVALID'; end;
      if priority_value not in (1,3,5) or array_position(selected_tags,null) is not null
        or exists(select 1 from unnest(selected_tags) selected(id) where not(id=any(g.create_tag_ids)) or not exists(select 1 from public.personal_task_tags tag where tag.id=selected.id and tag.user_id=g.owner_id and tag.deleted_at is null)) then raise exception 'AGENT_TAG_INVALID'; end if;
      insert into public.tasks(user_id,owner_id,created_by_id,scope,area,visibility,source_type,title,description,due_date,requested_priority,status,risk,created_by_agent_id)
        values(g.owner_id,g.owner_id,g.owner_id,'home','personal','private','follow_up',title_value,description_value,due_value,priority_value,'not_started','low',g.id) returning id into target_id;
      insert into public.task_tag_assignments(user_id,task_id,tag_id) select g.owner_id,target_id,id from unnest(selected_tags) selected(id);
      command_kind := 'task';
    else
      if p_payload ? 'category' and jsonb_typeof(p_payload->'category') is distinct from 'string' then raise exception 'AGENT_INVALID'; end if;
      category_value := nullif(btrim(p_payload->>'category'),'');
      if char_length(category_value)>40 then raise exception 'AGENT_INVALID'; end if;
      insert into public.operating_items(item_type,title,description,owner_id,created_by_id,visibility,area,metadata,created_by_agent_id)
        values('note',title_value,description_value,g.owner_id,g.owner_id,'private','personal',case when category_value is null then '{}'::jsonb else jsonb_build_object('noteCategory',category_value) end,g.id) returning id into target_id;
      command_kind := 'note';
    end if;
    insert into public.agent_write_requests(grant_id,owner_id,request_id,payload_checksum,resource_type,resource_id) values(g.id,g.owner_id,request_uuid,checksum_value,command_kind,target_id);
    insert into public.activity_logs(resource_type,resource_id,actor_id,action,summary)
      values(case when command_kind='task' then 'task' else 'operating_item' end,target_id,g.owner_id,'agent_created','Grok Agent 新增資料（只讀／新增權限）');
    item := jsonb_build_object('id',target_id,'kind',command_kind,'duplicate',false);
  end if;
  update public.agent_access_grants set last_used_at=now() where id=g.id;
  event_kind := case when p_action in ('list','detail','create_task','create_note') then command_kind else null end;
  insert into public.agent_access_events(grant_id,owner_id,action,resource_type,resource_id)
    values(g.id,g.owner_id,p_action,event_kind,case when p_action in ('detail','create_task','create_note') then target_id else null end);
  return item;
end;
$$;
revoke all on function public.agent_access_operation(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.agent_access_operation(text,text,jsonb) to service_role;
comment on function public.agent_access_operation(text,text,jsonb) is 'Server-only, token-hash scoped read/create. No update/delete, no generic SQL/REST passthrough, no credentials in results.';
