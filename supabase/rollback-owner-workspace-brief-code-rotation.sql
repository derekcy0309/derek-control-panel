-- Roll back the app first. Disable the issuer without reviving any superseded
-- code or invalidating the already delivered replacement. Keep its lease and
-- audit metadata, and retain the concurrent stale-key safety check.
revoke execute on function public.rotate_owner_workspace_brief_code(uuid,uuid,timestamptz,text,uuid) from service_role;
