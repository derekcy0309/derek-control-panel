-- The existing task CHECK constraint calls this pure, immutable date validator.
-- Grant only the server role permission to run it; no schema-wide usage, public,
-- anon or human permission changes, and no SECURITY DEFINER bypass.
grant execute on function private.valid_task_work_dates(date,date,date[]) to service_role;
