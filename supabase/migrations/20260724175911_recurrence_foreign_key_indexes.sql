-- Cover recurrence foreign keys used by cascade checks and audit lookups.
-- This is additive and does not alter any routine, task, or RLS behaviour.

create index if not exists task_recurrence_rules_created_by_idx
  on public.task_recurrence_rules(created_by_id);
create index if not exists task_recurrence_generations_source_task_idx
  on public.task_recurrence_generations(source_task_id);
create index if not exists task_recurrence_generations_generated_task_idx
  on public.task_recurrence_generations(generated_task_id)
  where generated_task_id is not null;
