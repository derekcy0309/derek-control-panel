-- Guarded rollback: retain the family-visibility function installed by the
-- preceding migration and remove only the stricter one-event index.

drop index if exists public.calendar_event_links_item_unique_idx;
