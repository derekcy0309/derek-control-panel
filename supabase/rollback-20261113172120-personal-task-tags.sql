-- Prefer rolling the application back first. Old app code ignores these tables.
-- Companion to production migration 20261113172120.
-- This optional stop switch disables only the new RPCs, retaining every label/link.
-- It never drops tables, deletes data, changes task ownership or changes sharing.
begin;
revoke execute on function public.ensure_my_task_tags(boolean), public.manage_my_task_tag(text,uuid,text), public.set_my_task_tags(uuid,uuid[]) from authenticated;
commit;
-- To re-enable the tested feature, grant execute on these same functions to authenticated.
