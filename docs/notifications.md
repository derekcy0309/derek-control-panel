# Notification System

## 使用方式

每個帳戶在 Settings 的「真正通知系統」自行按「允許並啟用通知」。瀏覽器授權、Push subscription、通知類型、時區、安靜時段、night-shift 與提前時間全部按帳戶及裝置處理；關閉某一裝置不會影響另一帳戶或另一裝置。

可選提醒包括 Today 第一項、deadline、Waiting 跟進、handover、Focus timer 完成及每日收尾。通知內容只使用一般文字，例如「一項工作限期接近」，不會包含 task 標題、筆記、健康、家庭、兒童、金額或聯絡資料。

Suki 可在首頁啟用臨時安靜模式。期間只保留同時屬於高風險及 safety impact 的真正緊急工作；一般 Today、交接及待確認摘要會收起，資料及其他帳戶完全不受影響。`quiet_mode_until` 只屬於目前登入帳戶。

每日電郵由 `20260804160000_suki_workflow_followups.sql` 合併家屬／客戶回覆、RN、物資、付款、過去 30 日仍未處理事項及未來設定範圍。`email_digest_deliveries` 的 `(user_id, digest_date)` 唯一約束保證每個帳戶每天最多一封；只讀取該帳戶原本有權查看的任務、工作項目及本人現金流，沒有項目時不寄出。

## 資料與權限

Migration `20260724162344_notification_system.sql` 新增：

- `notification_preferences`：每個帳戶的通知設定
- `push_subscriptions`：個別瀏覽器 subscription
- `notification_deliveries`：已安排、已發出、已開啟、失敗或取消的 generic delivery log
- `notification_attempts`：每個 subscription 的 server dispatch attempt

四張帳戶資料表都已啟用 RLS。使用者只能讀取自己的 preference、subscription、delivery 及 attempt；delivery history 不授權由瀏覽器直接新增、修改或刪除。狹窄的 RPC 會重新確認 `auth.uid()` 和該 delivery 的 owner，再處理 Focus cancel／本機完成／通知開啟。Push endpoint 儲存由一個受驗證 RPC 處理，確保同一個瀏覽器 endpoint 只屬於目前帳戶。

Migration `20260724181119_fix_notification_claim_conflict.sql` 修正 dispatch claim RPC 的 PL/pgSQL 名稱歧義：改為指定既有的 notification-attempt 唯一約束，不改變 delivery、subscription 或 task 資料。配對 rollback 會還原當時的函式定義（亦會還原已知錯誤），只應在整個通知版本需要回退時使用。

## Server dispatch 與排程

`/api/cron/notifications` 只接受與 `CRON_SECRET` 完全一致的 Bearer header。它會：

1. 安排到期的 Today、deadline、Waiting 及 shutdown delivery；
2. 以 row lock claim 一小批到期工作；
3. 用 VAPID 發送 generic Web Push；
4. 寫入 sent、opened、retry、failed 或 revoked subscription 狀態。

每份 delivery 有 `(user_id, dedupe_key)` unique constraint；claim timeout、retry backoff 和 HTTP 404／410 subscription revoke 都是冪等處理。Focus Mode 在畫面開啟時亦會排程；如果畫面仍開啟，service worker 的本機通知會先記錄完成，避免 server fallback 再次排入。

部署成功而且 Vercel 已安全儲存所有 VAPID／cron environment values 後，才在 Supabase Cron 啟用名為 `dcp-notification-dispatch` 的每五分鐘 job。job 以 Supabase Vault 的 secret 發送 HTTP POST 到 production route；rollback 會先取消該 job，再刪除通知專用 tables、functions、triggers 和 policies，不會刪除 task、handover 或帳戶資料。

## 失敗與私隱保護

瀏覽器未支援、沒有授權、subscription 已失效或 VAPID 尚未設定時，任務／Focus／handover 基本功能仍照常運作；Settings 只顯示清楚狀態，不會聲稱通知已經發送。Service worker 不 cache API 或私人頁面，登入帳戶資料不會因通知而寫入 cache。 
