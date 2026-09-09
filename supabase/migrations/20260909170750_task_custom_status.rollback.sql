alter table public.tasks
  drop constraint if exists tasks_custom_status_label_length_check;

alter table public.tasks
  drop column if exists custom_status_label;
