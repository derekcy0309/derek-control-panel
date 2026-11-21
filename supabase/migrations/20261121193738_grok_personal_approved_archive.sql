-- Trusted Grok is separate from the legacy agent, daily brief and school grants.
-- This is additive; no person or legacy access code is enabled by this migration.
create schema grok_personal_internal;
revoke all on schema grok_personal_internal from public, anon, authenticated;
grant usage on schema grok_personal_internal to service_role, authenticated;

create table grok_personal_internal.connections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references auth.users(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  issued_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create table grok_personal_internal.archive_requests (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  connection_id uuid not null,
  dataset text not null check (dataset in ('tasks','notes','family','school','finance_transactions')),
  record_id uuid not null,
  record_version text not null,
  status text not null default 'pending' check (status in ('pending','archived','dismissed','conflict','expired','disabled')),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default (clock_timestamp() + interval '24 hours'),
  decided_at timestamptz
);
create unique index grok_personal_archive_pending
  on grok_personal_internal.archive_requests(owner_id,connection_id,dataset,record_id) where status='pending';
create index grok_personal_archive_history
  on grok_personal_internal.archive_requests(owner_id,created_at desc);
create table grok_personal_internal.connection_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  connection_id uuid not null,
  action text not null check (action in ('rotate','revoke')),
  created_at timestamptz not null default clock_timestamp()
);
create index grok_personal_connection_history on grok_personal_internal.connection_events(owner_id,created_at desc);

alter table grok_personal_internal.connections enable row level security;
alter table grok_personal_internal.archive_requests enable row level security;
alter table grok_personal_internal.connection_events enable row level security;
revoke all on all tables in schema grok_personal_internal from public, anon, authenticated;
grant select,insert,update on grok_personal_internal.connections,grok_personal_internal.archive_requests to service_role;
grant insert on grok_personal_internal.connection_events to service_role;

-- Minimal private definer checks non-exposed native Auth data. Neither identity
-- details nor session contents are given to the service or a caller.
create function grok_personal_internal.allowed_owner(p_owner_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from auth.users u join public.user_profiles p on p.user_id=u.id
    where u.id=p_owner_id and lower(u.email)='derekcy0309@gmail.com'
      and u.email_confirmed_at is not null and p.is_admin and p.active
  )
$$;
create function grok_personal_internal.active_session(p_owner_id uuid,p_session_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from auth.sessions s
    where s.id=p_session_id and s.user_id=p_owner_id
      and (s.not_after is null or s.not_after>statement_timestamp())
  )
$$;
-- Lock order for all connection mutations and decisions: owner lock, then item.
create function grok_personal_internal.lock_owner(p_owner_id uuid)
returns void language sql security invoker set search_path='' as $$
  select pg_advisory_xact_lock(hashtextextended('grok-personal:'||p_owner_id::text,0))
$$;
create function grok_personal_internal.is_private(
  p_owner_id uuid,p_resource_type text,p_record_id uuid
)
returns boolean language sql stable security invoker set search_path='' as $$
  select not exists(
    select 1 from public.share_records s where s.resource_type=p_resource_type and s.resource_id=p_record_id
      and s.shared_with_user_id<>p_owner_id and s.revoked_at is null
      and (s.expires_at is null or s.expires_at>statement_timestamp())
  ) and not exists (
    select 1 from public.joint_memberships m where m.resource_type=p_resource_type and m.resource_id=p_record_id
      and m.user_id<>p_owner_id and m.removed_at is null
  ) and not exists (
    select 1 from public.assignments a where a.resource_type=p_resource_type and a.resource_id=p_record_id
      and (a.assigned_to_id<>p_owner_id or a.assigned_by_id<>p_owner_id)
      and a.status not in ('declined','completed','cancelled')
  ) and (p_resource_type<>'task' or not exists (
    select 1 from public.task_followers f where f.task_id=p_record_id and f.follower_id<>p_owner_id
  ))
$$;
create function grok_personal_internal.unshared_ids(p_owner_id uuid,p_kind text,p_record_ids uuid[])
returns uuid[] language sql stable security definer set search_path='' as $$
  select coalesce(array_agg(r.id),'{}'::uuid[]) from (
    select t.id from public.tasks t
      where p_kind='tasks' and cardinality(p_record_ids)<=100 and t.id=any(p_record_ids)
        and t.owner_id=p_owner_id and t.created_by_id=p_owner_id
        and t.visibility='private' and t.household_id is null
        and (t.assignee_id is null or t.assignee_id=p_owner_id)
        and (t.needs_decision_from_id is null or t.needs_decision_from_id=p_owner_id)
        and t.archived_at is null and t.deleted_at is null
        and grok_personal_internal.is_private(p_owner_id,'task',t.id)
    union all
    select i.id from public.operating_items i
      where p_kind in ('notes','school','family','calendar','personal_records') and cardinality(p_record_ids)<=100 and i.id=any(p_record_ids)
        and i.owner_id=p_owner_id and i.created_by_id=p_owner_id
        and i.visibility='private' and i.household_id is null
        and (i.assignee_id is null or i.assignee_id=p_owner_id) and i.archived_at is null
        and ( (p_kind='notes' and i.item_type='note')
          or (p_kind='school' and i.item_type='school' and i.area='family')
          or (p_kind='family' and i.item_type in ('event','important_date','household','shopping','pet') and i.area='family')
          or (p_kind='calendar' and i.item_type='event')
          or (p_kind='personal_records' and i.item_type in ('health','document','vehicle') and i.area='personal') )
        and grok_personal_internal.is_private(p_owner_id,'operating_item',i.id)
  ) r where grok_personal_internal.allowed_owner(p_owner_id)
$$;
create function public.grok_personal_unshared_ids(p_owner_id uuid,p_kind text,p_record_ids uuid[])
returns uuid[] language sql stable security invoker set search_path='' as $$
  select grok_personal_internal.unshared_ids(p_owner_id,p_kind,p_record_ids)
$$;
-- Return only an immutable row fingerprint and safe display label. Labels are
-- read again for the human-only review queue; they are never written to audit.
create function grok_personal_internal.archive_target(
  p_owner_id uuid,p_dataset text,p_record_id uuid,p_lock boolean
)
returns table(version text,label text) language plpgsql security definer set search_path='' as $$
declare
  t public.tasks%rowtype;
  n public.operating_items%rowtype;
  f public.transactions%rowtype;
begin
  if not grok_personal_internal.allowed_owner(p_owner_id) then return; end if;
  if p_dataset='tasks' then
    if p_lock then perform 1 from public.tasks where id=p_record_id and owner_id=p_owner_id for update; end if;
    select * into t from public.tasks
      where id=p_record_id and owner_id=p_owner_id
        and id=any(public.grok_personal_unshared_ids(p_owner_id,p_dataset,array[p_record_id]))
        and parent_task_id is null and project_id is null and recurrence_rule_id is null;
    if not found
      or exists(select 1 from public.tasks k where k.parent_task_id=t.id and k.deleted_at is null and k.archived_at is null)
      or exists(select 1 from public.task_dependencies d where d.task_id=t.id or d.depends_on_task_id=t.id)
      or exists(select 1 from public.task_recurrence_rules x where x.seed_task_id=t.id)
      or exists(select 1 from public.task_resources x where x.task_id=t.id and x.owner_id<>p_owner_id)
      or exists(select 1 from public.task_handoff_notes x where x.task_id=t.id and x.author_id<>p_owner_id)
      or exists(select 1 from public.task_checkpoints x where x.task_id=t.id and x.author_id<>p_owner_id)
      or exists(select 1 from public.task_steps x where x.task_id=t.id and (x.created_by_id<>p_owner_id or x.updated_by_id<>p_owner_id))
      or exists(select 1 from public.focus_sessions x where x.user_id=p_owner_id and x.task_id=t.id and x.status in ('running','paused'))
    then return; end if;
    return query select encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),left(t.title,240);
  elsif p_dataset in ('notes','school','family') then
    if p_lock then perform 1 from public.operating_items where id=p_record_id and owner_id=p_owner_id for update; end if;
    select * into n from public.operating_items
      where id=p_record_id and owner_id=p_owner_id
        and id=any(public.grok_personal_unshared_ids(p_owner_id,p_dataset,array[p_record_id]))
        and calendar_target='none';
    if not found
      or exists(select 1 from public.calendar_event_links x where x.operating_item_id=n.id)
      or exists(select 1 from public.task_resources x where x.linked_item_id=n.id) then return; end if;
    return query select encode(sha256(convert_to(to_jsonb(n)::text,'UTF8')),'hex'),left(n.title,240);
  elsif p_dataset='finance_transactions' then
    if p_lock then perform 1 from public.transactions where id=p_record_id and user_id=p_owner_id for update; end if;
    select * into f from public.transactions where id=p_record_id and user_id=p_owner_id and scope='home'
      and archived_at is null and recurring_expense_rule_id is null and recurring_income_rule_id is null;
    if not found then return; end if;
    return query select encode(sha256(convert_to(to_jsonb(f)::text,'UTF8')),'hex'),
      concat_ws(' · ',left(f.item,155),case f.type when 'income' then '收入' else '支出' end ||
        ' HK$' || to_char(f.amount,'FM9999999990.00'),coalesce(f.actual_date,f.expected_date)::text);
  end if;
end
$$;

create function public.grok_personal_connection(
  p_owner_id uuid,p_action text,p_token_hash text default null,p_session_id uuid default null
)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c grok_personal_internal.connections%rowtype;
begin
  if not grok_personal_internal.allowed_owner(p_owner_id) then
    return jsonb_build_object('connected',false,'status','disabled');
  end if;
  if p_action='status' then
    select * into c from grok_personal_internal.connections where owner_id=p_owner_id
      and revoked_at is null and expires_at>clock_timestamp();
    return jsonb_build_object('connected',found,'expiresAt',c.expires_at);
  elsif p_action='rotate' then
    if not grok_personal_internal.active_session(p_owner_id,p_session_id) then
      return jsonb_build_object('connected',false,'status','reauth');
    end if;
    if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
      raise exception 'GROK_PERSONAL_INVALID';
    end if;
    perform grok_personal_internal.lock_owner(p_owner_id);
    insert into grok_personal_internal.connections(owner_id,token_hash,expires_at)
      values(p_owner_id,p_token_hash,clock_timestamp()+interval '90 days')
      on conflict(owner_id) do update set id=gen_random_uuid(),token_hash=excluded.token_hash,
        issued_at=clock_timestamp(),expires_at=excluded.expires_at,revoked_at=null
      returning * into c;
    update grok_personal_internal.archive_requests set status='disabled',decided_at=clock_timestamp()
      where owner_id=p_owner_id and status='pending';
    insert into grok_personal_internal.connection_events(owner_id,connection_id,action) values(p_owner_id,c.id,'rotate');
    return jsonb_build_object('connected',true,'expiresAt',c.expires_at);
  elsif p_action='revoke' then
    perform grok_personal_internal.lock_owner(p_owner_id);
    update grok_personal_internal.connections set revoked_at=clock_timestamp()
      where owner_id=p_owner_id and revoked_at is null returning * into c;
    if found then
      update grok_personal_internal.archive_requests set status='disabled',decided_at=clock_timestamp()
        where owner_id=p_owner_id and status='pending';
      insert into grok_personal_internal.connection_events(owner_id,connection_id,action) values(p_owner_id,c.id,'revoke');
    end if;
    return jsonb_build_object('connected',false,'expiresAt',null);
  end if;
  raise exception 'GROK_PERSONAL_INVALID';
end
$$;
create function public.grok_personal_owner(p_token_hash text)
returns jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('ownerId',c.owner_id,'connectionId',c.id)
  from grok_personal_internal.connections c
  where c.token_hash=p_token_hash and c.revoked_at is null and c.expires_at>statement_timestamp()
    and grok_personal_internal.allowed_owner(c.owner_id)
$$;
create function public.grok_personal_request_archive(p_token_hash text,p_dataset text,p_record_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c grok_personal_internal.connections%rowtype; q grok_personal_internal.archive_requests%rowtype; v text;
begin
  if p_dataset is null or p_dataset not in ('tasks','notes','school','family','finance_transactions')
    or p_record_id is null then return null; end if;
  select * into c from grok_personal_internal.connections where token_hash=p_token_hash
    and revoked_at is null and expires_at>clock_timestamp();
  if not found or not grok_personal_internal.allowed_owner(c.owner_id) then return null; end if;
  perform grok_personal_internal.lock_owner(c.owner_id);
  -- Also verify the token after locking, so a previously revoked code cannot queue.
  select * into c from grok_personal_internal.connections where token_hash=p_token_hash
    and revoked_at is null and expires_at>clock_timestamp();
  if not found or not grok_personal_internal.allowed_owner(c.owner_id) then return null; end if;
  select t.version into v from grok_personal_internal.archive_target(c.owner_id,p_dataset,p_record_id,false) t;
  if not found then return null; end if;
  update grok_personal_internal.archive_requests set status='expired',decided_at=clock_timestamp()
    where owner_id=c.owner_id and status='pending' and expires_at<=clock_timestamp();
  select * into q from grok_personal_internal.archive_requests
    where owner_id=c.owner_id and connection_id=c.id and dataset=p_dataset and record_id=p_record_id and status='pending';
  if found then
    if q.record_version=v then return jsonb_build_object('requestId',q.id,'status','pending'); end if;
    update grok_personal_internal.archive_requests set status='conflict',decided_at=clock_timestamp() where id=q.id;
  end if;
  if (select count(*) from grok_personal_internal.archive_requests where owner_id=c.owner_id
      and (status='pending' or created_at>clock_timestamp()-interval '24 hours')) >= 60
    or (select count(*) from grok_personal_internal.archive_requests where owner_id=c.owner_id and status='pending') >= 20
  then return jsonb_build_object('status','quota'); end if;
  insert into grok_personal_internal.archive_requests(owner_id,connection_id,dataset,record_id,record_version)
    values(c.owner_id,c.id,p_dataset,p_record_id,v) returning * into q;
  return jsonb_build_object('requestId',q.id,'status','pending');
end
$$;
create function public.grok_personal_archives(p_owner_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
  select coalesce(jsonb_agg(
    jsonb_build_object('id',q.id,'recordId',q.record_id,'dataset',q.dataset,
      'status',q.status,'label',t.label,'createdAt',q.created_at) order by q.created_at desc
  ),'[]'::jsonb)
  from grok_personal_internal.archive_requests q
  join grok_personal_internal.connections c on c.id=q.connection_id and c.owner_id=q.owner_id
  cross join lateral grok_personal_internal.archive_target(q.owner_id,q.dataset,q.record_id,false) t
  where q.owner_id=p_owner_id and grok_personal_internal.allowed_owner(p_owner_id)
    and q.status='pending' and q.expires_at>statement_timestamp() and q.record_version=t.version
    and c.revoked_at is null and c.expires_at>statement_timestamp()
$$;

-- Uses the original signed-in user's JWT, never the agent code or a service
-- impersonation. The caller cannot update the queue tables directly.
create function grok_personal_internal.decide_archive(
  p_owner_id uuid,p_request_id uuid,p_decision text,p_session_id uuid,p_owner_ordered boolean,p_confirmation text
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid:=auth.uid();
  claims jsonb:=auth.jwt();
  q grok_personal_internal.archive_requests%rowtype;
  result text; v text;
begin
  if actor is null or actor is distinct from p_owner_id
    or claims->>'role' is distinct from 'authenticated' or coalesce(claims->>'is_anonymous','false')<>'false'
    or not grok_personal_internal.allowed_owner(actor)
  then return jsonb_build_object('status','missing'); end if;
  if p_request_id is null or p_decision is null or p_decision not in ('confirm','dismiss')
    then return jsonb_build_object('status','invalid'); end if;
  if p_decision='confirm' then
    if p_owner_ordered is distinct from true or p_confirmation is distinct from 'archive'
      then return jsonb_build_object('status','invalid'); end if;
    if p_session_id::text is distinct from claims->>'session_id' or not grok_personal_internal.active_session(actor,p_session_id)
      or not exists(
        select 1 from jsonb_array_elements(case when jsonb_typeof(claims->'amr')='array' then claims->'amr' else '[]'::jsonb end) am
        where am->>'method' in ('oauth','password','otp','totp','webauthn','sso/saml')
          and case when am->>'timestamp' ~ '^[0-9]{1,11}$'
            then (am->>'timestamp')::bigint between extract(epoch from statement_timestamp()-interval '10 minutes')
               and extract(epoch from statement_timestamp()+interval '10 seconds')
            else false end
      ) then return jsonb_build_object('status','reauth'); end if;
  end if;
  perform grok_personal_internal.lock_owner(actor);
  select * into q from grok_personal_internal.archive_requests where owner_id=actor and id=p_request_id for update;
  if not found then return jsonb_build_object('status','missing'); end if;
  if q.status<>'pending' then return jsonb_build_object('status',q.status); end if;
  -- Archive request rows have no title/body, no externally supplied notes, and
  -- serve as a state/timestamp audit. Archive never deletes or cascades records.
  if p_decision='dismiss' then result:='dismissed';
  elsif q.expires_at<=clock_timestamp() then result:='expired';
  elsif not exists(select 1 from grok_personal_internal.connections c where c.owner_id=actor
      and c.id=q.connection_id and c.revoked_at is null and c.expires_at>clock_timestamp()) then result:='disabled';
  else
    select t.version into v from grok_personal_internal.archive_target(actor,q.dataset,q.record_id,true) t;
    if not found or v is distinct from q.record_version then result:='conflict';
    elsif q.dataset='tasks' then
      update public.tasks set archived_at=clock_timestamp()
        where id=q.record_id and owner_id=actor and archived_at is null and deleted_at is null;
      result:=case when found then 'archived' else 'conflict' end;
    elsif q.dataset in ('notes','school','family') then
      update public.operating_items set archived_at=clock_timestamp()
        where id=q.record_id and owner_id=actor and archived_at is null;
      result:=case when found then 'archived' else 'conflict' end;
    elsif q.dataset='finance_transactions' then
      update public.transactions set archived_at=clock_timestamp()
        where id=q.record_id and user_id=actor and scope='home' and archived_at is null
          and recurring_expense_rule_id is null and recurring_income_rule_id is null;
      result:=case when found then 'archived' else 'conflict' end;
    else result:='conflict';
    end if;
  end if;
  update grok_personal_internal.archive_requests set status=result,decided_at=clock_timestamp()
    where id=q.id and owner_id=actor;
  return jsonb_build_object('status',result);
end
$$;
create function public.grok_personal_decide_archive(
  p_owner_id uuid,p_request_id uuid,p_decision text,p_session_id uuid default null,
  p_owner_ordered boolean default false,p_confirmation text default null
)
returns jsonb language sql security invoker set search_path='' as $$
  select grok_personal_internal.decide_archive(p_owner_id,p_request_id,p_decision,p_session_id,p_owner_ordered,p_confirmation)
$$;

revoke all on all functions in schema grok_personal_internal from public, anon, authenticated, service_role;
grant execute on function grok_personal_internal.allowed_owner(uuid),
  grok_personal_internal.active_session(uuid,uuid),grok_personal_internal.lock_owner(uuid),
  grok_personal_internal.unshared_ids(uuid,text,uuid[]),grok_personal_internal.archive_target(uuid,text,uuid,boolean)
to service_role;
grant execute on function grok_personal_internal.decide_archive(uuid,uuid,text,uuid,boolean,text) to authenticated;
revoke all on function public.grok_personal_connection(uuid,text,text,uuid),
  public.grok_personal_owner(text),public.grok_personal_unshared_ids(uuid,text,uuid[]),
  public.grok_personal_request_archive(text,text,uuid),public.grok_personal_archives(uuid),
  public.grok_personal_decide_archive(uuid,uuid,text,uuid,boolean,text) from public, anon, authenticated, service_role;
grant execute on function public.grok_personal_connection(uuid,text,text,uuid),
  public.grok_personal_owner(text),public.grok_personal_unshared_ids(uuid,text,uuid[]),
  public.grok_personal_request_archive(text,text,uuid),public.grok_personal_archives(uuid)
to service_role;
grant execute on function public.grok_personal_decide_archive(uuid,uuid,text,uuid,boolean,text) to authenticated;

-- Bookmarks are private to their owner. Supply only the columns used by the
-- trusted summary route, not link URLs or mutation permissions.
grant select(id,title,shelf,owner_id,archived_at,updated_at) on public.dayline_web_links to service_role;
