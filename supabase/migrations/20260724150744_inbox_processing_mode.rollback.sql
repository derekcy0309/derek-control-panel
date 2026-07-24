drop function if exists public.undo_last_inbox_processing(uuid);
drop function if exists public.process_inbox_item(uuid, text, uuid, uuid, jsonb);

alter table public.operating_items
  drop constraint if exists operating_items_inbox_processing_event_fkey;

drop table if exists public.inbox_processing_events;

drop index if exists public.operating_items_inbox_queue_idx;

alter table public.operating_items
  drop column if exists inbox_processing_event_id,
  drop column if exists inbox_processed_at,
  drop column if exists inbox_available_after;
