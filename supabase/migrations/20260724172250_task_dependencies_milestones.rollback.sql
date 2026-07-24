-- Task Dependencies and Project Milestones rollback.
-- Refuse destructive rollback while feature data exists. Remove or export that
-- data intentionally before attempting a rollback.

do $$
begin
  if exists (select 1 from public.task_dependencies)
     or exists (select 1 from public.project_milestones)
     or exists (select 1 from public.tasks where project_id is not null) then
    raise exception 'DEPENDENCY_MILESTONE_ROLLBACK_REQUIRES_EXPLICIT_DATA_HANDLING';
  end if;
end;
$$;

drop table if exists public.task_dependencies;
drop table if exists public.project_milestones;
drop trigger if exists validate_task_project_reference_trigger on public.tasks;
drop function if exists private.validate_task_project_reference();
drop function if exists private.prevent_task_dependency_cycle();
drop function if exists private.prepare_project_milestone();
drop function if exists private.current_user_can_edit(text, uuid);
drop index if exists public.tasks_project_status_idx;
alter table public.tasks drop column if exists project_id;
