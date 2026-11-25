-- New Agent Codes can queue requests, but never archive a row. Only the verified
-- human owner can confirm one current, private, unlinked record at a time.
create schema owner_workspace_archive_internal;
revoke all on schema owner_workspace_archive_internal from public, anon, authenticated, service_role;
grant usage on schema owner_workspace_archive_internal to service_role, authenticated;

create table owner_workspace_archive_internal.requests (
  id uuid primary key default gen_random_uuid(),
  grant_id uuid not null,
  owner_id uuid not null,
  kind text not null check (kind in ('task','note')),
  record_id uuid not null,
  record_version text not null check (record_version ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending' check (status in ('pending','archived','dismissed','conflict','expired','disabled')),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default (clock_timestamp() + interval '24 hours'),
  decided_at timestamptz,
  foreign key(grant_id,owner_id) references public.agent_access_grants(id,owner_id) on delete cascade
);
alter table owner_workspace_archive_internal.requests enable row level security;
revoke all on owner_workspace_archive_internal.requests from public, anon, authenticated, service_role;
grant select,insert,update on owner_workspace_archive_internal.requests to service_role;
create unique index owner_workspace_archive_pending_target
  on owner_workspace_archive_internal.requests(grant_id,kind,record_id) where status='pending';
create index owner_workspace_archive_owner_created
  on owner_workspace_archive_internal.requests(owner_id,created_at desc);

create function owner_workspace_archive_internal.active_owner(p_owner uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(
    select 1 from auth.users u join public.user_profiles p on p.user_id=u.id
    where u.id=p_owner and u.email_confirmed_at is not null and p.active and p.is_admin
  )
$$;

-- The no-sharing guard is provider-independent; it does not use Grok's
-- Derek-only grant/identity. Neither row payload nor title is persisted.
create function owner_workspace_archive_internal.target(p_owner uuid,p_kind text,p_record uuid,p_lock boolean)
returns table(version text,label text) language plpgsql security definer set search_path = '' as $$
declare t public.tasks%rowtype; n public.operating_items%rowtype;
begin
  if p_kind='task' then
    if p_lock then
      perform 1 from public.tasks where id=p_record and owner_id=p_owner for update;
    end if;
    select * into t from public.tasks
      where id=p_record and owner_id=p_owner and created_by_id=p_owner
        and visibility='private' and household_id is null
        and (assignee_id is null or assignee_id=p_owner)
        and (needs_decision_from_id is null or needs_decision_from_id=p_owner)
        and deleted_at is null and archived_at is null
        and parent_task_id is null and project_id is null and recurrence_rule_id is null
        and grok_personal_internal.is_private(p_owner,'task',p_record);
    if not found
       or exists(select 1 from public.tasks k where k.parent_task_id=t.id and k.deleted_at is null and k.archived_at is null)
       or exists(select 1 from public.task_dependencies d where d.task_id=t.id or d.depends_on_task_id=t.id)
       or exists(select 1 from public.task_recurrence_rules x where x.seed_task_id=t.id)
       or exists(select 1 from public.task_resources x where x.task_id=t.id and x.owner_id<>p_owner)
       or exists(select 1 from public.task_handoff_notes x where x.task_id=t.id and x.author_id<>p_owner)
       or exists(select 1 from public.task_checkpoints x where x.task_id=t.id and x.author_id<>p_owner)
       or exists(select 1 from public.task_steps x where x.task_id=t.id and (x.created_by_id<>p_owner or x.updated_by_id<>p_owner))
       or exists(select 1 from public.focus_sessions x where x.task_id=t.id and x.status in ('running','paused'))
    then return; end if;
    return query select encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),left(t.title,240);
  elsif p_kind='note' then
    if p_lock then
      perform 1 from public.operating_items where id=p_record and owner_id=p_owner for update;
    end if;
    select * into n from public.operating_items
      where id=p_record and owner_id=p_owner and created_by_id=p_owner and item_type='note'
        and visibility='private' and household_id is null and archived_at is null
        and (assignee_id is null or assignee_id=p_owner) and calendar_target='none'
        and grok_personal_internal.is_private(p_owner,'operating_item',p_record);
    if not found
       or exists(select 1 from public.calendar_event_links x where x.operating_item_id=n.id)
       or exists(select 1 from public.task_resources x where x.linked_item_id=n.id)
    then return; end if;
    return query select encode(sha256(convert_to(to_jsonb(n)::text,'UTF8')),'hex'),left(n.title,240);
  end if;
end
$$;

create function public.request_owner_workspace_archive(p_token_hash text,p_kind text,p_record_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare g public.agent_access_grants%rowtype; q owner_workspace_archive_internal.requests%rowtype; v text;
begin
  if current_user<>'service_role' then raise exception 'AGENT_FORBIDDEN'; end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'AGENT_UNAUTHORIZED'; end if;
  if p_kind is null or p_kind not in ('task','note') or p_record_id is null then raise exception 'AGENT_INVALID'; end if;

  select * into g from public.agent_access_grants where token_hash=p_token_hash;
  if not found or g.revoked_at is not null or g.expires_at<=clock_timestamp()
     or not owner_workspace_archive_internal.active_owner(g.owner_id) then raise exception 'AGENT_UNAUTHORIZED'; end if;
  if not g.owner_workspace then raise exception 'AGENT_FORBIDDEN'; end if;
  -- Same lock order as the rest of the Agent write API: grant first, then queue/record.
  perform pg_advisory_xact_lock(hashtextextended(g.id::text,0));
  select * into g from public.agent_access_grants
    where id=g.id and token_hash=p_token_hash and owner_workspace and revoked_at is null
      and expires_at>clock_timestamp() for update;
  if not found or not owner_workspace_archive_internal.active_owner(g.owner_id)
  then raise exception 'AGENT_UNAUTHORIZED'; end if;
  if (select count(*) from public.agent_access_events where grant_id=g.id and created_at>clock_timestamp()-interval '1 minute')>=60
  then raise exception 'AGENT_RATE_LIMIT'; end if;
  -- The per-owner queue quota must also hold for concurrent different Agents.
  perform pg_advisory_xact_lock(hashtextextended('owner-workspace-archive:'||g.owner_id::text,0));
  select t.version into v from owner_workspace_archive_internal.target(g.owner_id,p_kind,p_record_id,false) t;
  if not found then raise exception 'AGENT_NOT_FOUND'; end if;

  update owner_workspace_archive_internal.requests set status='expired',decided_at=clock_timestamp()
    where owner_id=g.owner_id and status='pending' and expires_at<=clock_timestamp();
  select * into q from owner_workspace_archive_internal.requests where grant_id=g.id
    and owner_id=g.owner_id and kind=p_kind and record_id=p_record_id and status='pending';
  if found then
    if q.record_version=v then return jsonb_build_object('requestId',q.id,'status','pending'); end if;
    update owner_workspace_archive_internal.requests set status='conflict',decided_at=clock_timestamp() where id=q.id;
  end if;
  if (select count(*) from owner_workspace_archive_internal.requests
      where owner_id=g.owner_id and created_at>clock_timestamp()-interval '24 hours')>=60
     or (select count(*) from owner_workspace_archive_internal.requests r
         join public.agent_access_grants live on live.id=r.grant_id and live.owner_id=r.owner_id
         where r.owner_id=g.owner_id and r.status='pending' and live.owner_workspace
           and live.revoked_at is null and live.expires_at>clock_timestamp())>=20
  then raise exception 'AGENT_RATE_LIMIT'; end if;
  insert into owner_workspace_archive_internal.requests(grant_id,owner_id,kind,record_id,record_version)
    values(g.id,g.owner_id,p_kind,p_record_id,v) returning * into q;
  update public.agent_access_grants set last_used_at=clock_timestamp() where id=g.id;
  insert into public.agent_access_events(grant_id,owner_id,action,resource_type,resource_id)
    values(g.id,g.owner_id,'request_archive',p_kind,p_record_id);
  return jsonb_build_object('requestId',q.id,'status','pending');
end
$$;

create function owner_workspace_archive_internal.reviews()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid:=auth.uid(); claims jsonb:=auth.jwt();
begin
  if actor is null or claims->>'role' is distinct from 'authenticated'
     or coalesce(claims->>'is_anonymous','false')<>'false'
     or not owner_workspace_archive_internal.active_owner(actor) then raise exception 'AGENT_FORBIDDEN'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'label',r.label,'kind',r.kind,
    'createdAt',r.created_at,'grantLabel',r.grant_label) order by r.created_at desc,r.id),'[]'::jsonb)
  from (
    select q.id,t.label,q.kind,q.created_at,g.label as grant_label
    from owner_workspace_archive_internal.requests q
    join public.agent_access_grants g on g.id=q.grant_id and g.owner_id=q.owner_id
    cross join lateral owner_workspace_archive_internal.target(actor,q.kind,q.record_id,false) t
    where q.owner_id=actor and q.status='pending' and q.record_version=t.version
      and q.expires_at>statement_timestamp() and g.owner_workspace
      and g.revoked_at is null and g.expires_at>statement_timestamp()
    order by q.created_at desc,q.id limit 20
  ) r);
end
$$;
create function public.owner_workspace_archive_reviews()
returns jsonb language sql security invoker set search_path = '' as $$
  select owner_workspace_archive_internal.reviews()
$$;

create function owner_workspace_archive_internal.decide(
  p_request_id uuid,p_decision text,p_session_id uuid,p_owner_ordered boolean,p_confirmation text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid:=auth.uid(); claims jsonb:=auth.jwt();
  q owner_workspace_archive_internal.requests%rowtype;
  g public.agent_access_grants%rowtype; v text; result text;
begin
  if actor is null or claims->>'role' is distinct from 'authenticated'
     or coalesce(claims->>'is_anonymous','false')<>'false'
     or not owner_workspace_archive_internal.active_owner(actor) then return jsonb_build_object('status','missing'); end if;
  if p_request_id is null or p_decision is null or p_decision not in ('confirm','dismiss')
  then return jsonb_build_object('status','invalid'); end if;
  if p_decision='confirm' then
    if p_owner_ordered is distinct from true or p_confirmation is distinct from 'archive'
    then return jsonb_build_object('status','invalid'); end if;
    if p_session_id is null or p_session_id::text is distinct from claims->>'session_id'
      or not grok_personal_internal.active_session(actor,p_session_id)
      or not exists(
        select 1 from jsonb_array_elements(case when jsonb_typeof(claims->'amr')='array' then claims->'amr' else '[]'::jsonb end) am
        where am->>'method' in ('oauth','password','otp','totp','webauthn','sso/saml')
          and case when am->>'timestamp' ~ '^[0-9]{1,11}$'
            then (am->>'timestamp')::bigint between extract(epoch from statement_timestamp()-interval '10 minutes')
                 and extract(epoch from statement_timestamp()+interval '10 seconds')
            else false end
      ) then return jsonb_build_object('status','reauth'); end if;
  end if;

  select * into q from owner_workspace_archive_internal.requests where id=p_request_id and owner_id=actor;
  if not found then return jsonb_build_object('status','missing'); end if;
  perform pg_advisory_xact_lock(hashtextextended(q.grant_id::text,0));
  select * into g from public.agent_access_grants where id=q.grant_id and owner_id=actor for update;
  select * into q from owner_workspace_archive_internal.requests where id=p_request_id and owner_id=actor for update;
  if not found or not owner_workspace_archive_internal.active_owner(actor) then return jsonb_build_object('status','missing'); end if;
  if q.status<>'pending' then return jsonb_build_object('status',q.status); end if;
  if p_decision='dismiss' then result:='dismissed';
  elsif q.expires_at<=clock_timestamp() then result:='expired';
  elsif g.id is null or not g.owner_workspace or g.revoked_at is not null or g.expires_at<=clock_timestamp()
  then result:='disabled';
  else
    select t.version into v from owner_workspace_archive_internal.target(actor,q.kind,q.record_id,true) t;
    if not found or v is distinct from q.record_version then result:='conflict';
    elsif q.kind='task' then
      update public.tasks set archived_at=clock_timestamp()
        where id=q.record_id and owner_id=actor and archived_at is null and deleted_at is null;
      result:=case when found then 'archived' else 'conflict' end;
    elsif q.kind='note' then
      update public.operating_items set archived_at=clock_timestamp()
        where id=q.record_id and owner_id=actor and item_type='note' and archived_at is null;
      result:=case when found then 'archived' else 'conflict' end;
    else result:='conflict';
    end if;
  end if;
  update owner_workspace_archive_internal.requests set status=result,decided_at=clock_timestamp() where id=q.id;
  if result='archived' then
    insert into public.activity_logs(resource_type,resource_id,actor_id,action,summary)
      values(case q.kind when 'task' then 'task' else 'operating_item' end,q.record_id,actor,
             'agent_archive_confirmed','用戶本人確認 Agent 封存請求');
  end if;
  return jsonb_build_object('status',result);
end
$$;
create function public.decide_owner_workspace_archive(
  p_request_id uuid,p_decision text,p_session_id uuid,p_owner_ordered boolean,p_confirmation text
) returns jsonb language sql security invoker set search_path = '' as $$
  select owner_workspace_archive_internal.decide(p_request_id,p_decision,p_session_id,p_owner_ordered,p_confirmation)
$$;

revoke all on all functions in schema owner_workspace_archive_internal from public, anon, authenticated, service_role;
grant execute on function owner_workspace_archive_internal.active_owner(uuid),
  owner_workspace_archive_internal.target(uuid,text,uuid,boolean) to service_role;
grant execute on function owner_workspace_archive_internal.reviews(),
  owner_workspace_archive_internal.decide(uuid,text,uuid,boolean,text) to authenticated;
revoke all on function public.request_owner_workspace_archive(text,text,uuid),
  public.owner_workspace_archive_reviews(), public.decide_owner_workspace_archive(uuid,text,uuid,boolean,text)
  from public, anon, authenticated, service_role;
grant execute on function public.request_owner_workspace_archive(text,text,uuid) to service_role;
grant execute on function public.owner_workspace_archive_reviews(),
  public.decide_owner_workspace_archive(uuid,text,uuid,boolean,text) to authenticated;
