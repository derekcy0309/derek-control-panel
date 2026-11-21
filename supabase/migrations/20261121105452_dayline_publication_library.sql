-- Additive. No changes to any task, account, existing subscription or publication.
create schema if not exists dayline_reading;
revoke all on schema dayline_reading from public,anon,authenticated;
grant usage on schema dayline_reading to authenticated;
create table public.dayline_info_choices (
 user_id uuid primary key references auth.users(id) on delete cascade,
 journals boolean not null default false, news boolean not null default false, traffic boolean not null default false
);
create table dayline_reading.editions (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
 series text not null check(series in ('home','ngo','chronic','weekly','us')), published date not null,
 current_version integer not null default 0, unique(owner_id,series,published)
);
create table dayline_reading.revisions (
 edition_id uuid references dayline_reading.editions(id), version integer not null,
 digest text not null check(digest ~ '^[a-f0-9]{64}$'), entry jsonb not null,
 created_at timestamptz not null default now(), primary key(edition_id,version), unique(edition_id,digest)
);
create table dayline_reading.readers (
 edition_id uuid not null references dayline_reading.editions(id), user_id uuid not null references auth.users(id), primary key(user_id,edition_id)
);
create index dayline_reading_readers_issue on dayline_reading.readers(edition_id);
create index dayline_reading_pub_sort on dayline_reading.editions(published desc,id);
create table dayline_reading.states (
 user_id uuid not null references auth.users(id), edition_id uuid not null references dayline_reading.editions(id),
 read_at timestamptz, saved boolean not null default false, primary key(user_id,edition_id)
);
create index dayline_reading_states_issue on dayline_reading.states(edition_id);
alter table public.dayline_info_choices enable row level security;
alter table dayline_reading.editions enable row level security;
alter table dayline_reading.revisions enable row level security;
alter table dayline_reading.readers enable row level security;
alter table dayline_reading.states enable row level security;
revoke all on public.dayline_info_choices from public,anon,authenticated;
revoke all on all tables in schema dayline_reading from public,anon,authenticated;
grant select,insert,update(journals,news,traffic) on public.dayline_info_choices to authenticated;
create function dayline_reading.active_reader() returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.user_profiles where user_id=(select auth.uid()) and active)
$$;
create policy dl_choices_self on public.dayline_info_choices to authenticated using(user_id=(select auth.uid()) and (select dayline_reading.active_reader())) with check(user_id=(select auth.uid()) and (select dayline_reading.active_reader()));
create policy dl_readers_self on dayline_reading.readers for select to authenticated using(user_id=(select auth.uid()) and (select dayline_reading.active_reader()));
create policy dl_editions_self on dayline_reading.editions for select to authenticated using(exists(select 1 from dayline_reading.readers r where r.edition_id=id and r.user_id=(select auth.uid())));
create policy dl_revision_self on dayline_reading.revisions for select to authenticated using(exists(select 1 from dayline_reading.readers r where r.edition_id=revisions.edition_id and r.user_id=(select auth.uid())));
create policy dl_state_self on dayline_reading.states to authenticated using(user_id=(select auth.uid()) and exists(select 1 from dayline_reading.readers r where r.edition_id=states.edition_id)) with check(user_id=(select auth.uid()) and exists(select 1 from dayline_reading.readers r where r.edition_id=states.edition_id));
grant select on dayline_reading.readers,dayline_reading.editions,dayline_reading.revisions,dayline_reading.states to authenticated;
grant insert,update(saved,read_at) on dayline_reading.states to authenticated;
-- Only a trusted importer can call this helper. No service-role key is used by the website.
create function dayline_reading.ingest(recipient uuid, doc jsonb, previous text default null) returns text language plpgsql security invoker set search_path='' as $$
declare e dayline_reading.editions; v int; prior text;
begin
 if not exists(select 1 from public.user_profiles where user_id=recipient and active) then raise exception 'invalid recipient'; end if;
 if not(doc ?& array['series','title','published','from','until','lead','original','format','sourceKind','sourceRef','blocks','revision'])
 or length(doc->>'original') not between 1 and 400000 or jsonb_typeof(doc->'blocks')<>'array' or jsonb_array_length(doc->'blocks') not between 1 and 2000
 or doc->>'revision' !~ '^[0-9a-f]{64}$' or doc->>'from'>doc->>'until' then raise exception 'invalid edition'; end if;
 insert into dayline_reading.editions(owner_id,series,published) values(recipient,doc->>'series',(doc->>'published')::date) on conflict do nothing;
 select * into strict e from dayline_reading.editions where owner_id=recipient and series=doc->>'series' and published=(doc->>'published')::date for update;
 if exists(select 1 from dayline_reading.revisions where edition_id=e.id and digest=doc->>'revision') then return 'unchanged'; end if;
 if e.current_version>0 then select digest into prior from dayline_reading.revisions where edition_id=e.id and version=e.current_version;
 if previous is distinct from prior then raise exception 'revision conflict' using errcode='40001';end if;end if;
 v:=e.current_version+1;
 insert into dayline_reading.revisions values(e.id,v,doc->>'revision',doc,now());
 update dayline_reading.editions set current_version=v where id=e.id;
 insert into dayline_reading.readers values(e.id,recipient) on conflict do nothing;
 return case when v=1 then 'created' else 'revised' end;
end $$;
create function public.dayline_set_info(choice text, enabled boolean) returns void language plpgsql security invoker set search_path='' as $$
begin
 if choice not in ('journals','traffic','news') or choice is null or enabled is null then raise exception 'invalid preference';end if;
 insert into public.dayline_info_choices(user_id,journals,news,traffic) values(auth.uid(),case when choice='journals' then enabled else false end,case when choice='news' then enabled else false end,case when choice='traffic' then enabled else false end)
 on conflict(user_id) do update set journals=case when choice='journals' then enabled else dayline_info_choices.journals end,news=case when choice='news' then enabled else dayline_info_choices.news end,traffic=case when choice='traffic' then enabled else dayline_info_choices.traffic end;
end $$;
create function public.dayline_unread() returns int language sql stable security invoker set search_path='' as $$
 select count(*)::int from dayline_reading.editions e where exists(select 1 from public.dayline_info_choices where user_id=(select auth.uid()) and journals)
 and not exists(select 1 from dayline_reading.states s where s.edition_id=e.id and s.user_id=(select auth.uid()) and read_at is not null)
$$;
create function public.dayline_issues(category text, month_key text, term text, mode text, skip_count int) returns setof jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',e.id,'series',e.series,'published',e.published,'title',d->>'title','lead',d->>'lead','from',d->>'from','until',d->>'until','version',e.current_version,'read',s.read_at is not null,'saved',coalesce(s.saved,false),
 'snippet',case when hit.pos>0 then substring(hit.body from greatest(hit.pos-36,1) for 132) when term<>'' then left(d->>'title',132) end,'anchor',hit.idx)
 from dayline_reading.editions e join dayline_reading.revisions rev on rev.edition_id=e.id and rev.version=e.current_version
 cross join lateral (select rev.entry as d) doc
 left join dayline_reading.states s on s.edition_id=e.id and s.user_id=(select auth.uid())
 left join lateral (select block->>'text' body,ordinality-1 idx,strpos(lower(block->>'text'),lower(term)) pos from jsonb_array_elements(d->'blocks') with ordinality b(block,ordinality)
 where term<>'' and strpos(lower(block->>'text'),lower(term))>0 order by ordinality limit 1) hit on true
 where exists(select 1 from public.dayline_info_choices where user_id=(select auth.uid()) and journals)
 and (category='all' or (category='medical' and e.series<>'us') or category=e.series)
 and (month_key='' or to_char(e.published,'YYYY-MM')=month_key)
 and (mode='all' or (mode='unread' and s.read_at is null) or (mode='saved' and s.saved))
 and (term='' or hit.idx is not null or strpos(lower(d->>'title'),lower(term))>0)
 order by e.published desc,e.series,e.id limit 26 offset greatest(0,least(skip_count,100000))
$$;
create function public.dayline_issue(issue uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select (rev.entry-'original'-'sourceRef'-'format')||jsonb_build_object('id',e.id,'version',e.current_version,'read',s.read_at is not null,'saved',coalesce(s.saved,false))
 from dayline_reading.editions e join dayline_reading.revisions rev on rev.edition_id=e.id and rev.version=e.current_version
 left join dayline_reading.states s on s.edition_id=e.id and s.user_id=(select auth.uid())
 where e.id=issue and exists(select 1 from public.dayline_info_choices where user_id=(select auth.uid()) and journals)
$$;
create function public.dayline_issue_state(issue uuid, action text, wanted boolean, seen text) returns void language plpgsql security invoker set search_path='' as $$
begin
 if not exists(select 1 from dayline_reading.editions e join dayline_reading.revisions r on r.edition_id=e.id and r.version=e.current_version where e.id=issue and (action<>'read' or r.digest=seen)) or not exists(select 1 from public.dayline_info_choices where user_id=(select auth.uid()) and journals) then raise exception 'unavailable' using errcode='42501';end if;
 if action='read' then insert into dayline_reading.states(user_id,edition_id,read_at) values(auth.uid(),issue,now()) on conflict(user_id,edition_id) do update set read_at=coalesce(states.read_at,excluded.read_at);
 elsif action='save' and wanted is not null then insert into dayline_reading.states(user_id,edition_id,saved) values(auth.uid(),issue,wanted) on conflict(user_id,edition_id) do update set saved=excluded.saved;
 else raise exception 'invalid action'; end if;
end $$;
revoke all on all functions in schema dayline_reading from public,anon,authenticated;
grant execute on function dayline_reading.active_reader() to authenticated;
revoke all on function public.dayline_set_info(text,boolean),public.dayline_unread(),public.dayline_issues(text,text,text,text,int),public.dayline_issue(uuid),public.dayline_issue_state(uuid,text,boolean,text) from public,anon,authenticated;
grant execute on function public.dayline_set_info(text,boolean),public.dayline_unread(),public.dayline_issues(text,text,text,text,int),public.dayline_issue(uuid),public.dayline_issue_state(uuid,text,boolean,text) to authenticated;

-- One revocable *append-only* credential, bound to one account and one series.
-- No software receives an Auth refresh token, database password or service-role key.
create table dayline_reading.publishers (
 owner_id uuid references auth.users(id), series text check(series in ('home','ngo','chronic','weekly','us')),
 key_hash bytea not null unique, expires_at timestamptz not null, checked_at timestamptz, result text, last_issue_date date,
 primary key(owner_id,series)
);
alter table dayline_reading.publishers enable row level security;
revoke all on dayline_reading.publishers from public,anon,authenticated;
create function dayline_reading.credential(topic text, digest_hex text) returns void language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();
begin
 if uid is null or not dayline_reading.active_reader() or topic not in ('home','ngo','chronic','weekly','us') then raise exception 'denied' using errcode='42501'; end if;
 if digest_hex is null then delete from dayline_reading.publishers where owner_id=uid and series=topic;return;end if;
 if digest_hex !~ '^[0-9a-f]{64}$' then raise exception 'invalid credential';end if;
 insert into dayline_reading.publishers(owner_id,series,key_hash,expires_at) values(uid,topic,decode(digest_hex,'hex'),now()+interval '180 days')
 on conflict(owner_id,series) do update set key_hash=excluded.key_hash,expires_at=excluded.expires_at;
end $$;
create function dayline_reading.deliver(proof text, payload jsonb, previous text, outcome text) returns text language plpgsql security definer set search_path='' as $$
declare binding dayline_reading.publishers; receipt text;
begin
 if proof is null or proof !~ '^dlpub_[a-f0-9]{64}$' then raise exception 'denied' using errcode='42501';end if;
 select * into binding from dayline_reading.publishers where key_hash=sha256(convert_to(proof,'UTF8')) and expires_at>now() for update;
 if binding.owner_id is null or not exists(select 1 from public.user_profiles where user_id=binding.owner_id and active) then raise exception 'denied' using errcode='42501';end if;
 if outcome='issue' and payload->>'series'=binding.series and payload->>'sourceKind'='codex-scheduled' then receipt:=dayline_reading.ingest(binding.owner_id,payload,previous);
 elsif outcome in ('no_issue','failed') and payload is null then receipt:=outcome;
 else raise exception 'invalid delivery';end if;
 update dayline_reading.publishers set checked_at=now(),result=receipt,last_issue_date=case when outcome='issue' then (payload->>'published')::date else last_issue_date end where owner_id=binding.owner_id and series=binding.series;
 return receipt;
end $$;
create function public.dayline_publisher_key(topic text,digest_hex text) returns void language sql security invoker set search_path='' as $$ select dayline_reading.credential(topic,digest_hex) $$;
create function public.dayline_deliver(proof text,payload jsonb,previous text,outcome text) returns text language sql security invoker set search_path='' as $$ select dayline_reading.deliver(proof,payload,previous,outcome) $$;
create function dayline_reading.sync_status() returns setof jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('series',p.series,'checked',p.checked_at,'published',p.last_issue_date,'result',p.result,'expired',p.expires_at<=now()) from dayline_reading.publishers p where p.owner_id=(select auth.uid()) and (select dayline_reading.active_reader())
$$;
create function public.dayline_sync_status() returns setof jsonb language sql stable security invoker set search_path='' as $$ select * from dayline_reading.sync_status() $$;
grant usage on schema dayline_reading to anon;
revoke all on function dayline_reading.deliver(text,jsonb,text,text),dayline_reading.credential(text,text),dayline_reading.sync_status(),public.dayline_publisher_key(text,text),public.dayline_deliver(text,jsonb,text,text),public.dayline_sync_status() from public,anon,authenticated;
grant execute on function dayline_reading.deliver(text,jsonb,text,text),public.dayline_deliver(text,jsonb,text,text) to anon;
grant execute on function dayline_reading.credential(text,text),public.dayline_publisher_key(text,text),dayline_reading.sync_status(),public.dayline_sync_status() to authenticated;

-- Bookmarks are not notes or household resources: the generic share/backup paths cannot grant access.
create table public.dayline_web_links (
 id uuid primary key,owner_id uuid not null references auth.users(id),shelf text not null check(shelf in ('site','later')),
 title text not null check(length(title) between 1 and 120),url text not null check(length(url)<=1800 and url ~ '^https?://'),
 archived_at timestamptz,updated_at timestamptz not null default now()
);
create index dayline_web_links_owner_recent on public.dayline_web_links(owner_id,updated_at desc,id) where archived_at is null;
alter table public.dayline_web_links enable row level security;
revoke all on public.dayline_web_links from public,anon,authenticated;
grant select,insert,update(title,archived_at,updated_at) on public.dayline_web_links to authenticated;
create policy dl_web_self on public.dayline_web_links to authenticated using(owner_id=(select auth.uid()) and (select dayline_reading.active_reader())) with check(owner_id=(select auth.uid()) and (select dayline_reading.active_reader()));
