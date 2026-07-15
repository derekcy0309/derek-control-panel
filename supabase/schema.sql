create extension if not exists "pgcrypto";

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  scope text not null check (scope in ('home', 'company')),
  source_type text not null check (source_type in ('meeting_action', 'deadline', 'follow_up')),
  title text not null,
  owner text,
  due_date date,
  follow_up_date date,
  status text not null default 'not_started' check (status in ('not_started', 'in_progress', 'waiting', 'done', 'blocked', 'cancelled')),
  next_action text,
  risk text not null default 'low' check (risk in ('low', 'medium', 'high')),
  notes text,
  completed_at timestamptz,
  deleted_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  scope text not null check (scope in ('home', 'company')),
  type text not null check (type in ('income', 'expense')),
  item text not null,
  category text,
  amount numeric(12, 2) not null check (amount >= 0),
  expected_date date,
  actual_date date,
  frequency text not null default 'one_time' check (frequency in ('monthly', 'one_time', 'irregular')),
  status text not null,
  payment_method text,
  owner text,
  proof_url text,
  notes text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transaction_status_check check (
    (type = 'income' and status in ('expected', 'received', 'delayed', 'problem', 'cancelled'))
    or
    (type = 'expense' and status in ('unpaid', 'paid', 'problem', 'skipped', 'cancelled'))
  )
);

create table if not exists public.meetings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  scope text not null check (scope in ('home', 'company')),
  meeting_name text not null,
  meeting_date date not null,
  raw_notes text,
  summary text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.balances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  scope text not null check (scope in ('home', 'company')),
  month date not null,
  opening_balance numeric(12, 2) not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, scope, month)
);

create table if not exists public.user_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  email text,
  daily_reminder_time time not null default '09:00',
  default_reminder_days integer not null default 3 check (default_reminder_days in (7, 3, 1)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_tasks_updated_at on public.tasks;
create trigger set_tasks_updated_at before update on public.tasks for each row execute function public.set_updated_at();

drop trigger if exists set_transactions_updated_at on public.transactions;
create trigger set_transactions_updated_at before update on public.transactions for each row execute function public.set_updated_at();

drop trigger if exists set_meetings_updated_at on public.meetings;
create trigger set_meetings_updated_at before update on public.meetings for each row execute function public.set_updated_at();

drop trigger if exists set_balances_updated_at on public.balances;
create trigger set_balances_updated_at before update on public.balances for each row execute function public.set_updated_at();

drop trigger if exists set_user_settings_updated_at on public.user_settings;
create trigger set_user_settings_updated_at before update on public.user_settings for each row execute function public.set_updated_at();

create index if not exists tasks_user_scope_status_idx on public.tasks(user_id, scope, status);
create index if not exists tasks_due_follow_idx on public.tasks(user_id, due_date, follow_up_date);
create index if not exists tasks_deleted_at_idx on public.tasks(user_id, deleted_at);
create index if not exists transactions_user_scope_type_idx on public.transactions(user_id, scope, type);
create index if not exists transactions_expected_date_idx on public.transactions(user_id, expected_date);
create index if not exists meetings_user_date_idx on public.meetings(user_id, meeting_date desc);
create index if not exists balances_user_month_idx on public.balances(user_id, month desc);

alter table public.tasks enable row level security;
alter table public.transactions enable row level security;
alter table public.meetings enable row level security;
alter table public.balances enable row level security;
alter table public.user_settings enable row level security;

drop policy if exists "tasks_select_own" on public.tasks;
create policy "tasks_select_own" on public.tasks for select using (auth.uid() = user_id);
drop policy if exists "tasks_insert_own" on public.tasks;
create policy "tasks_insert_own" on public.tasks for insert with check (auth.uid() = user_id);
drop policy if exists "tasks_update_own" on public.tasks;
create policy "tasks_update_own" on public.tasks for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "tasks_delete_own" on public.tasks;
create policy "tasks_delete_own" on public.tasks for delete using (auth.uid() = user_id);

drop policy if exists "transactions_select_own" on public.transactions;
create policy "transactions_select_own" on public.transactions for select using (auth.uid() = user_id);
drop policy if exists "transactions_insert_own" on public.transactions;
create policy "transactions_insert_own" on public.transactions for insert with check (auth.uid() = user_id);
drop policy if exists "transactions_update_own" on public.transactions;
create policy "transactions_update_own" on public.transactions for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "transactions_delete_own" on public.transactions;
create policy "transactions_delete_own" on public.transactions for delete using (auth.uid() = user_id);

drop policy if exists "meetings_select_own" on public.meetings;
create policy "meetings_select_own" on public.meetings for select using (auth.uid() = user_id);
drop policy if exists "meetings_insert_own" on public.meetings;
create policy "meetings_insert_own" on public.meetings for insert with check (auth.uid() = user_id);
drop policy if exists "meetings_update_own" on public.meetings;
create policy "meetings_update_own" on public.meetings for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "meetings_delete_own" on public.meetings;
create policy "meetings_delete_own" on public.meetings for delete using (auth.uid() = user_id);

drop policy if exists "balances_select_own" on public.balances;
create policy "balances_select_own" on public.balances for select using (auth.uid() = user_id);
drop policy if exists "balances_insert_own" on public.balances;
create policy "balances_insert_own" on public.balances for insert with check (auth.uid() = user_id);
drop policy if exists "balances_update_own" on public.balances;
create policy "balances_update_own" on public.balances for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "balances_delete_own" on public.balances;
create policy "balances_delete_own" on public.balances for delete using (auth.uid() = user_id);

drop policy if exists "user_settings_select_own" on public.user_settings;
create policy "user_settings_select_own" on public.user_settings for select using (auth.uid() = user_id);
drop policy if exists "user_settings_insert_own" on public.user_settings;
create policy "user_settings_insert_own" on public.user_settings for insert with check (auth.uid() = user_id);
drop policy if exists "user_settings_update_own" on public.user_settings;
create policy "user_settings_update_own" on public.user_settings for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "user_settings_delete_own" on public.user_settings;
create policy "user_settings_delete_own" on public.user_settings for delete using (auth.uid() = user_id);
