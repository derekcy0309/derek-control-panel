-- Reversible performance-only recurrence indexes.

drop index if exists public.task_recurrence_rules_created_by_idx;
drop index if exists public.task_recurrence_generations_source_task_idx;
drop index if exists public.task_recurrence_generations_generated_task_idx;
