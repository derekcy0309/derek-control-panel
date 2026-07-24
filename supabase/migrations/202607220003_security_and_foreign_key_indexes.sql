alter function public.notification_preview(text, text) set search_path = public, pg_temp;

create index if not exists activity_logs_actor_idx on public.activity_logs(actor_id);
create index if not exists assignments_assigner_idx on public.assignments(assigned_by_id);
create index if not exists joint_memberships_user_idx on public.joint_memberships(user_id);
create index if not exists joint_memberships_inviter_idx on public.joint_memberships(invited_by_id);
create index if not exists operating_items_assignee_idx on public.operating_items(assignee_id);
create index if not exists operating_items_creator_idx on public.operating_items(created_by_id);
create index if not exists share_audit_logs_actor_idx on public.share_audit_logs(actor_id);
create index if not exists share_audit_logs_target_idx on public.share_audit_logs(target_user_id);
create index if not exists share_records_owner_idx on public.share_records(owner_id);
create index if not exists tasks_creator_idx on public.tasks(created_by_id);
