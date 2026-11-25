-- Stops new longer leases without expiring or rewriting any Code already
-- issued. Keep the scope-aware table constraint for those historical rows;
-- the original 90-day table constraint could reject their later revocation.
alter policy agent_grants_create_self on public.agent_access_grants with check (
  owner_id=(select auth.uid()) and expires_at > now() and expires_at <= now()+interval '90 days'
  and exists(select 1 from public.user_profiles p where p.user_id=(select auth.uid()) and p.is_admin and p.active)
);

create or replace function public.create_my_agent_access(p_token_hash text,p_label text,p_days integer,p_task_ids uuid[],p_note_ids uuid[],p_tag_ids uuid[])
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

create or replace function public.create_my_owner_workspace_agent(p_token_hash text,p_label text,p_days integer)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare actor uuid:=auth.uid(); new_id uuid; expiry timestamptz;
begin
  if actor is null or coalesce(auth.jwt()->>'is_anonymous','false')<>'false'
    or not exists(select 1 from public.user_profiles p where p.user_id=actor and p.is_admin and p.active)
  then raise exception 'AGENT_ADMIN_REQUIRED'; end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' or p_label is null
    or char_length(btrim(p_label)) not between 1 and 50 or p_days is null or p_days not in (1,7,30,90)
  then raise exception 'AGENT_INVALID'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text||':agent-grants',0));
  if (select count(*) from public.agent_access_grants g where g.owner_id=actor and g.revoked_at is null and g.expires_at>now())>=5
  then raise exception 'AGENT_INVALID'; end if;
  expiry:=now()+make_interval(days=>p_days);
  insert into public.agent_access_grants(owner_id,label,token_hash,create_tag_ids,expires_at,owner_workspace)
    values(actor,btrim(p_label),p_token_hash,'{}',expiry,true) returning id into new_id;
  insert into public.agent_access_events(grant_id,owner_id,action) values(new_id,actor,'grant_created');
  return jsonb_build_object('id',new_id,'label',btrim(p_label),'expires_at',expiry,'owner_workspace',true);
end $$;
