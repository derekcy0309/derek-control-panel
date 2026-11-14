-- First roll back the app. Keep all original tasks/events and new audit data.
begin;
update public.agent_brief_permissions set revoked_at=coalesce(revoked_at,now());
revoke execute on function public.agent_brief_owner(text),public.save_private_calendar_snapshot(uuid,uuid,date,jsonb,timestamptz,boolean,timestamptz) from service_role;
revoke execute on function public.enable_my_agent_brief(uuid) from authenticated;
commit;
