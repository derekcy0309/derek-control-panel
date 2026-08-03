# 管理員帳戶活動

`/admin/accounts` 只會向 `user_profiles.is_admin = true` 且啟用中的帳戶顯示。管理員可查看現有 Auth 帳戶的顯示名稱、電郵、帳戶狀態、建立日期、上次登入及上次使用。

- 上次登入：Supabase Auth 的 `last_sign_in_at`，由 server-only Admin API 讀取。
- 上次使用：`user_profiles.last_seen_at`，每次完成認證的 Portal request 後最多每五分鐘更新一次。
- 清單不會傳送或顯示密碼、refresh token、任務、健康、家庭或其他私人內容。
- 瀏覽器只呼叫受管理員檢查保護的 `/api/admin/users`；`SUPABASE_SERVICE_ROLE_KEY` 只存在 server route。

## Migration 與回復

`20260803100000_admin_account_activity.sql` 只加入 nullable `last_seen_at`、索引及 self-only 的 `SECURITY INVOKER` touch function。它沿用既有 profile RLS；一般使用者不能讀取其他 profile。

Rollback 會移除 function 和 index，刻意保留 nullable column，避免刪除已記錄的活動時間。回退 application commit 後，這個未使用欄位不會影響既有功能。
