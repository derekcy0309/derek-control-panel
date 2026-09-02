drop function if exists public.set_task_followers(uuid, uuid[]);
drop policy if exists task_followers_select_participant on public.task_followers;
drop table if exists public.task_followers;
alter table public.tasks drop constraint if exists tasks_task_type_label_length_check;
alter table public.tasks drop column if exists task_type_label;
