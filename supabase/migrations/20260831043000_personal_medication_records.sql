-- Private personal medication records. This table deliberately has no sharing
-- path and no notification integration so health information stays private.
create table if not exists public.personal_medication_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entry_date date not null default (timezone('Asia/Hong_Kong', now()))::date,
  medication text not null check (char_length(btrim(medication)) between 1 and 120),
  dosage text not null check (char_length(btrim(dosage)) between 1 and 80),
  effect text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists personal_medication_logs_user_date_idx
  on public.personal_medication_logs(user_id, entry_date desc, created_at desc);

drop trigger if exists personal_medication_logs_set_updated_at on public.personal_medication_logs;
create trigger personal_medication_logs_set_updated_at
before update on public.personal_medication_logs
for each row execute function public.set_updated_at();

alter table public.personal_medication_logs enable row level security;

drop policy if exists personal_medication_logs_select_own on public.personal_medication_logs;
create policy personal_medication_logs_select_own on public.personal_medication_logs
for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists personal_medication_logs_insert_own on public.personal_medication_logs;
create policy personal_medication_logs_insert_own on public.personal_medication_logs
for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists personal_medication_logs_update_own on public.personal_medication_logs;
create policy personal_medication_logs_update_own on public.personal_medication_logs
for update to authenticated using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists personal_medication_logs_delete_own on public.personal_medication_logs;
create policy personal_medication_logs_delete_own on public.personal_medication_logs
for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.personal_medication_logs from anon;
grant select, insert, update, delete on public.personal_medication_logs to authenticated;
