-- Deploy the previous app first. Only the new display preference is removed.
drop trigger if exists reset_google_work_agenda_consent on public.google_calendar_connections;
drop function if exists public.reset_google_work_agenda_consent();
alter table public.google_calendar_connections
  drop constraint if exists google_calendar_agenda_work_only,
  drop column if exists show_work_in_agenda;
