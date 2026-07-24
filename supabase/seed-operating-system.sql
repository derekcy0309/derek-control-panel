-- Development/demo only. Never run against production.
-- Replace both UUIDs with two fictional Supabase Auth test accounts.
do $$
declare
  derek_user uuid := '11111111-1111-4111-8111-111111111111';
  suki_user uuid := '22222222-2222-4222-8222-222222222222';
  assigned_task uuid;
  joint_item uuid;
begin
  if current_database() ilike '%prod%' then raise exception 'Demo seed refused on production-like database'; end if;

  insert into public.user_profiles(user_id, display_name) values (derek_user, 'Derek'), (suki_user, 'Suki')
  on conflict (user_id) do update set display_name = excluded.display_name;
  insert into public.user_settings(user_id, email, gentle_mode, dashboard_density, wip_limit)
  values (derek_user, 'derek.demo@example.com', false, 'comfortable', 3), (suki_user, 'suki.demo@example.com', true, 'calm', 2)
  on conflict (user_id) do nothing;

  insert into public.tasks(user_id, owner_id, created_by_id, scope, area, source_type, title, due_date, status, next_action, risk, critical_path, estimated_minutes, energy_level, visibility)
  values (derek_user, derek_user, derek_user, 'company', 'work', 'deadline', '整理社署申請尚欠文件', current_date + 5, 'not_started', '開啟申請清單，標記三份尚欠文件', 'high', true, 30, 'high', 'private')
  returning id into assigned_task;
  insert into public.tasks(user_id, owner_id, created_by_id, scope, area, source_type, title, due_date, status, next_action, risk, critical_path, estimated_minutes, energy_level, visibility)
  values (derek_user, derek_user, derek_user, 'company', 'work', 'follow_up', '跟進會計師回覆', current_date + 2, 'waiting', '發送一段簡短跟進訊息', 'medium', false, 10, 'low', 'private');

  insert into public.operating_items(item_type, title, description, status, area, owner_id, created_by_id, due_date, next_action, sensitive, metadata)
  values
    ('sop', 'TPN 服務開始 SOP', '虛構示範範本，不含病人資料。', 'active', 'work', derek_user, derek_user, current_date + 14, '列出必備文件及物資', true, '{"checklist":["確認轉介","核對物資","安排 RN"]}'),
    ('client', '虛構個案報價', '只供開發測試。', 'active', 'work', derek_user, derek_user, current_date + 3, '完成虛構報價草稿', true, '{"monthlyRevenue":24000,"conversionProbability":60}'),
    ('school', '學校通告：虛構戶外活動', '示範學校通告。', 'active', 'family', suki_user, suki_user, current_date + 7, '確認是否參加並準備回條', true, '{}'),
    ('pet', '寵物每月防蟲', '虛構寵物照護紀錄。', 'active', 'family', suki_user, suki_user, current_date + 4, '查看上次防蟲日期', false, '{}'),
    ('shopping', '家庭補給', '牛奶、清潔用品。', 'active', 'family', derek_user, derek_user, null, '到超市時打開清單', false, '{"store":"附近超市"}');
  insert into public.operating_items(item_type, title, description, status, area, owner_id, created_by_id, due_date, next_action, sensitive, metadata)
  values ('household', '共同家居維修', '安排虛構冷氣檢查。', 'active', 'family', derek_user, derek_user, current_date + 10, '聯絡兩間維修公司報價', false, '{}')
  returning id into joint_item;

  insert into public.share_records(resource_type, resource_id, owner_id, shared_with_user_id, permission, share_type)
  values ('task', assigned_task, derek_user, suki_user, 'update_status', 'assignment'),
         ('operating_item', joint_item, derek_user, suki_user, 'co_owner', 'joint');
  insert into public.assignments(resource_type, resource_id, assigned_by_id, assigned_to_id, status, due_date, requested_priority)
  values ('task', assigned_task, derek_user, suki_user, 'pending_acceptance', current_date + 5, 3);
  insert into public.joint_memberships(resource_type, resource_id, user_id, role, invited_by_id)
  values ('operating_item', joint_item, suki_user, 'co_owner', derek_user);
end $$;
