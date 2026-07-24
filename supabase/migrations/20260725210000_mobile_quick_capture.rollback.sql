-- Export or explicitly remove capture files and Storage objects before rolling
-- back. This rollback never touches existing Inbox rows, tasks, or other files.
do $$
begin
  if exists (select 1 from public.inbox_capture_files limit 1)
     or exists (select 1 from public.mobile_capture_receipts limit 1) then
    raise exception 'MOBILE_QUICK_CAPTURE_ROLLBACK_REQUIRES_EXPLICIT_DATA_HANDLING';
  end if;
end;
$$;

drop function if exists public.create_mobile_capture(uuid, text, text, text, text, uuid, text);
drop policy if exists dcp_private_captures_delete_own on storage.objects;
drop policy if exists dcp_private_captures_insert_own on storage.objects;
drop policy if exists dcp_private_captures_select_own on storage.objects;
delete from storage.buckets where id = 'dcp-private-captures';
drop policy if exists inbox_capture_files_insert_owner on public.inbox_capture_files;
drop policy if exists inbox_capture_files_select_owner on public.inbox_capture_files;
drop policy if exists mobile_capture_receipts_select_owner on public.mobile_capture_receipts;
drop table if exists public.inbox_capture_files;
drop table if exists public.mobile_capture_receipts;
