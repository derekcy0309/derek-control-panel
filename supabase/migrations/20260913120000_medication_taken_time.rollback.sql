-- Destructive rollback: exporting taken_time is required if those values must be retained.
alter table public.personal_medication_logs
  drop column if exists taken_time;

