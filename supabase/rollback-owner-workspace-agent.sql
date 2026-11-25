-- Roll back the app first. Revoke only owner-workspace codes, keeping agent
-- audit and Task/Note history. Run the companion archive rollback first.
update public.agent_access_grants set revoked_at=coalesce(revoked_at,clock_timestamp()) where owner_workspace;
revoke execute on function public.create_my_owner_workspace_agent(text,text,integer) from authenticated;
revoke insert(owner_workspace) on public.agent_access_grants from authenticated;

create or replace function public.agent_access_operation(p_token_hash text,p_action text,p_payload jsonb default '{}'::jsonb)
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

revoke execute on function school_bot_internal.owner_workspace_agent_operation(text,text,jsonb) from service_role;
revoke execute on function grok_personal_internal.is_private(uuid,text,uuid) from service_role;
