-- The base source migration already contains these corrected constraints.
-- Retain the stricter validation on rollback rather than reintroducing a
-- pre-release escaping defect.
select 1;
