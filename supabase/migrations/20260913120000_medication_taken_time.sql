-- Optional actual administration time for each private medication log entry.
-- Existing rows remain valid and private under the table's current owner-only RLS.
alter table public.personal_medication_logs
  add column if not exists taken_time time without time zone;

