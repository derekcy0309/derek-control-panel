-- Existing codes stay limited. Only a new human grant opts into this scope.
alter table public.agent_access_grants add column owner_workspace boolean not null default false;
alter table public.agent_access_grants add constraint owner_workspace_agent_scope_check
  check (not owner_workspace or cardinality(create_tag_ids)=0);
grant select(owner_workspace), insert(owner_workspace) on public.agent_access_grants to authenticated;

alter table public.agent_access_events drop constraint agent_access_events_action_check,
  add constraint agent_access_events_action_check check (action in
    ('grant_created','grant_revoked','status','list','detail','create_task','create_note','owner_update','request_archive'));

create function public.create_my_owner_workspace_agent(p_token_hash text,p_label text,p_days integer)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare actor uuid:=auth.uid(); new_id uuid; expiry timestamptz;
begin
  if actor is null or coalesce(auth.jwt()->>'is_anonymous','false')<>'false'
    or not exists(select 1 from public.user_profiles p where p.user_id=actor and p.is_admin and p.active)
  then raise exception 'AGENT_ADMIN_REQUIRED'; end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' or p_label is null
    or char_length(btrim(p_label)) not between 1 and 50 or p_days is null or p_days not in (1,7,30,90)
  then raise exception 'AGENT_INVALID'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text||':agent-grants',0));
  if (select count(*) from public.agent_access_grants g where g.owner_id=actor and g.revoked_at is null and g.expires_at>now())>=5
  then raise exception 'AGENT_INVALID'; end if;
  expiry:=now()+make_interval(days=>p_days);
  insert into public.agent_access_grants(owner_id,label,token_hash,create_tag_ids,expires_at,owner_workspace)
    values(actor,btrim(p_label),p_token_hash,'{}',expiry,true) returning id into new_id;
  insert into public.agent_access_events(grant_id,owner_id,action) values(new_id,actor,'grant_created');
  return jsonb_build_object('id',new_id,'label',btrim(p_label),'expires_at',expiry,'owner_workspace',true);
end $$;
revoke all on function public.create_my_owner_workspace_agent(text,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.create_my_owner_workspace_agent(text,text,integer) to authenticated;

-- Internal, service-only invoker. No endpoint can accept arbitrary tables,
-- impersonate a user outside this transaction, or write account settings.
create function school_bot_internal.owner_workspace_agent_operation(p_token_hash text,p_action text,p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  g public.agent_access_grants%rowtype; previous public.agent_write_requests%rowtype;
  kind text; item_id uuid; request_uuid uuid; offset_value integer:=0; checksum_value text;
  result jsonb; rows_json jsonb; row_count integer; changes jsonb; fields text[];
  title_value text; description_value text; category_value text; status_value text;
  due_value date; priority_value integer; tags uuid[]; changed integer;
  old_sub text; old_claims text;
begin
  if current_user<>'service_role' then raise exception 'AGENT_FORBIDDEN'; end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'AGENT_UNAUTHORIZED'; end if;
  if p_action is null or p_action not in ('status','list','detail','create_task','create_note','update') then raise exception 'AGENT_FORBIDDEN'; end if;
  if jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>32768 then raise exception 'AGENT_INVALID'; end if;
  -- Serialize this code's mutations/retries against revocation and human review.
  select a.* into g from public.agent_access_grants a join public.user_profiles u on u.user_id=a.owner_id and u.is_admin and u.active
    where a.token_hash=p_token_hash and a.owner_workspace and a.revoked_at is null and a.expires_at>clock_timestamp() for update of a;
  if not found then raise exception 'AGENT_UNAUTHORIZED'; end if;

  if p_action='status' then
    if p_payload<>'{}' then raise exception 'AGENT_INVALID'; end if;
    select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'name',x.name) order by x.name,x.id),'[]') into rows_json
      from public.personal_task_tags x where x.user_id=g.owner_id and x.deleted_at is null;
    result:=jsonb_build_object('id',g.id,'label',g.label,'expiresAt',g.expires_at,
      'scope','owner_workspace','tags',rows_json,'permissions',jsonb_build_object('read',true,'create',true,'update',true,'delete',false,'requestArchive',true));
  elsif p_action in ('list','detail') then
    if exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('kind','id','offset')) then raise exception 'AGENT_INVALID'; end if;
    kind:=p_payload->>'kind';
    if kind is null or kind not in ('task','note') then raise exception 'AGENT_INVALID'; end if;
    begin
      offset_value:=coalesce((p_payload->>'offset')::integer,0);
      item_id:=(p_payload->>'id')::uuid;
    exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'AGENT_INVALID'; end;
    if offset_value not between 0 and 10000 or (p_action='detail' and item_id is null) then raise exception 'AGENT_INVALID'; end if;
    if kind='task' then
      if p_action='detail' then
        select jsonb_build_object('id',t.id,'kind','task','title',t.title,'description',t.description,
          'due_date',t.due_date,'status',t.status,'requested_priority',t.requested_priority,
          'tags',(select coalesce(jsonb_agg(jsonb_build_object('id',tag.id,'name',tag.name) order by tag.name,tag.id),'[]')
            from public.task_tag_assignments link join public.personal_task_tags tag on tag.id=link.tag_id and tag.user_id=g.owner_id and tag.deleted_at is null
            where link.task_id=t.id and link.user_id=g.owner_id)) into result
          from public.tasks t where t.id=item_id and t.owner_id=g.owner_id and t.deleted_at is null and t.archived_at is null;
      else
        select coalesce(jsonb_agg(x.body order by x.updated_at desc,x.id) filter(where x.rn<=25),'[]'), count(*) into rows_json,row_count
        from (select t.id,t.updated_at,row_number() over(order by t.updated_at desc,t.id)-offset_value rn,
          jsonb_build_object('id',t.id,'kind','task','title',t.title,'due_date',t.due_date,'status',t.status,'requested_priority',t.requested_priority) body
          from public.tasks t where t.owner_id=g.owner_id and t.deleted_at is null and t.archived_at is null
          order by t.updated_at desc,t.id limit 26 offset offset_value) x;
      end if;
    else
      if p_action='detail' then
        select jsonb_build_object('id',n.id,'kind','note','title',n.title,'description',n.description,'category',n.metadata->>'noteCategory') into result
          from public.operating_items n where n.id=item_id and n.owner_id=g.owner_id and n.item_type='note' and n.archived_at is null;
      else
        select coalesce(jsonb_agg(x.body order by x.updated_at desc,x.id) filter(where x.rn<=25),'[]'),count(*) into rows_json,row_count
        from (select n.id,n.updated_at,row_number() over(order by n.updated_at desc,n.id)-offset_value rn,
          jsonb_build_object('id',n.id,'kind','note','title',n.title,'category',n.metadata->>'noteCategory') body
          from public.operating_items n where n.owner_id=g.owner_id and n.item_type='note' and n.archived_at is null
          order by n.updated_at desc,n.id limit 26 offset offset_value) x;
      end if;
    end if;
    if p_action='detail' and result is null then raise exception 'AGENT_NOT_FOUND'; end if;
    result:=case when p_action='detail' then jsonb_build_object('item',result)
      else jsonb_build_object('items',rows_json,'nextOffset',case when row_count>25 and offset_value+25<=10000 then offset_value+25 end) end;
  else
    if p_action='update' then
      if exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('kind','id','request_id','changes')) then raise exception 'AGENT_INVALID'; end if;
      kind:=p_payload->>'kind'; changes:=p_payload->'changes';
      if kind is null or kind not in ('task','note') or jsonb_typeof(changes) is distinct from 'object' or changes='{}' then raise exception 'AGENT_INVALID'; end if;
    else
      kind:=case p_action when 'create_task' then 'task' else 'note' end;
      changes:=p_payload-'request_id';
    end if;
    fields:=case when kind='task' then array['title','description','due_date','priority','tag_ids']
      else array['title','description','category'] end;
    if p_action='update' and kind='task' then fields:=array_append(fields,'status'); end if;
    if exists(select 1 from jsonb_object_keys(changes) k where k<>all(fields)) then raise exception 'AGENT_INVALID'; end if;
    begin
      request_uuid:=(p_payload->>'request_id')::uuid;
      if p_action='update' then item_id:=(p_payload->>'id')::uuid; end if;
    exception when invalid_text_representation then raise exception 'AGENT_INVALID'; end;
    if request_uuid is null or (p_action='update' and item_id is null) then raise exception 'AGENT_INVALID'; end if;
    checksum_value:=md5(p_action||p_payload::text);
    select * into previous from public.agent_write_requests w where w.grant_id=g.id and w.request_id=request_uuid;
    if found then
      if previous.payload_checksum<>checksum_value then raise exception 'AGENT_REQUEST_CONFLICT'; end if;
      return jsonb_build_object('id',previous.resource_id,'kind',previous.resource_type,'duplicate',true);
    end if;
    if (select count(*) from public.agent_access_events e where e.grant_id=g.id and e.action in ('create_task','create_note','owner_update')
      and e.created_at>=date_trunc('day',now() at time zone 'Asia/Hong_Kong') at time zone 'Asia/Hong_Kong')>=100
    then raise exception 'AGENT_RATE_LIMIT'; end if;
    if (changes ? 'title' or p_action<>'update') and
      (jsonb_typeof(changes->'title') is distinct from 'string' or char_length(btrim(changes->>'title')) not between 1 and 500) then raise exception 'AGENT_INVALID'; end if;
    if changes ? 'description' and (jsonb_typeof(changes->'description') not in ('string','null') or char_length(changes->>'description')>10000) then raise exception 'AGENT_INVALID'; end if;
    if changes ? 'category' and (jsonb_typeof(changes->'category') not in ('string','null') or char_length(changes->>'category')>40) then raise exception 'AGENT_INVALID'; end if;
    title_value:=btrim(changes->>'title'); description_value:=nullif(btrim(changes->>'description'),''); category_value:=nullif(btrim(changes->>'category'),'');
    if changes ? 'priority' and (jsonb_typeof(changes->'priority') is distinct from 'number' or changes->>'priority' not in ('1','3','5')) then raise exception 'AGENT_INVALID'; end if;
    priority_value:=coalesce((changes->>'priority')::int,3);
    status_value:=changes->>'status';
    if changes ? 'status' and (status_value is null or status_value not in ('not_started','in_progress','waiting','blocked','done','cancelled')) then raise exception 'AGENT_INVALID'; end if;
    if changes->>'due_date' is not null then
      if jsonb_typeof(changes->'due_date') is distinct from 'string' or changes->>'due_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'AGENT_INVALID'; end if;
      begin due_value:=(changes->>'due_date')::date;
      exception when invalid_datetime_format or datetime_field_overflow then raise exception 'AGENT_INVALID'; end;
      if to_char(due_value,'YYYY-MM-DD')<>changes->>'due_date' then raise exception 'AGENT_INVALID'; end if;
    end if;
    if changes ? 'tag_ids' then
      if jsonb_typeof(changes->'tag_ids') is distinct from 'array' then raise exception 'AGENT_TAG_INVALID'; end if;
      if jsonb_array_length(changes->'tag_ids')>20 then raise exception 'AGENT_TAG_INVALID'; end if;
      begin select coalesce(array_agg(distinct v::uuid),'{}') into tags from jsonb_array_elements_text(changes->'tag_ids') as x(v);
      exception when invalid_text_representation then raise exception 'AGENT_TAG_INVALID'; end;
      if array_position(tags,null) is not null or exists(select 1 from unnest(tags) selected(id) where not exists
        (select 1 from public.personal_task_tags t where t.id=selected.id and t.user_id=g.owner_id and t.deleted_at is null))
      then raise exception 'AGENT_TAG_INVALID'; end if;
    end if;
    if p_action='create_task' then
      insert into public.tasks(user_id,owner_id,created_by_id,scope,area,visibility,source_type,title,description,due_date,requested_priority,status,risk,created_by_agent_id)
        values(g.owner_id,g.owner_id,g.owner_id,'home','personal','private','follow_up',title_value,description_value,due_value,priority_value,'not_started','low',g.id) returning id into item_id;
    elsif p_action='create_note' then
      insert into public.operating_items(item_type,title,description,owner_id,created_by_id,visibility,area,metadata,created_by_agent_id)
        values('note',title_value,description_value,g.owner_id,g.owner_id,'private','personal',jsonb_strip_nulls(jsonb_build_object('noteCategory',category_value)),g.id) returning id into item_id;
    else
      -- Existing row guards require auth.uid(). Set only the verified owner ID
      -- locally around these two fixed statements, not a human role or session.
      old_sub:=current_setting('request.jwt.claim.sub',true); old_claims:=current_setting('request.jwt.claims',true);
      perform set_config('request.jwt.claim.sub',g.owner_id::text,true);
      perform set_config('request.jwt.claims',jsonb_build_object('sub',g.owner_id,'role','service_role')::text,true);
      if kind='task' then
        update public.tasks t set
          title=coalesce(title_value,t.title), description=case when changes ? 'description' then description_value else t.description end,
          due_date=case when changes ? 'due_date' then due_value else t.due_date end,
          requested_priority=case when changes ? 'priority' then priority_value else t.requested_priority end,
          status=coalesce(status_value,t.status),
          completed_at=case when status_value='done' then coalesce(t.completed_at,now()) when status_value is not null then null else t.completed_at end,
          updated_at=now()
          where t.id=item_id and t.owner_id=g.owner_id and t.deleted_at is null and t.archived_at is null
            -- Shared/recurring status transitions and incomplete scheduled-date
            -- changes can trigger workflow outside this narrow agent operation.
            and (status_value is null or
              (t.recurrence_rule_id is null and t.visibility='private' and t.household_id is null
               and (t.assignee_id is null or t.assignee_id=g.owner_id)
               and grok_personal_internal.is_private(g.owner_id,'task',t.id)
               and (status_value<>'in_progress' or nullif(btrim(t.next_action),'') is not null)))
            and (not (changes ? 'due_date') or t.work_start_date is null or
              (due_value>=t.work_start_date and not exists(select 1 from unnest(t.work_dates) wd where wd>due_value)));
      else
        update public.operating_items n set title=coalesce(title_value,n.title),
          description=case when changes ? 'description' then description_value else n.description end,
          metadata=case when changes ? 'category' then
            case when category_value is null then coalesce(n.metadata,'{}')-'noteCategory'
            else jsonb_set(coalesce(n.metadata,'{}'),'{noteCategory}',to_jsonb(category_value)) end else n.metadata end,
          updated_at=now()
          where n.id=item_id and n.owner_id=g.owner_id and n.item_type='note' and n.archived_at is null;
      end if;
      get diagnostics changed = row_count;
      perform set_config('request.jwt.claim.sub',coalesce(old_sub,''),true);
      perform set_config('request.jwt.claims',coalesce(nullif(old_claims,''),'{}'),true);
      if changed<>1 then raise exception 'AGENT_NOT_FOUND'; end if;
    end if;
    if kind='task' and tags is not null then
      delete from public.task_tag_assignments link where link.user_id=g.owner_id and link.task_id=item_id and not(link.tag_id=any(tags));
      insert into public.task_tag_assignments(user_id,task_id,tag_id)
        select g.owner_id,item_id,id from unnest(tags) selected(id) on conflict do nothing;
    end if;
    insert into public.agent_write_requests(grant_id,owner_id,request_id,payload_checksum,resource_type,resource_id)
      values(g.id,g.owner_id,request_uuid,checksum_value,kind,item_id);
    insert into public.activity_logs(resource_type,resource_id,actor_id,action,summary)
      values(case when kind='task' then 'task' else 'operating_item' end,item_id,g.owner_id,
       case when p_action='update' then 'agent_updated' else 'agent_created' end,'AI Agent 操作本人資料');
    result:=jsonb_build_object('id',item_id,'kind',kind,'duplicate',false);
  end if;
  -- Atomic with all successful operations; rolling back the statement also
  -- rolls back any mutation if the counter is over the cap.
  if (select count(*) from public.agent_access_events where grant_id=g.id and created_at>now()-interval '1 minute')>=60 then raise exception 'AGENT_RATE_LIMIT'; end if;
  update public.agent_access_grants set last_used_at=now() where id=g.id;
  insert into public.agent_access_events(grant_id,owner_id,action,resource_type,resource_id)
    values(g.id,g.owner_id,case when p_action='update' then 'owner_update' else p_action end,kind,case when p_action='list' then null else item_id end);
  return result;
end $$;
revoke all on function school_bot_internal.owner_workspace_agent_operation(text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function school_bot_internal.owner_workspace_agent_operation(text,text,jsonb) to service_role;
-- Needed for the existing private task-sharing predicate, not the Grok
-- personal credential, archive queue, user settings, or Auth tables.
grant execute on function grok_personal_internal.is_private(uuid,text,uuid) to service_role;

create or replace function public.agent_access_operation(p_token_hash text,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare school_only boolean; own_workspace boolean; result jsonb; archive_id uuid;
begin
  if current_user<>'service_role' then raise exception 'AGENT_FORBIDDEN'; end if;
  select cardinality(g.create_tag_ids)=0,g.owner_workspace into school_only,own_workspace from public.agent_access_grants g where g.token_hash=p_token_hash;
  if own_workspace then
    if p_action='request_archive' then
      if jsonb_typeof(p_payload) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('kind','id')) then raise exception 'AGENT_INVALID'; end if;
      begin archive_id:=(p_payload->>'id')::uuid; exception when invalid_text_representation then raise exception 'AGENT_INVALID'; end;
      return public.request_owner_workspace_archive(p_token_hash,p_payload->>'kind',archive_id);
    end if;
    return school_bot_internal.owner_workspace_agent_operation(p_token_hash,p_action,p_payload);
  end if;
  if school_only and p_action is distinct from 'status' then raise exception 'SCHOOL_ONLY'; end if;
  result:=school_bot_internal.agent_base_operation_before_school(p_token_hash,p_action,p_payload);
  if school_only then return result||jsonb_build_object('scope','school_only','permissions',jsonb_build_object('read',false,'create',false,'update',false,'delete',false)); end if;
  return result;
end $$;
