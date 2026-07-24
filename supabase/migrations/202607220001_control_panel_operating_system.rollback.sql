-- Emergency rollback for 202607220001.
-- This rollback intentionally keeps task columns and user_settings columns so no upgraded data is lost.
-- It removes the upgraded access model and new standalone tables after a verified backup.

drop trigger if exists enforce_task_update_permission_trigger on public.tasks;
drop trigger if exists prepare_task_identity_trigger on public.tasks;
drop trigger if exists on_auth_user_created_control_panel on auth.users;
drop trigger if exists enforce_profile_update_permission_trigger on public.user_profiles;

drop policy if exists tasks_select_authorized on public.tasks;
drop policy if exists tasks_insert_owner on public.tasks;
drop policy if exists tasks_update_authorized on public.tasks;
drop policy if exists tasks_delete_owner on public.tasks;
create policy tasks_select_own on public.tasks for select to authenticated using ((select auth.uid()) = user_id);
create policy tasks_insert_own on public.tasks for insert to authenticated with check ((select auth.uid()) = user_id);
create policy tasks_update_own on public.tasks for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy tasks_delete_own on public.tasks for delete to authenticated using ((select auth.uid()) = user_id);

drop function if exists public.resolve_share_target(text);
drop function if exists public.participant_profiles();
drop function if exists public.notification_preview(text, text);
drop function if exists public.admin_prepare_password_reset(text);

drop table if exists public.daily_capacity_checkins;
drop table if exists public.activity_logs;
drop table if exists public.share_audit_logs;
drop table if exists public.user_planning_metadata;
drop table if exists public.joint_memberships;
drop table if exists public.assignments;
drop table if exists public.share_records;
drop table if exists public.operating_items;
drop table if exists public.user_profiles;

drop function if exists private.enforce_task_update_permission();
drop function if exists private.prepare_task_identity();
drop function if exists private.enforce_operating_item_update_permission();
drop function if exists private.enforce_share_record_update_permission();
drop function if exists private.enforce_assignment_update_permission();
drop function if exists private.enforce_joint_update_permission();
drop function if exists private.enforce_profile_update_permission();
drop function if exists private.current_user_can_read(text, uuid);
drop function if exists private.handle_new_user();
