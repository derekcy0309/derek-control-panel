-- Run only after stopping the agent RPC / rolling back the app.
revoke execute on function private.valid_task_work_dates(date,date,date[]) from service_role;
