-- This rollback intentionally requires the resource rows to be exported or
-- explicitly removed first. It never touches tasks, operating_items, sharing,
-- checkpoints, or Storage objects.
do $$
begin
  if exists (select 1 from public.task_resources limit 1) then
    raise exception 'TASK_RESOURCE_PACK_ROLLBACK_REQUIRES_EXPLICIT_DATA_HANDLING';
  end if;
end;
$$;

drop trigger if exists validate_task_resource_trigger on public.task_resources;
drop policy if exists task_resources_delete_owner on public.task_resources;
drop policy if exists task_resources_update_owner on public.task_resources;
drop policy if exists task_resources_insert_owner on public.task_resources;
drop policy if exists task_resources_select_explicit on public.task_resources;
drop table if exists public.task_resources;
drop function if exists private.validate_task_resource();
