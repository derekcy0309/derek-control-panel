-- This migration installs capability only. It does not rotate credentials or
-- change any existing grant, brief permission, school scope or work record.
alter table public.agent_access_grants
  add column code_rotated_at timestamptz,
  drop constraint agent_access_grants_expiration_check,
  add constraint agent_access_grants_expiration_check check (
    (code_rotated_at is null or (
      owner_workspace and label='Grok Bot（本人工作）' and code_rotated_at>=created_at
    ))
    and expires_at>coalesce(code_rotated_at,created_at)
    and expires_at<=coalesce(code_rotated_at,created_at)+case
      when owner_workspace or cardinality(create_tag_ids)>0 then interval '365 days'
      else interval '90 days'
    end
  );
comment on column public.agent_access_grants.code_rotated_at is
  'Credential issuance epoch for the original Derek workspace/brief grant; its created_at and relationships are retained.';

alter table public.agent_access_events drop constraint agent_access_events_action_check,
  add constraint agent_access_events_action_check check (action in
    ('grant_created','grant_revoked','status','list','detail','create_task','create_note','owner_update','request_archive','code_rotated'));

-- This is not a human or Agent-caller RPC. The server verifies a recent real
-- login and explicit confirmation before forwarding the native session ID.
-- Existing private helpers independently confine it to Derek's verified,
-- active administrator account and still-active session.
create function public.rotate_owner_workspace_brief_code(
  p_owner_id uuid,p_grant_id uuid,p_expected_expires_at timestamptz,p_token_hash text,p_session_id uuid
)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare g public.agent_access_grants%rowtype; rotated timestamptz;
begin
  if current_user<>'service_role' or not grok_personal_internal.allowed_owner(p_owner_id)
  then raise exception 'AGENT_FORBIDDEN'; end if;
  if p_session_id is null or not grok_personal_internal.active_session(p_owner_id,p_session_id)
  then raise exception 'AGENT_REAUTH'; end if;
  if p_grant_id is null or p_expected_expires_at is null or not isfinite(p_expected_expires_at)
     or p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$'
  then raise exception 'AGENT_INVALID'; end if;

  -- Lock order is grant advisory lock, then grant row, then its brief row.
  -- The existing ID stays in place so the five-code cap is never exceeded.
  perform pg_advisory_xact_lock(hashtextextended(p_grant_id::text,0));
  select a.* into g from public.agent_access_grants a
    where a.id=p_grant_id and a.owner_id=p_owner_id and a.label='Grok Bot（本人工作）'
      and a.revoked_at is null and a.expires_at=p_expected_expires_at
    for update of a;
  if not found or g.expires_at<=clock_timestamp() or g.token_hash=p_token_hash
     or (not g.owner_workspace and cardinality(g.create_tag_ids)=0)
  then raise exception 'AGENT_ROTATE_CONFLICT'; end if;
  perform 1 from public.agent_brief_permissions b
    where b.grant_id=g.id and b.owner_id=g.owner_id and b.revoked_at is null for share of b;
  if not found then raise exception 'AGENT_ROTATE_CONFLICT'; end if;
  if exists (
    select 1 from public.agent_access_grants a
    join public.agent_brief_permissions b on b.grant_id=a.id and b.owner_id=a.owner_id
    where a.owner_id=g.owner_id and a.id<>g.id and a.label=g.label
      and a.revoked_at is null and a.expires_at>clock_timestamp() and b.revoked_at is null
  ) then raise exception 'AGENT_ROTATE_CONFLICT'; end if;

  rotated:=clock_timestamp();
  if g.expires_at<=rotated then raise exception 'AGENT_ROTATE_CONFLICT'; end if;
  begin
    update public.agent_access_grants a set token_hash=p_token_hash,
      owner_workspace=true,create_tag_ids='{}'::uuid[],code_rotated_at=rotated,expires_at=rotated+interval '365 days'
      where a.id=g.id and a.owner_id=g.owner_id returning a.* into g;
  exception when unique_violation then
    -- Do not reveal a duplicate hash in a PostgreSQL error detail.
    raise exception 'AGENT_ROTATE_CONFLICT';
  end;
  insert into public.agent_access_events(grant_id,owner_id,action) values(g.id,g.owner_id,'code_rotated');
  return jsonb_build_object('id',g.id,'label',g.label,'expires_at',g.expires_at,
    'owner_workspace',g.owner_workspace,'code_rotated_at',g.code_rotated_at);
end $$;
revoke all on function public.rotate_owner_workspace_brief_code(uuid,uuid,timestamptz,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.rotate_owner_workspace_brief_code(uuid,uuid,timestamptz,text,uuid) to service_role;

-- Some legacy operations first resolve a hash, lock by stable grant ID, and
-- then reload by ID only. Guard the entire dispatch with the same lock and
-- recheck the exact hash after acquiring it so an old in-flight credential
-- cannot act with the new row (including a newly expanded owner scope).
create or replace function public.agent_access_operation(p_token_hash text,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare school_only boolean; own_workspace boolean; result jsonb; archive_id uuid; grant_id_value uuid;
begin
  if current_user<>'service_role' then raise exception 'AGENT_FORBIDDEN'; end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'AGENT_UNAUTHORIZED'; end if;
  select g.id into grant_id_value from public.agent_access_grants g
    where g.token_hash=p_token_hash and g.revoked_at is null and g.expires_at>clock_timestamp();
  if not found then raise exception 'AGENT_UNAUTHORIZED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(grant_id_value::text,0));
  select cardinality(g.create_tag_ids)=0,g.owner_workspace into school_only,own_workspace
    from public.agent_access_grants g where g.id=grant_id_value and g.token_hash=p_token_hash
      and g.revoked_at is null and g.expires_at>clock_timestamp();
  if not found then raise exception 'AGENT_UNAUTHORIZED'; end if;
  if own_workspace then
    if p_action='request_archive' then
      if jsonb_typeof(p_payload) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('kind','id')) then raise exception 'AGENT_INVALID'; end if;
      begin archive_id:=(p_payload->>'id')::uuid; exception when invalid_text_representation then raise exception 'AGENT_INVALID'; end;
      return public.request_owner_workspace_archive(p_token_hash,p_payload->>'kind',archive_id);
    end if;
    return school_bot_internal.owner_workspace_agent_operation(p_token_hash,p_action,p_payload);
  end if;
  if school_only and p_action is distinct from 'status' then raise exception 'SCHOOL_ONLY'; end if;
  result:=school_bot_internal.agent_base_operation_before_school(p_token_hash,p_action,p_payload);
  if school_only then return result||jsonb_build_object('scope','school_only','permissions',jsonb_build_object('read',false,'create',false,'update',false,'delete',false)); end if;
  return result;
end $$;
