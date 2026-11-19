-- Separate opt-in for each existing bot, independent of daily-brief permission.
-- No existing grant, school item, account, or calendar is changed by this migration.
create table public.agent_school_scopes (
  grant_id uuid primary key, owner_id uuid not null, generation uuid not null default gen_random_uuid(),
  mode text not null check (mode in ('redact','omit')),
  foreign key (grant_id,owner_id) references public.agent_access_grants(id,owner_id) on delete cascade
);
create table public.agent_school_proposals (
  id uuid primary key default gen_random_uuid(), grant_id uuid not null, owner_id uuid not null,
  generation uuid not null, request_id uuid not null, fingerprint text not null,
  operation text not null check(operation in ('create','update','delete')), item_id uuid,
  base_version timestamptz, before_fields jsonb, changes jsonb not null,
  status text not null default 'pending' check(status in ('pending','approved','rejected','cancelled')),
  created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '7 days',
  decided_at timestamptz, unique(grant_id,request_id),
  foreign key (grant_id,owner_id) references public.agent_access_grants(id,owner_id) on delete cascade
);
create table public.agent_school_events (
  id uuid primary key default gen_random_uuid(), grant_id uuid not null, owner_id uuid not null,
  action text not null check(action in ('enable','disable','list','brief','propose','approve','reject')),
  proposal_id uuid, created_at timestamptz not null default now(),
  foreign key(grant_id,owner_id) references public.agent_access_grants(id,owner_id) on delete cascade
);
create index school_proposals_owner_queue on public.agent_school_proposals(owner_id,status,created_at,id);
create index school_events_quota on public.agent_school_events(grant_id,created_at desc);
create index school_bot_due on public.operating_items(owner_id,due_date,id)
 where item_type='school' and area='family' and archived_at is null and status not in ('completed','cancelled');
alter table public.agent_school_scopes enable row level security;
alter table public.agent_school_proposals enable row level security;
alter table public.agent_school_events enable row level security;
revoke all on public.agent_school_scopes,public.agent_school_proposals,public.agent_school_events from public,anon,authenticated,service_role;
create policy school_scope_self on public.agent_school_scopes for select to authenticated using(owner_id=(select auth.uid()));
create policy school_proposal_self on public.agent_school_proposals for select to authenticated using(owner_id=(select auth.uid()));
create policy school_event_self on public.agent_school_events for select to authenticated using(owner_id=(select auth.uid()));
grant select(grant_id,owner_id,mode) on public.agent_school_scopes to authenticated;
grant select(id,grant_id,owner_id,operation,before_fields,changes,status,created_at,expires_at,decided_at) on public.agent_school_proposals to authenticated;
grant select on public.agent_school_events to authenticated;
grant select on public.agent_school_scopes to service_role;
grant select,insert on public.agent_school_proposals,public.agent_school_events to service_role;

-- All bot writes terminate in the proposal table. A bot cannot execute the decision RPC.
create function public.school_bot_request(p_token_hash text,p_action text,p_data jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare g public.agent_access_grants%rowtype; s public.agent_school_scopes%rowtype;
 q public.agent_school_proposals%rowtype; i public.operating_items%rowtype;
 off_n integer; rows_json jsonb; hk date:=(now() at time zone 'Asia/Hong_Kong')::date;
 cmd text; rid uuid; target uuid; patch jsonb; digest_value text; before_json jsonb; version_value timestamptz;
begin
 if current_user<>'service_role' or p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'SCHOOL_AUTH'; end if;
 if p_action is null or p_action not in ('list','brief','propose') or jsonb_typeof(p_data) is distinct from 'object' then raise exception 'SCHOOL_INVALID'; end if;
 select a.* into g from public.agent_access_grants a join public.user_profiles u on u.user_id=a.owner_id and u.is_admin and u.active
 where a.token_hash=p_token_hash and a.revoked_at is null and a.expires_at>clock_timestamp() for update of a;
 if not found then raise exception 'SCHOOL_AUTH'; end if;
 select * into s from public.agent_school_scopes where grant_id=g.id and owner_id=g.owner_id;
 if not found then
   if p_action='brief' then return jsonb_build_object('enabled',false); end if;
   raise exception 'SCHOOL_OFF';
 end if;
 if p_action='brief' and not exists(select 1 from public.agent_brief_permissions b where b.grant_id=g.id and b.owner_id=g.owner_id and b.revoked_at is null) then raise exception 'SCHOOL_OFF'; end if;
 if (select count(*) from public.agent_school_events where grant_id=g.id and created_at>now()-interval '1 minute')>=60 then raise exception 'SCHOOL_RATE'; end if;
 if p_action in ('list','brief') then
   if p_data - 'offset'<>'{}'::jsonb or (p_action='brief' and p_data<>'{}'::jsonb) then raise exception 'SCHOOL_INVALID'; end if;
   off_n:=coalesce((p_data->>'offset')::integer,0);
   if off_n not between 0 and 10000 then raise exception 'SCHOOL_INVALID'; end if;
   select coalesce(jsonb_agg(x.entry order by x.due_date nulls last,x.id),'[]'::jsonb) into rows_json from (
     select n.due_date,n.id,jsonb_build_object('title',case when n.sensitive is not false then '學校事項' else left(regexp_replace(n.title,'[[:cntrl:]]+',' ','g'),120) end,'date',n.due_date)
       || case when p_action='list' then jsonb_build_object('id',n.id,'version',n.updated_at) else '{}'::jsonb end as entry
     from public.operating_items n where n.owner_id=g.owner_id and n.item_type='school' and n.area='family' and n.archived_at is null
     and n.status not in ('completed','cancelled') and (s.mode='redact' or n.sensitive is false)
     and (p_action='list' or (n.due_date>=hk and n.due_date<hk+3)) order by n.due_date nulls last,n.id limit 26 offset off_n
   ) x;
   insert into public.agent_school_events(grant_id,owner_id,action) values(g.id,g.owner_id,p_action);
   return jsonb_build_object('enabled',true,'items',rows_json-25,'more',jsonb_array_length(rows_json)>25);
 end if;
 if p_data - array['operation','requestId','itemId','version','changes']<>'{}'::jsonb then raise exception 'SCHOOL_INVALID'; end if;
 cmd:=p_data->>'operation'; rid:=(p_data->>'requestId')::uuid; patch:=p_data->'changes';
 if cmd is null or cmd not in ('create','update','delete') or rid is null or jsonb_typeof(patch) is distinct from 'object' or patch-array['title','date']<>'{}'::jsonb then raise exception 'SCHOOL_INVALID'; end if;
 if (cmd in ('create','update') and patch='{}'::jsonb) or (cmd='create' and (not patch?'title' or p_data ?| array['itemId','version']))
 or (cmd='delete' and patch<>'{}'::jsonb) then raise exception 'SCHOOL_INVALID'; end if;
 if patch?'title' and (jsonb_typeof(patch->'title')<>'string' or length(btrim(patch->>'title')) not between 1 and 120 or (patch->>'title') ~ '[[:cntrl:]]') then raise exception 'SCHOOL_INVALID'; end if;
 if patch?'date' and patch->'date'<>'null'::jsonb and (jsonb_typeof(patch->'date')<>'string' or (patch->>'date')!~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or to_char((patch->>'date')::date,'YYYY-MM-DD')<>patch->>'date') then raise exception 'SCHOOL_INVALID'; end if;
 digest_value:=encode(sha256(convert_to(p_data::text,'UTF8')),'hex');
 select * into q from public.agent_school_proposals where grant_id=g.id and request_id=rid;
 if found then
   if q.fingerprint<>digest_value or q.generation<>s.generation then raise exception 'SCHOOL_CONFLICT'; end if;
   return jsonb_build_object('proposalId',q.id,'status',q.status,'duplicate',true);
 end if;
 if (select count(*) from public.agent_school_events where grant_id=g.id and action='propose' and created_at>now()-interval '24 hours')>=50 then raise exception 'SCHOOL_RATE'; end if;
 if cmd<>'create' then
   target:=(p_data->>'itemId')::uuid; version_value:=(p_data->>'version')::timestamptz;
   if target is null or version_value is null then raise exception 'SCHOOL_INVALID'; end if;
   select * into i from public.operating_items n where n.id=target and n.owner_id=g.owner_id and n.item_type='school' and n.area='family'
    and n.archived_at is null and n.status not in ('completed','cancelled') and (s.mode='redact' or n.sensitive is false) for share;
   if not found then raise exception 'SCHOOL_MISSING'; end if;
   if i.updated_at is distinct from version_value then raise exception 'SCHOOL_CONFLICT'; end if;
   -- This before image is for the signed-in human only; never returned to the bot.
   before_json:=jsonb_build_object('title',i.title,'date',i.due_date);
 end if;
 insert into public.agent_school_proposals(grant_id,owner_id,generation,request_id,fingerprint,operation,item_id,base_version,before_fields,changes)
 values(g.id,g.owner_id,s.generation,rid,digest_value,cmd,target,version_value,before_json,patch) returning id into q.id;
 insert into public.agent_school_events(grant_id,owner_id,action,proposal_id) values(g.id,g.owner_id,'propose',q.id);
 return jsonb_build_object('proposalId',q.id,'status','pending','duplicate',false);
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then raise exception 'SCHOOL_INVALID';
end $$;
revoke all on function public.school_bot_request(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.school_bot_request(text,text,jsonb) to service_role;

-- Deliberately a private definer: people have SELECT but no direct write on the
-- consent/decision tables. One checked transaction changes a row AND its audit.
create function private.school_owner_decision(p_action text,p_id uuid,p_mode text)
returns text language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); claims jsonb:=auth.jwt(); gid uuid; g public.agent_access_grants%rowtype;
 s public.agent_school_scopes%rowtype; q public.agent_school_proposals%rowtype; i public.operating_items%rowtype;
begin
 if actor is null or claims->>'role' is distinct from 'authenticated' or coalesce((claims->>'is_anonymous')::boolean,false)
 or not exists(select 1 from public.user_profiles u where u.user_id=actor and u.is_admin and u.active)
 then raise exception 'SCHOOL_OWNER'; end if;
 if p_action is null or p_action not in ('scope','approve','reject') or p_id is null or
   (p_action='scope' and (p_mode is null or p_mode not in ('off','redact','omit'))) or (p_action<>'scope' and p_mode is not null) then raise exception 'SCHOOL_INVALID'; end if;
 if (p_action='approve' or (p_action='scope' and p_mode<>'off')) and (
   not exists(select 1 from auth.sessions z where z.id::text=claims->>'session_id' and z.user_id=actor and (z.not_after is null or z.not_after>now()))
   or not exists(select 1 from jsonb_array_elements(coalesce(claims->'amr','[]'::jsonb)) am
     where am->>'method' in ('oauth','password','otp','totp','webauthn','sso/saml')
     and case when am->>'timestamp' ~ '^[0-9]{1,11}$' then (am->>'timestamp')::bigint between extract(epoch from now()-interval '10 minutes') and extract(epoch from now()+interval '10 seconds') else false end)
 ) then raise exception 'SCHOOL_REAUTH'; end if;
 if p_action='scope' then gid:=p_id;
 else
   select grant_id into gid from public.agent_school_proposals where id=p_id and owner_id=actor;
   if not found then raise exception 'SCHOOL_MISSING'; end if;
 end if;
 select * into g from public.agent_access_grants where id=gid and owner_id=actor for update;
 if not found then raise exception 'SCHOOL_MISSING'; end if;
 select * into s from public.agent_school_scopes where grant_id=g.id and owner_id=actor;
 if p_action='scope' then
   if p_mode<>'off' and (g.revoked_at is not null or g.expires_at<=clock_timestamp()) then raise exception 'SCHOOL_OFF'; end if;
   if coalesce(s.mode,'off')=p_mode then return p_mode; end if;
   update public.agent_school_proposals set status='cancelled',decided_at=now() where grant_id=g.id and owner_id=actor and status='pending';
   if p_mode='off' then delete from public.agent_school_scopes where grant_id=g.id and owner_id=actor;
   else insert into public.agent_school_scopes(grant_id,owner_id,mode) values(g.id,actor,p_mode)
      on conflict(grant_id) do update set generation=gen_random_uuid(),mode=excluded.mode;
   end if;
   insert into public.agent_school_events(grant_id,owner_id,action) values(g.id,actor,case when p_mode='off' then 'disable' else 'enable' end);
   return p_mode;
 end if;
 select * into q from public.agent_school_proposals where id=p_id and owner_id=actor and grant_id=g.id for update;
 if q.status='approved' and p_action='approve' then return 'approved'; end if;
 if q.status='rejected' and p_action='reject' then return 'rejected'; end if;
 if q.status<>'pending' then raise exception 'SCHOOL_CONFLICT'; end if;
 if p_action='reject' then
   update public.agent_school_proposals set status='rejected',decided_at=now() where id=q.id;
 else
   if s.generation is distinct from q.generation or g.revoked_at is not null or g.expires_at<=clock_timestamp() or q.expires_at<=clock_timestamp() then raise exception 'SCHOOL_OFF'; end if;
   if q.operation='create' then
     insert into public.operating_items(owner_id,created_by_id,item_type,area,visibility,status,sensitive,title,due_date)
     values(actor,actor,'school','family','private','active',true,btrim(q.changes->>'title'),(q.changes->>'date')::date) returning id into q.item_id;
   else
     select * into i from public.operating_items n where n.id=q.item_id and n.owner_id=actor and n.item_type='school' and n.area='family'
      and n.archived_at is null and n.status not in ('completed','cancelled') and (s.mode='redact' or n.sensitive is false) for update;
     if not found or i.updated_at is distinct from q.base_version or q.before_fields is distinct from jsonb_build_object('title',i.title,'date',i.due_date) then raise exception 'SCHOOL_CONFLICT'; end if;
     if q.operation='delete' then
       update public.operating_items set archived_at=clock_timestamp(),updated_at=clock_timestamp() where id=i.id and owner_id=actor;
     else
       update public.operating_items set title=case when q.changes?'title' then btrim(q.changes->>'title') else i.title end,
         due_date=case when q.changes?'date' then (q.changes->>'date')::date else i.due_date end,updated_at=clock_timestamp() where id=i.id and owner_id=actor;
     end if;
   end if;
   update public.agent_school_proposals set status='approved',item_id=q.item_id,decided_at=now() where id=q.id;
 end if;
 insert into public.agent_school_events(grant_id,owner_id,action,proposal_id) values(g.id,actor,p_action,q.id);
 return case when p_action='approve' then 'approved' else 'rejected' end;
end $$;
revoke all on function private.school_owner_decision(text,uuid,text) from public,anon,service_role;
grant execute on function private.school_owner_decision(text,uuid,text) to authenticated;
create function public.school_owner_decision(p_action text,p_id uuid,p_mode text default null)
returns text language sql security invoker set search_path='' as $$ select private.school_owner_decision(p_action,p_id,p_mode) $$;
revoke all on function public.school_owner_decision(text,uuid,text) from public,anon,service_role;
grant execute on function public.school_owner_decision(text,uuid,text) to authenticated;

-- Empty tag grants are new, school-only credentials. Existing grants have at
-- least one tag: no backfill and no change to their Task/Notes permissions.
alter table public.agent_access_grants drop constraint agent_access_grants_create_tag_ids_check,
 add constraint agent_access_grants_create_tag_ids_check check(cardinality(create_tag_ids) between 0 and 20 and array_position(create_tag_ids,null) is null);
create function public.create_my_school_only_bot(p_hash text,p_label text,p_days integer,p_mode text)
returns uuid language plpgsql security invoker set search_path='' as $$
declare actor uuid:=auth.uid(); gid uuid;
begin
 if actor is null or not exists(select 1 from public.user_profiles where user_id=actor and is_admin and active) then raise exception 'SCHOOL_OWNER'; end if;
 if p_hash is null or p_hash !~ '^[0-9a-f]{64}$' or p_label is null or length(btrim(p_label)) not between 1 and 50
   or p_days is null or p_days not in (1,7,30,90) or p_mode is null or p_mode not in ('redact','omit') then raise exception 'SCHOOL_INVALID'; end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text||':agent-grants',0));
 if (select count(*) from public.agent_access_grants where owner_id=actor and revoked_at is null and expires_at>now())>=5 then raise exception 'SCHOOL_GRANT_LIMIT'; end if;
 insert into public.agent_access_grants(owner_id,label,token_hash,create_tag_ids,expires_at)
 values(actor,btrim(p_label),p_hash,'{}'::uuid[],now()+make_interval(days=>p_days)) returning id into gid;
 insert into public.agent_access_events(grant_id,owner_id,action) values(gid,actor,'grant_created');
 perform public.school_owner_decision('scope',gid,p_mode);
 return gid;
end $$;
revoke all on function public.create_my_school_only_bot(text,text,integer,text) from public,anon,service_role;
grant execute on function public.create_my_school_only_bot(text,text,integer,text) to authenticated;

-- Keep the original, audited implementation intact and inaccessible via the
-- public Data API. New school-only codes may use it to authenticate, never CRUD.
-- Hosted service_role has no USAGE on the app's private schema. Do not
-- broaden it: keep precisely one legacy entry point in an unexposed schema.
create schema school_bot_internal;
revoke all on schema school_bot_internal from public,anon,authenticated,service_role;
grant usage on schema school_bot_internal to service_role;
alter function public.agent_access_operation(text,text,jsonb) set schema school_bot_internal;
alter function school_bot_internal.agent_access_operation(text,text,jsonb) rename to agent_base_operation_before_school;
create function public.agent_access_operation(p_token_hash text,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare school_only boolean; result jsonb;
begin
 if current_user<>'service_role' then raise exception 'AGENT_FORBIDDEN'; end if;
 select cardinality(g.create_tag_ids)=0 into school_only from public.agent_access_grants g where g.token_hash=p_token_hash;
 if school_only and p_action is distinct from 'status' then raise exception 'SCHOOL_ONLY'; end if;
 result:=school_bot_internal.agent_base_operation_before_school(p_token_hash,p_action,p_payload);
 if school_only then return result||jsonb_build_object('scope','school_only','permissions',jsonb_build_object('read',false,'create',false,'update',false,'delete',false)); end if;
 return result;
end $$;
revoke all on function public.agent_access_operation(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.agent_access_operation(text,text,jsonb) to service_role;
create function private.school_only_no_calendar() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.revoked_at is null and exists(select 1 from public.agent_access_grants where id=new.grant_id and cardinality(create_tag_ids)=0) then raise exception 'SCHOOL_ONLY'; end if;
 return new;
end $$;
create trigger school_only_no_calendar before insert or update on public.agent_brief_permissions for each row execute function private.school_only_no_calendar();
revoke all on function private.school_only_no_calendar() from public,anon,authenticated,service_role;
