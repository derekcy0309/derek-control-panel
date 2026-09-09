-- Rollback removes the write helper and index. The nullable last_seen_at
-- column is intentionally preserved so a rollback never deletes activity data.

drop function if exists public.touch_current_user_last_seen();
drop index if exists public.user_profiles_last_seen_at_idx;
