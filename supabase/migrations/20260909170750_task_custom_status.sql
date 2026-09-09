-- Custom status is display-only. The existing constrained status column remains
-- the source of truth for planning, permissions, Waiting, Blocked and completion.
alter table public.tasks
  add column if not exists custom_status_label text;

alter table public.tasks
  drop constraint if exists tasks_custom_status_label_length_check;

alter table public.tasks
  add constraint tasks_custom_status_label_length_check
  check (
    custom_status_label is null
    or char_length(btrim(custom_status_label)) between 1 and 60
  );

comment on column public.tasks.custom_status_label is
  'Optional user-authored display label; never replaces the constrained workflow status.';
