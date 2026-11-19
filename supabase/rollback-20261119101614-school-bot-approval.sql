-- Manual emergency rollback, AFTER the app has been rolled back. No school
-- item, proposal or audit record is deleted. Old bot rights are not expanded.
begin;
lock table public.agent_access_grants in share row exclusive mode;
update public.agent_access_grants set revoked_at=now() where cardinality(create_tag_ids)=0 and revoked_at is null;
update public.agent_school_proposals set status='cancelled',decided_at=now() where status='pending';
revoke execute on function public.school_bot_request(text,text,jsonb) from service_role;
revoke execute on function public.school_owner_decision(text,uuid,text),private.school_owner_decision(text,uuid,text),public.create_my_school_only_bot(text,text,integer,text) from authenticated;
drop function public.agent_access_operation(text,text,jsonb);
alter function private.agent_base_operation_before_school(text,text,jsonb) rename to agent_access_operation;
alter function private.agent_access_operation(text,text,jsonb) set schema public;
alter table public.agent_access_grants drop constraint agent_access_grants_create_tag_ids_check,
 add constraint agent_access_grants_create_tag_ids_check check(cardinality(create_tag_ids) between 1 and 20 and array_position(create_tag_ids,null) is null) not valid;
commit;
