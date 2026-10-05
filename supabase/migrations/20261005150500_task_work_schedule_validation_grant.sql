-- CHECK constraints run their validation helpers as the writing role.
-- This immutable helper only validates supplied dates; it reads no account data.
grant execute on function private.valid_task_work_dates(date, date, date[]) to authenticated;

-- Anonymous callers remain excluded. Task access is still enforced by tasks RLS.
revoke all on function private.valid_task_work_dates(date, date, date[]) from public, anon;
