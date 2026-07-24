create table if not exists public.user_handoff_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  participant_user_id uuid not null references auth.users(id) on delete cascade,
  created_by_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint user_handoff_connections_not_self check (user_id <> participant_user_id),
  unique(user_id, participant_user_id)
);

create index if not exists user_handoff_connections_participant_idx
  on public.user_handoff_connections(participant_user_id);

alter table public.user_handoff_connections enable row level security;
drop policy if exists user_handoff_connections_select_own on public.user_handoff_connections;
create policy user_handoff_connections_select_own
on public.user_handoff_connections for select to authenticated
using (user_id = (select auth.uid()));

revoke all on public.user_handoff_connections from public, anon, authenticated;
grant select on public.user_handoff_connections to authenticated;

-- This project has an explicitly approved two-person handoff pair. Resolve the
-- stable relationship by email without hard-coding generated auth UUIDs.
with pair as (
  select
    (array_agg(id) filter (where lower(email) = 'kwok_cy@wecarenursing.com.hk'))[1] as kwok_id,
    (array_agg(id) filter (where lower(email) = 'love29suki@gmail.com'))[1] as suki_id
  from auth.users
  where lower(email) in ('kwok_cy@wecarenursing.com.hk', 'love29suki@gmail.com')
)
insert into public.user_handoff_connections(user_id, participant_user_id, created_by_id)
select kwok_id, suki_id, kwok_id from pair where kwok_id is not null and suki_id is not null
union all
select suki_id, kwok_id, kwok_id from pair where kwok_id is not null and suki_id is not null
on conflict (user_id, participant_user_id) do nothing;

create or replace function public.participant_profiles()
returns table(user_id uuid, display_name text)
language sql stable security definer set search_path = public, pg_temp as $$
  select distinct p.user_id, p.display_name
  from public.user_profiles p
  where (select auth.uid()) is not null
    and p.active
    and (
      p.user_id = (select auth.uid())
      or exists (
        select 1 from public.user_handoff_connections c
        where c.user_id = (select auth.uid()) and c.participant_user_id = p.user_id
      )
      or exists (
        select 1 from public.share_records s
        where s.revoked_at is null and
          ((s.owner_id = (select auth.uid()) and s.shared_with_user_id = p.user_id)
            or (s.shared_with_user_id = (select auth.uid()) and s.owner_id = p.user_id))
      )
      or exists (
        select 1 from public.assignments a
        where (a.assigned_by_id = (select auth.uid()) and a.assigned_to_id = p.user_id)
           or (a.assigned_to_id = (select auth.uid()) and a.assigned_by_id = p.user_id)
      )
    );
$$;
revoke all on function public.participant_profiles() from public, anon;
grant execute on function public.participant_profiles() to authenticated;
