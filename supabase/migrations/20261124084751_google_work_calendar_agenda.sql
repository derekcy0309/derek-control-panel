-- Private opt-in for the signed-in dashboard only. Existing connections, tokens,
-- grants and owner RLS are unchanged. All prior connections remain opted out.
alter table public.google_calendar_connections
  add column show_work_in_agenda boolean not null default false,
  add constraint google_calendar_agenda_work_only
    check (target = 'work' or not show_work_in_agenda);

comment on column public.google_calendar_connections.show_work_in_agenda is
  'Owner consent to list the selected work calendar on their dashboard only; not agent access.';

-- Reset the opt-in atomically when the underlying account or selected Calendar
-- changes, even if the update is made directly through the owner-scoped Data API.
create function public.reset_google_work_agenda_consent()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  if old.account_email is distinct from new.account_email
     or old.calendar_id is distinct from new.calendar_id
     or old.user_id is distinct from new.user_id
     or old.target is distinct from new.target
     or new.status = 'disconnected' then
    new.show_work_in_agenda := false;
  end if;
  return new;
end;
$$;

revoke all on function public.reset_google_work_agenda_consent() from public, anon, authenticated;
create trigger reset_google_work_agenda_consent
  before update of account_email, calendar_id, user_id, target, status
  on public.google_calendar_connections
  for each row execute function public.reset_google_work_agenda_consent();
