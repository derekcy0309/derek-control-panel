-- Extend the existing task workflow instead of creating a second duty-request table.
alter table public.tasks
  drop constraint if exists tasks_source_type_check;

alter table public.tasks
  add constraint tasks_source_type_check
  check (source_type in ('meeting_action', 'deadline', 'follow_up', 'duty_request'));
