-- 2026-07-15 任務更新：
-- 1. 下一步改為可選填
-- 2. 新增完成日期及時間 completed_at
-- 3. 刪除任務改用 deleted_at，前端保留 30 日後永久刪除

alter table public.tasks
  add column if not exists completed_at timestamptz;

alter table public.tasks
  add column if not exists deleted_at timestamptz;

alter table public.tasks
  alter column next_action drop not null;

alter table public.tasks
  drop constraint if exists tasks_next_action_check;

create index if not exists tasks_deleted_at_idx on public.tasks(user_id, deleted_at);

create or replace function public.purge_deleted_tasks_older_than_30_days()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.tasks
  where deleted_at is not null
    and deleted_at < now() - interval '30 days';
$$;
