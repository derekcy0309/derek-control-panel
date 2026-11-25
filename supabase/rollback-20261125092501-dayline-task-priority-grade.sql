-- Roll back the app first. Retain all grade/anchor values as recovery data and
-- restore legacy priority-number editing. Leave metadata locked while paused,
-- because the existing task UPDATE policy also permits shared task editors.
drop function if exists public.promote_dayline_task_priorities();
drop function if exists public.restore_backup_v4(jsonb);
drop index if exists public.tasks_dayline_priority_escalation_idx;

create or replace function private.guard_dayline_task_priority()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.priority_grade is not null or new.priority_selected_grade is not null or new.priority_escalation_date is not null then
      raise exception 'TASK_PRIORITY_UNAVAILABLE' using errcode = '42501';
    end if;
  elsif (new.priority_grade, new.priority_selected_grade, new.priority_escalation_date)
      is distinct from (old.priority_grade, old.priority_selected_grade, old.priority_escalation_date) then
    raise exception 'TASK_PRIORITY_UNAVAILABLE' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_dayline_task_priority() from public, anon, authenticated, service_role;
