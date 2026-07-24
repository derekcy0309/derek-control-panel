-- Correct the regular-expression escaping in the first Resource Pack migration.
-- This keeps direct database writes subject to the same path and email checks
-- as the server API. It is safe on an empty or populated table.

alter table public.task_resources
  drop constraint if exists task_resources_storage_path_check,
  add constraint task_resources_storage_path_check check (
    storage_path is null
    or (
      char_length(storage_path) between 1 and 1000
      and storage_path !~ '(^|/)\.\.(/|$)'
      and storage_path !~ '^/'
    )
  );

alter table public.task_resources
  drop constraint if exists task_resources_contact_email_check,
  add constraint task_resources_contact_email_check check (
    contact_email is null
    or (
      char_length(btrim(contact_email)) <= 320
      and contact_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    )
  );
