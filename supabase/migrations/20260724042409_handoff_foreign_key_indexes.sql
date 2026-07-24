create index if not exists task_handoff_notes_author_idx
  on public.task_handoff_notes(author_id);
create index if not exists user_handoff_connections_created_by_idx
  on public.user_handoff_connections(created_by_id);
