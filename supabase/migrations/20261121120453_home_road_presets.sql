-- Private per-account choices. NULL uses suggested routes; an empty list means none.
alter table public.dayline_info_choices add column road_presets text[] default null,
  add constraint dayline_road_shape check (road_presets is null or (coalesce(array_ndims(road_presets),1)=1 and cardinality(road_presets)<=24 and array_position(road_presets,null) is null and length(array_to_string(road_presets,','))<=480));
grant update(road_presets) on public.dayline_info_choices to authenticated;
create function public.dayline_set_routes(routes text[]) returns void language plpgsql security invoker set search_path='' as $$
begin
 if routes is null or coalesce(array_ndims(routes),1)<>1 or cardinality(routes)>24 or exists(select 1 from unnest(routes) as r where r is null or (r not in ('r3','cht','tm-in','tm-out','airport','eht','wht','lion','tate') and r !~ '^(H[0-9]{1,2}|K[0-9]{2}|N[0-9]{2}|SJ[0-9]):[A-Z]{2,5}$')) or cardinality(routes)<>(select count(distinct x) from unnest(routes) x) then raise exception 'Invalid routes'; end if;
 insert into public.dayline_info_choices(user_id,road_presets) values((select auth.uid()),routes) on conflict(user_id) do update set road_presets=excluded.road_presets;
end $$;
revoke all on function public.dayline_set_routes(text[]) from public,anon,authenticated;
grant execute on function public.dayline_set_routes(text[]) to authenticated;
