-- Safe rollback: disable new follow-up scheduling, retain child links and data.
drop function if exists public.enqueue_assignment_followups(text, timestamptz);
