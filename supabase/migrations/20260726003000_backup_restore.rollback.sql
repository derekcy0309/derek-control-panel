-- Refuse to discard the audit trail. Remove audit rows deliberately before
-- rolling back this migration in an empty/non-production environment.
do $$
begin
  if exists (select 1 from public.backup_restore_audit_logs limit 1) then
    raise exception 'BACKUP_RESTORE_AUDIT_EXISTS';
  end if;
end;
$$;

drop function if exists public.restore_backup_v1(jsonb);
drop table if exists public.backup_restore_audit_logs;
