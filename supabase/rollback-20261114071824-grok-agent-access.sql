-- Roll the app back first. Stop new agent access without deleting data/audit.
begin;
revoke all on function public.agent_access_operation(text,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.create_my_agent_access(text,text,integer,uuid[],uuid[],uuid[]),public.revoke_my_agent_access(uuid) from public,anon,authenticated;
commit;
