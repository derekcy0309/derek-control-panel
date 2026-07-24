-- Task Resource Pack: explicit, private-by-default resources attached to a task.
-- Sharing a task never shares a resource automatically. The resource owner must
-- deliberately enable share_with_task, and linked operating items retain their
-- own RLS rules.

create table if not exists public.task_resources (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  resource_type text not null,
  label text not null,
  url text,
  storage_bucket text,
  storage_path text,
  linked_item_id uuid references public.operating_items(id) on delete set null,
  contact_name text,
  contact_phone text,
  contact_email text,
  share_with_task boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint task_resources_type_check check (
    resource_type in ('url', 'document', 'storage_file', 'contact', 'note', 'sop', 'decision', 'project', 'waiting')
  ),
  constraint task_resources_label_check check (char_length(btrim(label)) between 1 and 200),
  constraint task_resources_url_check check (url is null or (char_length(url) <= 2000 and url ~ '^https://[^[:space:]]+$')),
  constraint task_resources_storage_bucket_check check (storage_bucket is null or (char_length(storage_bucket) between 1 and 100 and storage_bucket ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$')),
  constraint task_resources_storage_path_check check (storage_path is null or (char_length(storage_path) between 1 and 1000 and storage_path !~ '(^|/)\.\.(/|$)' and storage_path !~ '^/')),
  constraint task_resources_contact_name_check check (contact_name is null or char_length(btrim(contact_name)) between 1 and 200),
  constraint task_resources_contact_phone_check check (contact_phone is null or char_length(btrim(contact_phone)) between 1 and 80),
  constraint task_resources_contact_email_check check (contact_email is null or (char_length(btrim(contact_email)) <= 320 and contact_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')),
  constraint task_resources_payload_check check (
    (resource_type = 'url' and url is not null and storage_bucket is null and storage_path is null and linked_item_id is null and contact_name is null and contact_phone is null and contact_email is null)
    or (resource_type = 'document' and storage_bucket is null and storage_path is null and contact_name is null and contact_phone is null and contact_email is null and ((url is not null and linked_item_id is null) or (url is null and linked_item_id is not null)))
    or (resource_type = 'storage_file' and url is null and storage_bucket is not null and storage_path is not null and linked_item_id is null and contact_name is null and contact_phone is null and contact_email is null)
    or (resource_type = 'contact' and url is null and storage_bucket is null and storage_path is null and linked_item_id is null and contact_name is not null and (contact_phone is not null or contact_email is not null))
    or (resource_type in ('note', 'sop', 'decision', 'project', 'waiting') and url is null and storage_bucket is null and storage_path is null and linked_item_id is not null and contact_name is null and contact_phone is null and contact_email is null)
  )
);

create index if not exists task_resources_task_updated_idx
  on public.task_resources(task_id, updated_at desc);
create index if not exists task_resources_owner_updated_idx
  on public.task_resources(owner_id, updated_at desc);
create index if not exists task_resources_linked_item_idx
  on public.task_resources(linked_item_id)
  where linked_item_id is not null;

create or replace function private.validate_task_resource()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  linked_type text;
begin
  if new.owner_id <> (select auth.uid()) then
    raise exception 'TASK_RESOURCE_OWNER_REQUIRED';
  end if;
  if not private.current_user_can_checkpoint(new.task_id) then
    raise exception 'TASK_RESOURCE_FORBIDDEN';
  end if;
  if tg_op = 'UPDATE' and (new.id <> old.id or new.task_id <> old.task_id or new.owner_id <> old.owner_id or new.created_at <> old.created_at) then
    raise exception 'TASK_RESOURCE_IDENTITY_IMMUTABLE';
  end if;

  if new.resource_type in ('note', 'sop', 'decision', 'project', 'waiting')
     or (new.resource_type = 'document' and new.linked_item_id is not null) then
    select item_type into linked_type from public.operating_items where id = new.linked_item_id;
    if linked_type is null
       or not private.current_user_can_read('operating_item', new.linked_item_id)
       or (new.resource_type <> 'document' and linked_type <> new.resource_type)
       or (new.resource_type = 'document' and linked_type <> 'document') then
      raise exception 'TASK_RESOURCE_LINK_INVALID';
    end if;
  end if;

  new.label := btrim(new.label);
  new.contact_name := nullif(btrim(coalesce(new.contact_name, '')), '');
  new.contact_phone := nullif(btrim(coalesce(new.contact_phone, '')), '');
  new.contact_email := nullif(lower(btrim(coalesce(new.contact_email, ''))), '');
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function private.validate_task_resource() from public, anon, authenticated;

drop trigger if exists validate_task_resource_trigger on public.task_resources;
create trigger validate_task_resource_trigger
before insert or update on public.task_resources
for each row execute function private.validate_task_resource();

alter table public.task_resources enable row level security;

drop policy if exists task_resources_select_explicit on public.task_resources;
create policy task_resources_select_explicit
on public.task_resources for select to authenticated
using (
  (
    owner_id = (select auth.uid())
    and private.current_user_can_read('task', task_id)
  )
  or (
    share_with_task
    and private.current_user_can_read('task', task_id)
    and (linked_item_id is null or private.current_user_can_read('operating_item', linked_item_id))
  )
);

drop policy if exists task_resources_insert_owner on public.task_resources;
create policy task_resources_insert_owner
on public.task_resources for insert to authenticated
with check (
  owner_id = (select auth.uid())
  and private.current_user_can_checkpoint(task_id)
);

drop policy if exists task_resources_update_owner on public.task_resources;
create policy task_resources_update_owner
on public.task_resources for update to authenticated
using (
  owner_id = (select auth.uid())
  and private.current_user_can_checkpoint(task_id)
)
with check (
  owner_id = (select auth.uid())
  and private.current_user_can_checkpoint(task_id)
);

drop policy if exists task_resources_delete_owner on public.task_resources;
create policy task_resources_delete_owner
on public.task_resources for delete to authenticated
using (
  owner_id = (select auth.uid())
  and private.current_user_can_checkpoint(task_id)
);

revoke all on public.task_resources from public, anon, authenticated;
grant select, insert, update, delete on public.task_resources to authenticated;

comment on table public.task_resources is
  'Task resources are owner-private by default. share_with_task is an explicit opt-in and never bypasses operating item or Storage access policies.';
