-- Additive appearance upgrade. Themes never affect task priority or authorization.
alter table public.user_settings
  add column if not exists visual_intensity text not null default 'balanced';

alter table public.user_settings drop constraint if exists user_settings_theme_check;
alter table public.user_settings add constraint user_settings_theme_check
  check (theme in ('light','dark','system','sunrise','ocean','aurora','night_shift'));

alter table public.user_settings drop constraint if exists user_settings_visual_intensity_check;
alter table public.user_settings add constraint user_settings_visual_intensity_check
  check (visual_intensity in ('quiet','balanced','vivid'));

comment on column public.user_settings.visual_intensity is
  'Visual stimulation preference only; never changes task data, scoring or permissions.';
