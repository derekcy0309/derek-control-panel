-- Roll back Body Double only. Existing tasks, checkpoints, and sharing records remain untouched.

revoke all on function public.create_body_double_session(uuid, uuid, integer, boolean) from public, anon, authenticated;
revoke all on function public.prepare_body_double_participant(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.start_body_double_session(uuid) from public, anon, authenticated;
revoke all on function public.update_body_double_presence(uuid, text) from public, anon, authenticated;
revoke all on function public.heartbeat_body_double_session(uuid) from public, anon, authenticated;
revoke all on function public.complete_body_double_participant(uuid) from public, anon, authenticated;
revoke all on function public.cancel_body_double_session(uuid) from public, anon, authenticated;

drop function if exists public.create_body_double_session(uuid, uuid, integer, boolean);
drop function if exists public.prepare_body_double_participant(uuid, uuid, boolean);
drop function if exists public.start_body_double_session(uuid);
drop function if exists public.update_body_double_presence(uuid, text);
drop function if exists public.heartbeat_body_double_session(uuid);
drop function if exists public.complete_body_double_participant(uuid);
drop function if exists public.cancel_body_double_session(uuid);
drop function if exists private.body_double_can_access_session(uuid);
drop function if exists private.touch_body_double_updated_at();

drop table if exists public.body_double_participants;
drop table if exists public.body_double_sessions;
