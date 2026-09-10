-- Preserve the selected theme where possible while returning to the legacy constraint.
update public.user_settings
set theme = case when theme = 'night_shift' then 'dark' else 'light' end
where theme in ('sunrise','ocean','aurora','night_shift');

alter table public.user_settings drop constraint if exists user_settings_visual_intensity_check;
alter table public.user_settings drop column if exists visual_intensity;

alter table public.user_settings drop constraint if exists user_settings_theme_check;
alter table public.user_settings add constraint user_settings_theme_check
  check (theme in ('light','dark','system'));
