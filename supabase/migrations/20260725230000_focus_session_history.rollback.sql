-- Export or explicitly remove private Focus Session History data before rollback.
-- Existing tasks, checkpoints, Body Double sessions and time observations are preserved.
do $$
begin
  if exists (select 1 from public.focus_sessions limit 1) then
    raise exception 'FOCUS_SESSION_HISTORY_ROLLBACK_REQUIRES_EXPLICIT_DATA_HANDLING';
  end if;
end;
$$;

drop function if exists public.finish_focus_session(uuid, text, uuid, text);
drop function if exists public.resume_focus_session(uuid);
drop function if exists public.pause_focus_session(uuid);
drop function if exists public.start_focus_session(uuid, uuid, integer);
drop policy if exists focus_sessions_select_self on public.focus_sessions;
drop table if exists public.focus_sessions;
