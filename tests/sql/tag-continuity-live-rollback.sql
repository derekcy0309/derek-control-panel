-- Privileged QA runner only. Supply dcp.qa.user_ids inside this transaction.
-- Uses the REAL V1/V2/V3 chain and authenticated RLS, then rolls EVERYTHING back.
-- Never replace ROLLBACK with COMMIT. Only synthetic fixtures are written.
begin;
do $qa$
declare
  actor uuid;
  seed uuid;
  rule_id uuid;
  own_tag_uuid uuid;
  next_id uuid;
  restored_id uuid;
  restored_tag uuid;
  previous_task uuid;
  previous_tag uuid;
  value jsonb;
  result jsonb;
begin
  foreach actor in array string_to_array(current_setting('dcp.qa.user_ids'), ',')::uuid[] loop
    perform set_config('request.jwt.claim.sub', actor::text, true);
    perform set_config('request.jwt.claims', jsonb_build_object('sub',actor,'role','authenticated')::text, true);
    execute 'set local role authenticated';
    if (select auth.uid()) is distinct from actor or current_user <> 'authenticated' then raise exception 'QA_ROLE_INVALID'; end if;
    seed := gen_random_uuid(); rule_id := gen_random_uuid();
    insert into public.tasks(id,user_id,owner_id,created_by_id,scope,area,source_type,title,due_date)
      values(seed,actor,actor,actor,'home','personal','follow_up','QA tag continuity (rollback)',current_date + 1);
    select (public.manage_my_task_tag('create',null,'QA ' || left(seed::text,8))).id into own_tag_uuid;
    perform public.set_my_task_tags(seed,array[own_tag_uuid]);
    insert into public.task_recurrence_rules(id,seed_task_id,owner_id,created_by_id,frequency,template)
      values(rule_id,seed,actor,actor,'daily',jsonb_build_object('title','QA routine (rollback)','scope','home','area','personal','sourceType','follow_up','risk','low'));
    update public.tasks set recurrence_rule_id=rule_id where id=seed;
    update public.tasks set status='done' where id=seed;
    select generated_task_id into next_id from public.task_recurrence_generations where source_task_id=seed;
    if next_id is null or (select count(*) from public.task_tag_assignments link where link.user_id=actor and link.task_id=next_id and link.tag_id=own_tag_uuid) <> 1 then
      raise exception 'QA_RECURRENCE_TAG_INHERITANCE_FAILED';
    end if;
    update public.tasks set status='done' where id=seed;
    if (select count(*) from public.task_recurrence_generations where source_task_id=seed) <> 1 then raise exception 'QA_RECURRENCE_DUPLICATED'; end if;

    restored_id := gen_random_uuid(); restored_tag := gen_random_uuid();
    value := jsonb_build_object('format','derek-control-panel-backup','version',1,'ownerId',actor,'exportedAt',now(),'data',jsonb_build_object(
      'tasks',jsonb_build_array(jsonb_build_object('id',restored_id,'scope','home','area','personal','source_type','follow_up','title','QA restore (rollback)',
        'status','not_started','risk','low','created_at',now(),'updated_at',now(),'requested_priority',3,'critical_path',false,
        'safety_impact',false,'child_impact',false,'legal_impact',false,'buffer_days',0,'progress',0)),
      'personalTaskTags',jsonb_build_array(jsonb_build_object('id',restored_tag,'user_id',actor,'name','QA ' || left(restored_tag::text,8))),
      'taskTagAssignments',jsonb_build_array(jsonb_build_object('user_id',actor,'task_id',restored_id,'tag_id',restored_tag)),
      'taskTagPreferences',jsonb_build_array(jsonb_build_object('user_id',actor,'initialized_at',now()))
    ));
    result := public.restore_backup_v3(value);
    if (result->>'tasks')::int <> 1 or (result->>'personalTaskTags')::int <> 1 or (result->>'taskTagAssignments')::int <> 1 then
      raise exception 'QA_REAL_RESTORE_CHAIN_FAILED';
    end if;
    result := public.restore_backup_v3(value);
    if (result->>'tasks')::int <> 0 or (result->>'personalTaskTags')::int <> 0 or (result->>'taskTagAssignments')::int <> 0 then
      raise exception 'QA_RESTORE_DUPLICATED';
    end if;
    result := public.restore_backup_v3(jsonb_build_object('format','derek-control-panel-backup','version',1,'ownerId',actor,'exportedAt',now(),'data','{}'::jsonb));
    if (result->>'personalTaskTags')::int <> 0 then raise exception 'QA_OLD_BACKUP_INCOMPATIBLE'; end if;
    begin
      perform public.restore_backup_v3(jsonb_set(value,'{data,personalTaskTags,0,user_id}',to_jsonb(gen_random_uuid()::text)));
      raise exception 'QA_FOREIGN_TAG_WAS_ACCEPTED';
    exception when others then
      if sqlerrm not like '%BACKUP_INVALID%' then raise; end if;
    end;
    if previous_task is not null then
      if exists(select 1 from public.tasks where id=previous_task) or exists(select 1 from public.personal_task_tags where id=previous_tag) then
        raise exception 'QA_PRIVATE_DATA_LEAK';
      end if;
      value := jsonb_build_object('format','derek-control-panel-backup','version',1,'ownerId',actor,'exportedAt',now(),'data',jsonb_build_object(
        'personalTaskTags',jsonb_build_array(jsonb_build_object('id',own_tag_uuid,'user_id',actor,'name','QA ' || left(seed::text,8))),
        'taskTagAssignments',jsonb_build_array(jsonb_build_object('user_id',actor,'task_id',previous_task,'tag_id',own_tag_uuid))
      ));
      result := public.restore_backup_v3(value);
      if (result->>'taskTagAssignments')::int <> 0 then raise exception 'QA_LINK_GRANTED_PRIVATE_ACCESS'; end if;
    end if;
    previous_task := next_id; previous_tag := own_tag_uuid;
    execute 'reset role';
  end loop;
end;
$qa$;
rollback;
select 'PASS: three authenticated roles; real recurrence + V1/V2/V3 restore; dedupe, old backup and private access verified; all fixtures rolled back' as verification;
