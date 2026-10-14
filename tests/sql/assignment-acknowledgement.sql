-- Real Postgres RLS/trigger regression, NOT a mock or a privileged UPDATE.
-- Run through an administrative SQL connection. The tested writes switch to
-- authenticated + each existing actor. All fixtures/preferences/notifications
-- are rolled back in a subtransaction, even on success. No external sends.
-- Optional baseline: set test.expect_legacy_ack_failure = 'on' in this session.
do $test$
#variable_conflict use_variable
declare
  users uuid[];
  sender_id uuid;
  recipient_id uuid;
  outsider_id uuid;
  task_id uuid;
  assignment_id uuid;
  created_tasks uuid[] := '{}';
  before_row jsonb;
  receipt_time timestamptz;
  changed integer;
  blocked boolean;
  baseline boolean := coalesce(current_setting('test.expect_legacy_ack_failure', true), '') = 'on';
  result_text text := '';
begin
  select array_agg(user_id order by user_id) into users
  from (select user_id from public.user_profiles where active and handoff_enabled order by user_id limit 3) selected;
  if coalesce(array_length(users, 1), 0) < 3 then raise exception 'TEST_REQUIRES_THREE_EXISTING_ACTIVE_USERS'; end if;
  begin
    for actor_index in 1..3 loop
      sender_id := users[actor_index];
      recipient_id := users[(actor_index % 3) + 1];
      outsider_id := users[((actor_index + 1) % 3) + 1];
      execute 'set local role authenticated';
      perform set_config('request.jwt.claim.sub', sender_id::text, true);
      perform set_config('request.jwt.claims', json_build_object('sub',sender_id,'role','authenticated')::text, true);
      -- Rollback-only: deterministic notification coverage, not a settings change.
      insert into public.notification_preferences(user_id,browser_enabled,handover_enabled,quiet_hours_enabled,quiet_mode_until)
      values(sender_id,true,true,false,null)
      on conflict(user_id) do update set browser_enabled=true,handover_enabled=true,quiet_hours_enabled=false,quiet_mode_until=null;
      insert into public.tasks(user_id,owner_id,created_by_id,scope,source_type,title,area,visibility)
      values(sender_id,sender_id,sender_id,'home','follow_up','Permission regression fixture','personal','private')
      returning id into task_id;
      created_tasks := array_append(created_tasks, task_id);
      assignment_id := public.start_task_handoff(task_id,recipient_id,'Test-only handoff',null);

      perform set_config('request.jwt.claim.sub', recipient_id::text, true);
      perform set_config('request.jwt.claims', json_build_object('sub',recipient_id,'role','authenticated')::text, true);
      select to_jsonb(a) into before_row from public.assignments a where id=assignment_id;
      if before_row is null then raise exception 'RECIPIENT_CANNOT_READ_ASSIGNMENT'; end if;
      if baseline then
        blocked := false;
        begin
          update public.assignments set acknowledged_at=now() where id=assignment_id and acknowledged_at is null;
        exception when raise_exception then
          if sqlerrm <> 'ASSIGNMENT_UPDATE_FORBIDDEN' then raise; end if;
          blocked := true;
        end;
        if not blocked then raise exception 'EXPECTED_LEGACY_BUG_NOT_REPRODUCED'; end if;
        result_text := 'Legacy acknowledgement failure reproduced as authenticated recipient; all fixtures rolled back';
        raise exception using errcode='PT001', message='rollback regression fixtures';
      end if;

      -- No piggyback changes, including status/acceptance, dates or instructions.
      blocked := false;
      begin
        update public.assignments set acknowledged_at=now(),instructions='not allowed' where id=assignment_id;
      exception when raise_exception then
        if sqlerrm <> 'ASSIGNMENT_ACK_FORBIDDEN' then raise; end if;
        blocked := true;
      end;
      if not blocked then raise exception 'ACK_ALLOWED_INSTRUCTION_CHANGE'; end if;
      blocked := false;
      begin
        update public.assignments set acknowledged_at=now(),status='accepted',accepted_at=now() where id=assignment_id;
      exception when raise_exception then
        if sqlerrm <> 'ASSIGNMENT_ACK_FORBIDDEN' then raise; end if;
        blocked := true;
      end;
      if not blocked then raise exception 'ACK_AUTO_ACCEPTED_ASSIGNMENT'; end if;
      blocked := false;
      begin
        update public.assignments set acknowledged_at=now(),due_date=current_date+7 where id=assignment_id;
      exception when raise_exception then
        if sqlerrm <> 'ASSIGNMENT_ACK_FORBIDDEN' then raise; end if;
        blocked := true;
      end;
      if not blocked then raise exception 'ACK_CHANGED_DUE_DATE'; end if;

      -- Sender cannot acknowledge on behalf of the recipient.
      perform set_config('request.jwt.claim.sub', sender_id::text, true);
      perform set_config('request.jwt.claims', json_build_object('sub',sender_id,'role','authenticated')::text, true);
      blocked := false;
      begin
        update public.assignments set acknowledged_at=now() where id=assignment_id;
      exception when raise_exception then
        if sqlerrm <> 'ASSIGNMENT_ACK_FORBIDDEN' then raise; end if;
        blocked := true;
      end;
      if not blocked then raise exception 'SENDER_ACKNOWLEDGED_FOR_RECIPIENT'; end if;

      -- A third user cannot see or update either private record.
      perform set_config('request.jwt.claim.sub', outsider_id::text, true);
      perform set_config('request.jwt.claims', json_build_object('sub',outsider_id,'role','authenticated')::text, true);
      if exists(select 1 from public.assignments where id=assignment_id)
         or exists(select 1 from public.tasks where id=task_id) then raise exception 'OUTSIDER_READ_LEAK'; end if;
      update public.assignments set acknowledged_at=now() where id=assignment_id;
      get diagnostics changed=row_count;
      if changed <> 0 then raise exception 'OUTSIDER_ACKNOWLEDGED_ASSIGNMENT'; end if;

      perform set_config('request.jwt.claim.sub', recipient_id::text, true);
      perform set_config('request.jwt.claims', json_build_object('sub',recipient_id,'role','authenticated')::text, true);
      update public.assignments set acknowledged_at=now()+interval '10 years'
      where id=assignment_id and acknowledged_at is null returning acknowledged_at into receipt_time;
      if receipt_time is distinct from now() then raise exception 'ACK_NOT_SERVER_TIMESTAMP'; end if;
      if (select to_jsonb(a)-array['acknowledged_at','updated_at'] from public.assignments a where id=assignment_id)
        is distinct from (before_row-array['acknowledged_at','updated_at']) then raise exception 'ACK_CHANGED_OTHER_FIELDS'; end if;
      -- This is the exact API retry filter: a second attempt cannot enqueue twice.
      update public.assignments set acknowledged_at=now() where id=assignment_id and acknowledged_at is null;
      get diagnostics changed=row_count;
      if changed <> 0 then raise exception 'ACK_RETRY_CHANGED_RECORD'; end if;
      blocked := false;
      begin
        update public.assignments set acknowledged_at=null where id=assignment_id;
      exception when raise_exception then
        if sqlerrm <> 'ASSIGNMENT_ACK_FORBIDDEN' then raise; end if;
        blocked := true;
      end;
      if not blocked then raise exception 'ACK_REMOVAL_ALLOWED'; end if;

      perform set_config('request.jwt.claim.sub', sender_id::text, true);
      perform set_config('request.jwt.claims', json_build_object('sub',sender_id,'role','authenticated')::text, true);
      if not exists(select 1 from public.assignments where id=assignment_id and acknowledged_at=receipt_time and status='pending_acceptance') then raise exception 'SENDER_CANNOT_READ_RECEIPT'; end if;
      if (select count(*) from public.notification_deliveries where user_id=sender_id and dedupe_key='handover-acknowledged:'||assignment_id::text and generic_title='交辦已確認收到') <> 1 then raise exception 'RECEIPT_NOTIFICATION_NOT_EXACTLY_ONCE'; end if;

      -- Same writes as assignment_response/accept, including handoff note/audit.
      perform set_config('request.jwt.claim.sub', recipient_id::text, true);
      perform set_config('request.jwt.claims', json_build_object('sub',recipient_id,'role','authenticated')::text, true);
      update public.assignments set status='accepted',accepted_at=now() where id=assignment_id;
      update public.tasks set assignee_id=recipient_id where id=task_id;
      get diagnostics changed=row_count;
      if changed <> 1 then raise exception 'ACCEPT_DID_NOT_SET_CURRENT_ASSIGNEE'; end if;
      insert into public.task_handoff_notes(assignment_id,task_id,author_id,event_type,body,progress)
      values(assignment_id,task_id,recipient_id,'accepted','接受交接',0);
      insert into public.activity_logs(actor_id,resource_type,resource_id,action,summary)
      values(recipient_id,'task',task_id,'accept','回應指派');
      perform set_config('request.jwt.claim.sub', sender_id::text, true);
      perform set_config('request.jwt.claims', json_build_object('sub',sender_id,'role','authenticated')::text, true);
      if not exists(select 1 from public.assignments where id=assignment_id and status='accepted' and accepted_at is not null and acknowledged_at=receipt_time) then raise exception 'SENDER_CANNOT_READ_ACCEPTANCE'; end if;
      if not exists(select 1 from public.tasks where id=task_id and assignee_id=recipient_id) then raise exception 'ASSIGNEE_NOT_VISIBLE_TO_SENDER'; end if;
      if (select count(*) from public.notification_deliveries where user_id=sender_id and dedupe_key='handover-status:'||assignment_id::text||':accepted') <> 1 then raise exception 'ACCEPTANCE_NOTIFICATION_NOT_EXACTLY_ONCE'; end if;
      if not exists(select 1 from public.task_handoff_notes n where n.assignment_id=assignment_id and author_id=recipient_id and event_type='accepted') then raise exception 'SENDER_CANNOT_READ_ACCEPTANCE_NOTE'; end if;
      perform set_config('request.jwt.claim.sub', recipient_id::text, true);
      perform set_config('request.jwt.claims', json_build_object('sub',recipient_id,'role','authenticated')::text, true);
      update public.assignments set status='in_progress',progress=10 where id=assignment_id;
      if not exists(select 1 from public.assignments where id=assignment_id and progress=10) then raise exception 'EXISTING_PROGRESS_UPDATE_BROKEN'; end if;
      execute 'reset role';
    end loop;
    if has_function_privilege('authenticated','private.enforce_assignment_update_permission()','EXECUTE')
       or has_function_privilege('anon','private.enforce_assignment_update_permission()','EXECUTE') then raise exception 'PRIVATE_GUARD_EXPOSED'; end if;
    result_text := '3 actor rotations PASS: handoff, recipient-only receipt, unchanged fields, server timestamp, retry dedupe, sender receipt, acceptance, assignee, note/audit, sender acceptance, progress, outsider RLS; all fixtures rolled back';
    raise exception using errcode='PT001', message='rollback regression fixtures';
  exception when sqlstate 'PT001' then
    null; -- Roll back only synthetic records and temporary preferences, not DDL.
  end;
  if exists(select 1 from public.tasks where id=any(created_tasks)) then raise exception 'FIXTURE_CLEANUP_FAILED'; end if;
  perform set_config('test.assignment_ack_result',result_text,true);
end;
$test$;
select current_setting('test.assignment_ack_result') as regression_result;
