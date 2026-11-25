-- Deploy the previous application first, then run this before rolling back the
-- companion owner_workspace grant changes. Keep the queue and review audit.
begin;
revoke execute on function public.request_owner_workspace_archive(text,text,uuid) from service_role;
revoke execute on function public.owner_workspace_archive_reviews(),
  public.decide_owner_workspace_archive(uuid,text,uuid,boolean,text) from authenticated;
revoke execute on function owner_workspace_archive_internal.reviews(),
  owner_workspace_archive_internal.decide(uuid,text,uuid,boolean,text) from authenticated;
update owner_workspace_archive_internal.requests set status='disabled',decided_at=clock_timestamp()
  where status='pending';
commit;
