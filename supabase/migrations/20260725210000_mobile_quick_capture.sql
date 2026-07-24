-- Mobile Quick Capture extends the existing Inbox. It does not create tasks or
-- a second backlog. Files are private to their capture owner by default.

create table if not exists public.mobile_capture_receipts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  client_capture_id uuid not null,
  inbox_item_id uuid references public.operating_items(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint mobile_capture_receipts_owner_client_unique unique(owner_id, client_capture_id)
);

create table if not exists public.inbox_capture_files (
  id uuid primary key default gen_random_uuid(),
  inbox_item_id uuid not null references public.operating_items(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  client_file_id uuid not null,
  bucket_id text not null default 'dcp-private-captures',
  object_path text not null,
  file_name text not null,
  content_type text not null,
  byte_size integer not null,
  file_kind text not null,
  raw_audio_retained boolean not null default false,
  created_at timestamptz not null default now(),
  constraint inbox_capture_files_owner_client_unique unique(owner_id, client_file_id),
  constraint inbox_capture_files_bucket_check check (bucket_id = 'dcp-private-captures'),
  constraint inbox_capture_files_path_check check (
    char_length(object_path) between 1 and 1200
    and object_path !~ '(^|/)\.\.(/|$)'
    and object_path !~ '^/'
  ),
  constraint inbox_capture_files_name_check check (char_length(btrim(file_name)) between 1 and 255),
  constraint inbox_capture_files_content_type_check check (char_length(btrim(content_type)) between 1 and 160),
  constraint inbox_capture_files_size_check check (byte_size between 1 and 12582912),
  constraint inbox_capture_files_kind_check check (file_kind in ('photo', 'document', 'audio'))
);

create index if not exists mobile_capture_receipts_owner_created_idx
  on public.mobile_capture_receipts(owner_id, created_at desc);
create index if not exists inbox_capture_files_inbox_created_idx
  on public.inbox_capture_files(inbox_item_id, created_at desc);
create index if not exists inbox_capture_files_owner_created_idx
  on public.inbox_capture_files(owner_id, created_at desc);

alter table public.mobile_capture_receipts enable row level security;
alter table public.inbox_capture_files enable row level security;

drop policy if exists mobile_capture_receipts_select_owner on public.mobile_capture_receipts;
create policy mobile_capture_receipts_select_owner
on public.mobile_capture_receipts for select to authenticated
using (owner_id = (select auth.uid()));

drop policy if exists inbox_capture_files_select_owner on public.inbox_capture_files;
create policy inbox_capture_files_select_owner
on public.inbox_capture_files for select to authenticated
using (
  owner_id = (select auth.uid())
  and exists (
    select 1 from public.operating_items i
    where i.id = inbox_item_id and i.owner_id = (select auth.uid()) and i.item_type = 'inbox'
  )
);

drop policy if exists inbox_capture_files_insert_owner on public.inbox_capture_files;
create policy inbox_capture_files_insert_owner
on public.inbox_capture_files for insert to authenticated
with check (
  owner_id = (select auth.uid())
  and exists (
    select 1 from public.operating_items i
    where i.id = inbox_item_id and i.owner_id = (select auth.uid()) and i.item_type = 'inbox'
  )
);

revoke all on public.mobile_capture_receipts, public.inbox_capture_files from public, anon, authenticated;
grant select on public.mobile_capture_receipts to authenticated;
grant select, insert on public.inbox_capture_files to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'dcp-private-captures',
  'dcp-private-captures',
  false,
  12582912,
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/heic',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/wav'
  ]
)
on conflict (id) do nothing;

drop policy if exists dcp_private_captures_select_own on storage.objects;
create policy dcp_private_captures_select_own
on storage.objects for select to authenticated
using (
  bucket_id = 'dcp-private-captures'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists dcp_private_captures_insert_own on storage.objects;
create policy dcp_private_captures_insert_own
on storage.objects for insert to authenticated
with check (
  bucket_id = 'dcp-private-captures'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists dcp_private_captures_delete_own on storage.objects;
create policy dcp_private_captures_delete_own
on storage.objects for delete to authenticated
using (
  bucket_id = 'dcp-private-captures'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create or replace function public.create_mobile_capture(
  p_client_capture_id uuid,
  p_title text,
  p_description text default null,
  p_area text default 'personal',
  p_source text default 'text',
  p_target_user_id uuid default null,
  p_source_url text default null
)
returns public.operating_items
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := (select auth.uid());
  existing_item_id uuid;
  item public.operating_items;
  target uuid;
begin
  if actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_client_capture_id is null then raise exception 'MOBILE_CAPTURE_INVALID'; end if;
  if nullif(btrim(coalesce(p_title, '')), '') is null or char_length(btrim(p_title)) > 500 then
    raise exception 'MOBILE_CAPTURE_TITLE_REQUIRED';
  end if;
  if p_area not in ('work', 'family', 'personal') then raise exception 'MOBILE_CAPTURE_INVALID'; end if;
  if p_source not in ('text', 'voice', 'photo', 'document', 'web') then raise exception 'MOBILE_CAPTURE_INVALID'; end if;
  if p_description is not null and char_length(p_description) > 10000 then raise exception 'MOBILE_CAPTURE_INVALID'; end if;
  if p_source_url is not null and (char_length(p_source_url) > 2000 or p_source_url !~ '^https://[^[:space:]]+$') then
    raise exception 'MOBILE_CAPTURE_INVALID';
  end if;

  target := coalesce(p_target_user_id, actor);
  if target <> actor and not exists (
    select 1 from public.participant_profiles() p where p.user_id = target
  ) then
    raise exception 'MOBILE_CAPTURE_TARGET_INVALID';
  end if;

  insert into public.mobile_capture_receipts(owner_id, client_capture_id)
  values (actor, p_client_capture_id)
  on conflict (owner_id, client_capture_id) do nothing;

  select inbox_item_id into existing_item_id
  from public.mobile_capture_receipts
  where owner_id = actor and client_capture_id = p_client_capture_id
  for update;

  if existing_item_id is not null then
    select * into item from public.operating_items where id = existing_item_id;
    return item;
  end if;

  insert into public.operating_items (
    item_type, title, description, status, area, owner_id, created_by_id,
    visibility, sensitive, metadata, last_progress_at
  ) values (
    'inbox',
    btrim(p_title),
    nullif(btrim(coalesce(p_description, '')), ''),
    'inbox',
    p_area,
    actor,
    actor,
    'private',
    false,
    jsonb_build_object(
      'mobileCapture', jsonb_build_object(
        'source', p_source,
        'targetUserId', case when target = actor then null else target end,
        'sourceUrl', p_source_url,
        'hasAttachment', false
      )
    ),
    now()
  )
  returning * into item;

  update public.mobile_capture_receipts
  set inbox_item_id = item.id
  where owner_id = actor and client_capture_id = p_client_capture_id;

  return item;
end;
$$;
revoke all on function public.create_mobile_capture(uuid, text, text, text, text, uuid, text) from public, anon;
grant execute on function public.create_mobile_capture(uuid, text, text, text, text, uuid, text) to authenticated;

comment on table public.inbox_capture_files is
  'Private mobile-capture file metadata. Sharing an Inbox item does not share these files.';
