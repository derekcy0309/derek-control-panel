-- Private read-only calendar cache. Never enters operating_items, sharing, or backup grants.
create table public.apple_calendar_connections (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null unique references auth.users(id) on delete cascade,
 account_email text not null,
 secret_ciphertext text not null,
 calendars jsonb not null default '[]' check(jsonb_typeof(calendars)='array' and jsonb_array_length(calendars)<=30),
 selected_ids text[] not null default '{}',
 status text not null default 'select_calendars' check(status in ('select_calendars','connected','attention','disconnected')),
 error_code text,
 last_attempt_at timestamptz,
 updated_at timestamptz not null default now()
);
create table public.private_calendar_snapshots (
 owner_id uuid not null references auth.users(id) on delete cascade,
 source_key uuid not null references public.apple_calendar_connections(id) on delete cascade,
 window_start date not null,
 window_end date not null,
 events jsonb not null check(jsonb_typeof(events)='array' and jsonb_array_length(events)<=200),
 fetched_at timestamptz not null,
 truncated boolean not null default false,
 primary key(owner_id,source_key),
 check(window_end=window_start+3)
);
create table public.agent_brief_permissions (
 grant_id uuid primary key,
 owner_id uuid not null,
 created_at timestamptz not null default now(),
 revoked_at timestamptz,
 foreign key(grant_id,owner_id) references public.agent_access_grants(id,owner_id) on delete cascade
);
create index agent_brief_permissions_owner on public.agent_brief_permissions(owner_id);
alter table public.apple_calendar_connections enable row level security;
alter table public.private_calendar_snapshots enable row level security;
alter table public.agent_brief_permissions enable row level security;
create policy apple_calendar_self_read on public.apple_calendar_connections for select to authenticated using(owner_id=(select auth.uid()));
create policy private_calendar_self_read on public.private_calendar_snapshots for select to authenticated using(owner_id=(select auth.uid()));
create policy agent_brief_self_read on public.agent_brief_permissions for select to authenticated using(owner_id=(select auth.uid()));
create policy agent_brief_self_insert on public.agent_brief_permissions for insert to authenticated with check(
 owner_id=(select auth.uid()) and exists(select 1 from public.user_profiles p where p.user_id=(select auth.uid()) and p.active and p.is_admin)
 and exists(select 1 from public.agent_access_grants g where g.id=grant_id and g.owner_id=(select auth.uid()) and g.revoked_at is null and g.expires_at>now())
);
create policy agent_brief_self_revoke on public.agent_brief_permissions for update to authenticated
 using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()) and revoked_at is not null and revoked_at<=now());
revoke all on public.apple_calendar_connections,public.private_calendar_snapshots,public.agent_brief_permissions from public,anon,authenticated;
grant select(id,owner_id,account_email,status,error_code,last_attempt_at,updated_at) on public.apple_calendar_connections to authenticated;
grant select on public.private_calendar_snapshots,public.agent_brief_permissions to authenticated;
grant insert(grant_id,owner_id) on public.agent_brief_permissions to authenticated;
grant update(revoked_at) on public.agent_brief_permissions to authenticated;
grant all on public.apple_calendar_connections,public.private_calendar_snapshots,public.agent_brief_permissions to service_role;

create function public.enable_my_agent_brief(p_grant_id uuid) returns void language plpgsql security invoker set search_path='' as $$
declare actor uuid:=(select auth.uid());
begin
 if actor is null or not exists(select 1 from public.user_profiles where user_id=actor and active and is_admin)
  or not exists(select 1 from public.agent_access_grants where id=p_grant_id and owner_id=actor and revoked_at is null and expires_at>now()) then raise exception 'AGENT_FORBIDDEN'; end if;
 if exists(select 1 from public.agent_brief_permissions where grant_id=p_grant_id and revoked_at is not null) then raise exception 'AGENT_FORBIDDEN'; end if;
 insert into public.agent_brief_permissions(grant_id,owner_id) values(p_grant_id,actor) on conflict do nothing;
 insert into public.agent_access_events(grant_id,owner_id,action) values(p_grant_id,actor,'grant_created');
end; $$;
revoke all on function public.enable_my_agent_brief(uuid) from public,anon;
grant execute on function public.enable_my_agent_brief(uuid) to authenticated;

create function public.agent_brief_owner(p_token_hash text) returns uuid language plpgsql security invoker set search_path='' as $$
declare g public.agent_access_grants%rowtype;
begin
 if current_user<>'service_role' then raise exception 'AGENT_FORBIDDEN'; end if;
 select a.* into g from public.agent_access_grants a join public.agent_brief_permissions b on b.grant_id=a.id and b.owner_id=a.owner_id and b.revoked_at is null
 join public.user_profiles p on p.user_id=a.owner_id and p.active and p.is_admin
 where a.token_hash=p_token_hash and a.revoked_at is null and a.expires_at>now() for update of a;
 if not found then raise exception 'AGENT_UNAUTHORIZED'; end if;
 if (select count(*) from public.agent_access_events where grant_id=g.id and created_at>now()-interval '1 minute')>=60 then raise exception 'AGENT_RATE_LIMIT'; end if;
 update public.agent_access_grants set last_used_at=now() where id=g.id;
 insert into public.agent_access_events(grant_id,owner_id,action) values(g.id,g.owner_id,'list');
 return g.owner_id;
end; $$;
revoke all on function public.agent_brief_owner(text) from public,anon,authenticated;
grant execute on function public.agent_brief_owner(text) to service_role;

create function public.save_private_calendar_snapshot(p_owner uuid,p_source uuid,p_start date,p_events jsonb,p_fetched timestamptz,p_truncated boolean,p_revision timestamptz)
returns void language plpgsql security invoker set search_path='' as $$
begin
 if current_user<>'service_role'
  or p_start is null or p_fetched is null or p_fetched>now()+interval '1 minute' or jsonb_typeof(p_events)<>'array' or jsonb_array_length(p_events)>200 then raise exception 'CALENDAR_FORBIDDEN'; end if;
 perform 1 from public.apple_calendar_connections where id=p_source and owner_id=p_owner and status<>'disconnected' and updated_at=p_revision for update;
 if not found then raise exception 'CALENDAR_FORBIDDEN'; end if;
 insert into public.private_calendar_snapshots(owner_id,source_key,window_start,window_end,events,fetched_at,truncated)
 values(p_owner,p_source,p_start,p_start+3,p_events,p_fetched,p_truncated)
 on conflict(owner_id,source_key) do update set window_start=excluded.window_start,window_end=excluded.window_end,events=excluded.events,fetched_at=excluded.fetched_at,truncated=excluded.truncated
 where public.private_calendar_snapshots.fetched_at<=excluded.fetched_at;
end; $$;
revoke all on function public.save_private_calendar_snapshot(uuid,uuid,date,jsonb,timestamptz,boolean,timestamptz) from public,anon,authenticated;
grant execute on function public.save_private_calendar_snapshot(uuid,uuid,date,jsonb,timestamptz,boolean,timestamptz) to service_role;

-- Only a separately opted-in brief grant sees future OWN tasks. Owner predicates
-- in the existing read RPC remain in place; Notes and write capabilities do not expand.
do $$ declare definition text; needle text:='t.created_by_agent_id=g.id or exists';
begin
 select pg_get_functiondef('public.agent_access_operation(text,text,jsonb)'::regprocedure) into definition;
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>3 then raise exception 'Agent RPC drift: review instead of replacing'; end if;
 definition:=replace(definition,needle,'exists(select 1 from public.agent_brief_permissions b where b.grant_id=g.id and b.owner_id=g.owner_id and b.revoked_at is null) or t.created_by_agent_id=g.id or exists');
 execute definition;
end; $$;
create index tasks_private_brief_due on public.tasks(owner_id,due_date) where deleted_at is null and archived_at is null and status not in ('done','cancelled');
