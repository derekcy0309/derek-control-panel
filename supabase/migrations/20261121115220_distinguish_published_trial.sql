-- Preserve every issue, source, revision, reader, bookmark and existing ID.
-- A trial and the first regular edition can legitimately share a Hong Kong publication date.
alter table dayline_reading.editions add column is_trial boolean not null default false;
update dayline_reading.editions e set is_trial=true where exists (select 1 from dayline_reading.revisions r where r.edition_id=e.id and r.version=1 and r.entry->>'sourceKind'='codex-trial');
alter table dayline_reading.editions add constraint editions_scope_day_kind_key unique(owner_id,series,published,is_trial);
alter table dayline_reading.editions drop constraint editions_owner_id_series_published_key;
create or replace function dayline_reading.ingest(recipient uuid, doc jsonb, previous text default null) returns text language plpgsql security invoker set search_path='' as $$
declare e dayline_reading.editions; v int; prior text;
begin
 if not exists(select 1 from public.user_profiles where user_id=recipient and active) then raise exception 'invalid recipient'; end if;
 if not(doc ?& array['series','title','published','from','until','lead','original','format','sourceKind','sourceRef','blocks','revision'])
 or length(doc->>'original') not between 1 and 400000 or jsonb_typeof(doc->'blocks')<>'array' or jsonb_array_length(doc->'blocks') not between 1 and 2000
 or doc->>'revision' !~ '^[0-9a-f]{64}$' or doc->>'from'>doc->>'until' then raise exception 'invalid edition'; end if;
 insert into dayline_reading.editions(owner_id,series,published,is_trial) values(recipient,doc->>'series',(doc->>'published')::date,doc->>'sourceKind'='codex-trial') on conflict do nothing;
 select * into strict e from dayline_reading.editions where owner_id=recipient and series=doc->>'series' and published=(doc->>'published')::date and is_trial=(doc->>'sourceKind'='codex-trial') for update;
 if exists(select 1 from dayline_reading.revisions where edition_id=e.id and digest=doc->>'revision') then return 'unchanged'; end if;
 if e.current_version>0 then select digest into prior from dayline_reading.revisions where edition_id=e.id and version=e.current_version;
 if previous is distinct from prior then raise exception 'revision conflict' using errcode='40001';end if;end if;
 v:=e.current_version+1;
 insert into dayline_reading.revisions values(e.id,v,doc->>'revision',doc,now());
 update dayline_reading.editions set current_version=v where id=e.id;
 insert into dayline_reading.readers values(e.id,recipient) on conflict do nothing;
 return case when v=1 then 'created' else 'revised' end;
end $$;
