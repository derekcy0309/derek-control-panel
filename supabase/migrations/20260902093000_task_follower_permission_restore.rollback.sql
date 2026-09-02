-- This only removes restoration metadata. It does not delete tasks or shares.

alter table public.task_followers
  drop column if exists previous_permission;
