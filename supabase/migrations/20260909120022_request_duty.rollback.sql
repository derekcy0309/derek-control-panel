-- Preserve task records while returning them to the closest legacy task type.
update public.tasks
set source_type = 'follow_up'
where source_type = 'duty_request';

alter table public.tasks
  drop constraint if exists tasks_source_type_check;

alter table public.tasks
  add constraint tasks_source_type_check
  check (source_type in ('meeting_action', 'deadline', 'follow_up'));
