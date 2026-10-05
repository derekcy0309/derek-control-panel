-- Restores the former grant state; scheduled task writes will fail again.
-- No task records or selected work dates are modified.
revoke execute on function private.valid_task_work_dates(date, date, date[]) from authenticated;
