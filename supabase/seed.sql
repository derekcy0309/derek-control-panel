-- 使用前請把下面的 user_id 換成你的 Supabase Auth 使用者 id。
-- 可在 Supabase Dashboard > Authentication > Users 複製 id。

do $$
declare
  target_user uuid := '00000000-0000-0000-0000-000000000000';
begin
  insert into public.user_settings (user_id, email, daily_reminder_time, default_reminder_days)
  values (target_user, 'derek@example.com', '09:00', 3)
  on conflict (user_id) do update set
    email = excluded.email,
    daily_reminder_time = excluded.daily_reminder_time,
    default_reminder_days = excluded.default_reminder_days;

  insert into public.balances (user_id, scope, month, opening_balance)
  values
    (target_user, 'home', date_trunc('month', current_date)::date, 38000),
    (target_user, 'company', date_trunc('month', current_date)::date, 125000)
  on conflict (user_id, scope, month) do update set opening_balance = excluded.opening_balance;

  insert into public.tasks (user_id, scope, source_type, title, owner, due_date, follow_up_date, status, next_action, risk, notes)
  values
    (target_user, 'company', 'follow_up', '跟進客戶 A 合約尾款', 'Derek', current_date - interval '1 day', current_date, 'blocked', '打開上次電郵，回覆一句確認付款日期。', 'high', '客戶回覆慢，影響公司現金流。'),
    (target_user, 'home', 'deadline', '交屋苑管理費', 'Derek', current_date + interval '2 day', current_date, 'not_started', '打開銀行 App，確認管理費金額。', 'medium', '家庭付款事項。'),
    (target_user, 'company', 'meeting_action', '整理今日客戶會議行動清單', 'Derek', current_date, current_date, 'in_progress', '把會議紀錄貼到會議頁。', 'high', '會後工作要即日收口。'),
    (target_user, 'home', 'follow_up', '確認保險自動轉帳', 'Derek', current_date + interval '5 day', current_date + interval '3 day', 'waiting', '找出銀行扣款紀錄截圖。', 'low', null);

  insert into public.transactions (user_id, scope, type, item, category, amount, expected_date, actual_date, frequency, status, payment_method, owner, notes)
  values
    (target_user, 'company', 'income', '客戶 A 尾款', '客戶收入', 48000, current_date - interval '2 day', null, 'one_time', 'delayed', '銀行轉帳', 'Derek', '需要今日跟進。'),
    (target_user, 'company', 'income', '月費客戶 B', '月費', 18000, current_date + interval '4 day', null, 'monthly', 'expected', '銀行轉帳', 'Derek', null),
    (target_user, 'home', 'expense', '屋苑管理費', '家庭固定支出', 3600, current_date + interval '2 day', null, 'monthly', 'unpaid', '銀行轉帳', 'Derek', null),
    (target_user, 'company', 'expense', '軟件訂閱', '營運', 1200, current_date + interval '6 day', null, 'monthly', 'unpaid', '信用卡', 'Derek', null),
    (target_user, 'home', 'expense', '電費', '家庭帳單', 820, current_date - interval '3 day', current_date - interval '2 day', 'monthly', 'paid', '自動轉帳', 'Derek', null);

  insert into public.meetings (user_id, scope, meeting_name, meeting_date, raw_notes, summary)
  values
    (target_user, 'company', '客戶 A 收款會議', current_date, '客戶表示財務同事本週處理。Derek 要補發 invoice 和付款資料。', '下一步：補發 invoice，要求確認付款日期。'),
    (target_user, 'home', '家庭財務整理', current_date - interval '1 day', '本月要確認管理費、保險和電費。', '下一步：先處理 3 日內要付款項。');
end $$;
