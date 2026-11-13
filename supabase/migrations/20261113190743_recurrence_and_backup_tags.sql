-- Additive only: no existing task, recurrence, finance or tag rows are rewritten.
-- Version aligned with the ID assigned by Supabase apply_migration.
-- The existing recurrence generator remains unchanged. It writes generations
-- internally as its definer; ordinary authenticated users only have SELECT there.
create function private.inherit_recurring_task_tags()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare task_owner uuid;
begin
  if new.generated_task_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.generated_task_id is not distinct from old.generated_task_id then return new; end if;
  select rule.owner_id into task_owner
  from public.task_recurrence_rules rule
  join public.tasks source on source.id = new.source_task_id
    and source.owner_id = rule.owner_id and source.recurrence_rule_id = rule.id
    and source.status = 'done' and source.deleted_at is null
  join public.tasks successor on successor.id = new.generated_task_id
    and successor.owner_id = rule.owner_id and successor.recurrence_rule_id = rule.id
    and successor.deleted_at is null
  where rule.id = new.recurrence_rule_id;
  if task_owner is null then return new; end if;

  -- The successor is private to the recurrence owner. Other viewers' private
  -- labels must never be copied or made visible, even if an assignee completes it.
  perform pg_advisory_xact_lock(hashtextextended(task_owner::text || ':' || new.generated_task_id::text, 0));
  insert into public.task_tag_assignments(user_id, task_id, tag_id)
    select task_owner, new.generated_task_id, link.tag_id
    from public.task_tag_assignments link
    join public.personal_task_tags tag on tag.id = link.tag_id
      and tag.user_id = task_owner and tag.deleted_at is null
    where link.user_id = task_owner and link.task_id = new.source_task_id
    on conflict do nothing;
  return new;
end;
$$;
revoke all on function private.inherit_recurring_task_tags() from public, anon, authenticated;
create trigger inherit_recurring_task_tags_trigger
after insert or update of generated_task_id on public.task_recurrence_generations
for each row when (new.generated_task_id is not null)
execute function private.inherit_recurring_task_tags();

-- Retain V1/V2 for old app builds. V3 wraps the original restore in the SAME
-- transaction, so a tag validation/permission failure rolls everything back.
create function public.restore_backup_v3(p_backup jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  data jsonb := p_backup -> 'data';
  collection_name text;
  entry jsonb;
  target_task uuid;
  restored_counts jsonb;
  tag_counts jsonb;
  tags_added integer := 0;
  links_added integer := 0;
  preferences_added integer := 0;
begin
  if actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if jsonb_typeof(p_backup) is distinct from 'object'
    or p_backup ->> 'format' is distinct from 'derek-control-panel-backup'
    or p_backup ->> 'version' is distinct from '1'
    or p_backup ->> 'ownerId' is distinct from actor::text
    or jsonb_typeof(data) is distinct from 'object'
    or nullif(p_backup ->> 'exportedAt', '') is null
  then raise exception 'BACKUP_INVALID'; end if;

  foreach collection_name in array array['personalTaskTags','taskTagAssignments','taskTagPreferences'] loop
    if coalesce(jsonb_typeof(data -> collection_name), 'array') <> 'array'
      or coalesce(jsonb_array_length(data -> collection_name), 0) > 10000 then
      raise exception 'BACKUP_INVALID';
    end if;
    for entry in select value from jsonb_array_elements(coalesce(data -> collection_name, '[]'::jsonb)) loop
      if jsonb_typeof(entry) is distinct from 'object' or entry ->> 'user_id' is distinct from actor::text then
        raise exception 'BACKUP_INVALID';
      end if;
    end loop;
  end loop;
  if coalesce(jsonb_array_length(data -> 'taskTagPreferences'), 0) > 1 then raise exception 'BACKUP_INVALID'; end if;
  if exists (
    select 1 from jsonb_populate_recordset(null::public.personal_task_tags, coalesce(data -> 'personalTaskTags','[]'::jsonb)) tag
    where tag.id is null or tag.name is null or char_length(btrim(tag.name)) not between 1 and 40
      or char_length(tag.legacy_key) > 40
  ) or exists (
    select 1 from jsonb_populate_recordset(null::public.personal_task_tags, coalesce(data -> 'personalTaskTags','[]'::jsonb)) tag
    group by tag.id having count(*) > 1
  ) or exists (
    select 1 from jsonb_populate_recordset(null::public.personal_task_tags, coalesce(data -> 'personalTaskTags','[]'::jsonb)) tag
    where tag.deleted_at is null group by lower(btrim(tag.name)) having count(*) > 1
  ) or exists (
    select 1 from jsonb_populate_recordset(null::public.task_tag_assignments, coalesce(data -> 'taskTagAssignments','[]'::jsonb)) link
    where link.task_id is null or link.tag_id is null or not exists (
      select 1 from jsonb_populate_recordset(null::public.personal_task_tags, coalesce(data -> 'personalTaskTags','[]'::jsonb)) tag
      where tag.id = link.tag_id
    )
  ) then raise exception 'BACKUP_INVALID'; end if;

  perform pg_advisory_xact_lock(hashtextextended(actor::text || ':tag-backup', 0));
  restored_counts := public.restore_backup_v2(p_backup);

  -- Same ID wins, including a renamed or soft-deleted existing tag. Otherwise
  -- reuse an active case-insensitive name; never rename or resurrect anything.
  insert into public.personal_task_tags(id,user_id,name,legacy_key,created_at,updated_at,deleted_at)
    select tag.id, actor, btrim(tag.name), tag.legacy_key,
      coalesce(tag.created_at,now()), coalesce(tag.updated_at,now()), tag.deleted_at
    from jsonb_populate_recordset(null::public.personal_task_tags, coalesce(data -> 'personalTaskTags','[]'::jsonb)) tag
    where not exists (select 1 from public.personal_task_tags current_tag where current_tag.id = tag.id and current_tag.user_id = actor)
      and (tag.deleted_at is not null or not exists (
        select 1 from public.personal_task_tags current_tag
        where current_tag.user_id = actor and current_tag.deleted_at is null
          and lower(btrim(current_tag.name)) = lower(btrim(tag.name))
      ))
    on conflict do nothing;
  get diagnostics tags_added = row_count;
  if (select count(*) from public.personal_task_tags where user_id = actor and deleted_at is null) > 60 then
    raise exception 'BACKUP_TAG_LIMIT';
  end if;

  if jsonb_array_length(coalesce(data -> 'taskTagPreferences','[]'::jsonb)) > 0
    or jsonb_array_length(coalesce(data -> 'personalTaskTags','[]'::jsonb)) > 0 then
    insert into public.task_tag_preferences(user_id,initialized_at)
      values(actor,coalesce((data -> 'taskTagPreferences' -> 0 ->> 'initialized_at')::timestamptz,now()))
      on conflict do nothing;
    get diagnostics preferences_added = row_count;
  end if;

  -- Match the lock used by set_my_task_tags so restore cannot race a label edit.
  for target_task in
    select distinct task.id from jsonb_populate_recordset(null::public.task_tag_assignments, coalesce(data -> 'taskTagAssignments','[]'::jsonb)) link
    join public.tasks task on task.id = link.task_id and task.deleted_at is null order by task.id
  loop
    perform pg_advisory_xact_lock(hashtextextended(actor::text || ':' || target_task::text, 0));
  end loop;
  with tag_map as (
    select tag.id as source_id, target.id as target_id
    from jsonb_populate_recordset(null::public.personal_task_tags, coalesce(data -> 'personalTaskTags','[]'::jsonb)) tag
    join lateral (
      select current_tag.id from public.personal_task_tags current_tag
      where current_tag.user_id = actor and current_tag.deleted_at is null
        and (current_tag.id = tag.id or (
          lower(btrim(current_tag.name)) = lower(btrim(tag.name))
          and not exists (select 1 from public.personal_task_tags same_id where same_id.id = tag.id and same_id.user_id = actor)
        ))
      order by (current_tag.id = tag.id) desc limit 1
    ) target on true
    where tag.deleted_at is null
  )
  insert into public.task_tag_assignments(user_id,task_id,tag_id)
    select distinct actor, link.task_id, tag_map.target_id
    from jsonb_populate_recordset(null::public.task_tag_assignments, coalesce(data -> 'taskTagAssignments','[]'::jsonb)) link
    join tag_map on tag_map.source_id = link.tag_id
    join public.tasks task on task.id = link.task_id and task.deleted_at is null
    on conflict do nothing;
  get diagnostics links_added = row_count;
  if exists (
    select 1 from public.task_tag_assignments link
    where link.user_id = actor and link.task_id in (
      select task_id from jsonb_populate_recordset(null::public.task_tag_assignments, coalesce(data -> 'taskTagAssignments','[]'::jsonb))
    ) group by link.task_id having count(*) > 20
  ) then raise exception 'BACKUP_TAG_LIMIT'; end if;

  tag_counts := jsonb_build_object('personalTaskTags',tags_added,'taskTagAssignments',links_added,'taskTagPreferences',preferences_added);
  -- Base restore already audits the original collections. Record only generic
  -- tag counts here, never tag names, task text or the backup body.
  if data ? 'personalTaskTags' or data ? 'taskTagAssignments' or data ? 'taskTagPreferences' then
    insert into public.backup_restore_audit_logs(user_id,event_kind,backup_exported_at,record_counts)
      values(actor,'restore',(p_backup ->> 'exportedAt')::timestamptz,tag_counts);
  end if;
  return restored_counts || tag_counts;
end;
$$;
revoke all on function public.restore_backup_v3(jsonb) from public, anon;
grant execute on function public.restore_backup_v3(jsonb) to authenticated;
comment on function public.restore_backup_v3(jsonb) is
  'Same-account add-only V1 backup restore, including private tags and task links. RLS applies; existing data is never overwritten.';
