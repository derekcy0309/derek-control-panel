-- Cross-table trigger hotfix.
-- A trigger record only exposes columns from its source table. Reading
-- the operating-item-only field on a tasks row raises an error even behind a table-name guard,
-- so inspect the dynamic record through JSON instead.

create or replace function private.apply_family_visibility()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_household_id uuid;
begin
  if tg_table_name = 'operating_items'
     and to_jsonb(new) ->> 'item_type' = 'inbox' then
    new.visibility := 'private';
    new.household_id := null;
    return new;
  end if;

  if new.area = 'family' then
    select member.household_id
      into target_household_id
      from public.household_members member
     where member.user_id = new.owner_id
       and member.status = 'accepted'
     order by member.created_at
     limit 1;

    if target_household_id is not null then
      new.visibility := 'household';
      new.household_id := target_household_id;
    else
      new.visibility := 'private';
      new.household_id := null;
    end if;
  else
    if new.visibility = 'household' then
      raise exception 'Only family resources can use household visibility';
    end if;

    new.household_id := null;
  end if;

  return new;
end;
$$;

comment on function private.apply_family_visibility() is
  'Shares processed family resources with an accepted household, keeps raw Inbox capture private, and safely supports task and operating-item records.';

revoke all on function private.apply_family_visibility()
  from public, anon, authenticated, service_role;
