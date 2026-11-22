-- Operational rollback, for use only after the matching migration exists.
-- Stops this integration without affecting other agent keys, accounts or audit.
-- Never unarchives any record automatically; an executed owner order is retained.
begin;

revoke execute on function public.grok_personal_connection(uuid,text,text,uuid),
  public.grok_personal_owner(text), public.grok_personal_unshared_ids(uuid,text,uuid[]),
  public.grok_personal_request_archive(text,text,uuid), public.grok_personal_archives(uuid)
from service_role;
revoke execute on function public.grok_personal_decide_archive(uuid,uuid,text,uuid,boolean,text)
from authenticated;
revoke execute on function grok_personal_internal.decide_archive(uuid,uuid,text,uuid,boolean,text)
from authenticated;

with disabled as (
  update grok_personal_internal.connections set revoked_at=clock_timestamp()
    where revoked_at is null returning owner_id,id
)
insert into grok_personal_internal.connection_events(owner_id,connection_id,action)
  select owner_id,id,'revoke' from disabled;

update grok_personal_internal.archive_requests set status='disabled',decided_at=clock_timestamp()
  where status='pending';

commit;
