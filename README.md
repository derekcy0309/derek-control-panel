# Derek Control Panel

私人優先、雙帳戶獨立的 ADHD-friendly 生活與工作控制台。登入後標題會按帳戶顯示為 `{displayName} Panel`；所有記錄預設私人，只有明確分享、接受指派或接受共同擁有後才可見。

## 主要能力

- Today Auto‑Plan：按個人能量、容量、buffer、deadline、safe-start、影響、context 及 WIP 提出可解釋建議；確認後才加入 Today
- Suki Minimum Viable Day：一項核心最低任務、最多兩項簡單選項、無罪疚休息、拆細、交接及指定日再處理
- Restart Checkpoint：Focus 暫停／離開時自動保存草稿、正式歷史、下一個最小步驟及安全資源捷徑
- Inbox Processing Mode：每次只處理一項、8 個清晰選擇、防重複提交、保留原始來源及最近一次 Undo
- 真正通知系統：使用者明確授權瀏覽器／PWA 通知、個別靜音時段及 night-shift、Today／deadline／Waiting／handover／Focus／shutdown 提醒、私隱安全發送紀錄
- 任務依賴與項目里程碑：明確的 blocked-by／blocks 關係、防循環檢查、Project War Room 里程碑，以及不會自動完成或改派的下一步提示
- 重複工作：每日／每週／每月／自訂週期／夜更模式；只在完成當前任務後安全建立下一項，可隨時暫停
- Body Double 同步專注：兩人各自選任務、ready 後同步開始；可個別暫停／離開／完成，結束前必須儲存自己的 checkpoint，沒有排名或自動改動任務
- Task Resource Pack：任務可連結網址、文件、Supabase Storage、聯絡人及現有 Notes／SOP／Decision／Project／Waiting；逐項明確分享，Focus Mode 只顯示可開啟資源
- Mobile Quick Capture：手機文字、拍相、文件、語音轉文字、可選原始錄音與 PWA 網頁分享，全部先進既有 Inbox；上載可重試且私人附件不會因 Inbox 分享而外洩
- Time Estimation Learning：按每人自己的預計／實際時間提出個人化估時；至少三筆資料才建議，絕不自動覆寫原本預計
- Focus Session History：持久保留每節專注的計劃／實際時間、暫停、結果、阻塞與 checkpoint，只用於恢復工作和個人估時
- Offline Write Queue：離線安全保留純文字 Inbox、checkpoint 與 Focus 暫停／完成；恢復連線後按帳戶同步、衝突不覆蓋、登出即清除本機待同步資料
- Backup／Restore：本人帳戶 JSON 與常用 CSV 匯出；還原先預覽、需明確確認，只新增缺少資料、從不覆蓋或重設 production data
- Capacity Overload Warning：以能量、可用時間、WIP、deadline、night-shift 及未來家庭／健康承諾作溫和容量提示；只建議可延期／交接項目，所有改動仍要本人確認
- Inbox、Projects、Waiting、Decisions、Clients、SOP 與家庭／學校／寵物／家務／採購／個人／健康／文件／車輛／筆記
- Deadline Intelligence：固定規則計算 latest safe start、逾期與風險
- 精確電郵分享、Assignment、Joint ownership、撤銷及審計記錄
- Cashflow、Meetings、Calendar、全域搜尋、個人設定及安全匯出
- 手機底部導覽、桌面側欄、PWA manifest、私隱安全離線頁

## 本機啟動

1. 複製 `.env.example` 為 `.env.local`。
2. 設定 `NEXT_PUBLIC_SUPABASE_URL` 及 `NEXT_PUBLIC_SUPABASE_ANON_KEY`。
3. 安裝並啟動：

```bash
npm install
npm run dev
```

Supabase Authentication 需啟用 Email，並把本機／正式網址加入 URL Configuration。Session 由 server route 寫入 HttpOnly cookie，不會放進 localStorage。

## 資料庫升級

全新專案先執行 `supabase/schema.sql`。既有專案依序套用：

```text
supabase/update-2026-07-15-task-changes.sql
supabase/migrations/202607220001_control_panel_operating_system.sql
supabase/migrations/202607220002_profile_admin_bootstrap.sql
supabase/migrations/202607220003_security_and_foreign_key_indexes.sql
supabase/migrations/20260724040911_continuous_task_handoffs.sql
supabase/migrations/20260724042142_trusted_handoff_connections.sql
supabase/migrations/20260724042409_handoff_foreign_key_indexes.sql
supabase/migrations/20260724050000_reclaim_task_handoff.sql
supabase/migrations/20260724120731_restart_checkpoints.sql
supabase/migrations/20260724121803_checkpoint_resource_privacy.sql
supabase/migrations/20260724150744_inbox_processing_mode.sql
supabase/migrations/20260724154148_today_auto_plan_mvd.sql
supabase/migrations/20260724162344_notification_system.sql
supabase/migrations/20260724181119_fix_notification_claim_conflict.sql
supabase/migrations/20260724182259_weekly_review.sql
supabase/migrations/20260724172250_task_dependencies_milestones.sql
supabase/migrations/20260724173935_recurring_task_routines.sql
supabase/migrations/20260724175911_recurrence_foreign_key_indexes.sql
supabase/migrations/20260725190000_body_double_mode.sql
supabase/migrations/20260725190100_body_double_checkpoint_eligibility.sql
supabase/migrations/20260725200000_task_resource_pack.sql
supabase/migrations/20260725200100_task_resource_pack_validation_fix.sql
supabase/migrations/20260725210000_mobile_quick_capture.sql
supabase/migrations/20260725220000_time_estimation_learning.sql
supabase/migrations/20260725230000_focus_session_history.sql
supabase/migrations/20260725235900_offline_write_queue.sql
supabase/migrations/20260726003000_backup_restore.sql
```

升級檔是 additive migration：保留舊表與資料，回填 `tasks.owner_id`，加入雙帳戶 profile／planning／sharing／operating item schema，並重建 private-by-default RLS。套用前請先備份及在 staging 驗證。

回退檔：

```text
supabase/migrations/202607220001_control_panel_operating_system.rollback.sql
supabase/migrations/20260724120731_restart_checkpoints.rollback.sql
supabase/migrations/20260724121803_checkpoint_resource_privacy.rollback.sql
supabase/migrations/20260724150744_inbox_processing_mode.rollback.sql
supabase/migrations/20260724154148_today_auto_plan_mvd.rollback.sql
supabase/migrations/20260724162344_notification_system.rollback.sql
supabase/migrations/20260724181119_fix_notification_claim_conflict.rollback.sql
supabase/migrations/20260724182259_weekly_review.rollback.sql
supabase/migrations/20260724172250_task_dependencies_milestones.rollback.sql
supabase/migrations/20260724173935_recurring_task_routines.rollback.sql
supabase/migrations/20260724175911_recurrence_foreign_key_indexes.rollback.sql
supabase/migrations/20260725190000_body_double_mode.rollback.sql
supabase/migrations/20260725190100_body_double_checkpoint_eligibility.rollback.sql
supabase/migrations/20260725200000_task_resource_pack.rollback.sql
supabase/migrations/20260725200100_task_resource_pack_validation_fix.rollback.sql
supabase/migrations/20260725210000_mobile_quick_capture.rollback.sql
supabase/migrations/20260725220000_time_estimation_learning.rollback.sql
supabase/migrations/20260725230000_focus_session_history.rollback.sql
supabase/migrations/20260725235900_offline_write_queue.rollback.sql
supabase/migrations/20260726003000_backup_restore.rollback.sql
```

回退會移除新功能表、policy、trigger 與 function，但刻意保留舊表上新增的 nullable/default columns，避免回退本身刪除已寫入資料。示例資料在 `supabase/seed-operating-system.sql`；先替換兩個示例 user UUID，切勿在 production 直接使用佔位值。

## 驗證

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

測試涵蓋 Today scoring／容量上限／Minimum Viable Day、deadline/latest-safe-start、WIP、Restart Checkpoint、Inbox 防重複／Undo 合約、依賴 blockers、重複工作 dedupe／暫停合約、Weekly Review 日期／容量／RLS 合約、Body Double session／checkpoint／私隱合約、跨帳戶與分享權限、busy-only redaction、通知私隱、Backup／Restore 格式／帳戶隔離／CSV 安全及 migration contract。正式上線前仍需以 Derek／Suki 測試帳戶跑一次真實 RLS 與登入 E2E。

## 部署

Vercel build command 使用 `npm run build`，並配置與本機相同的兩個 public Supabase environment variables。部署網址必須加入 Supabase Auth URL Configuration。Service worker 不 cache API、Dashboard、任務或其他私人頁面資料。Settings 的 About 區會顯示 app version、build time、Git commit SHA 及 environment，正式部署必須對應一個已推送 commit。

通知另需設定 `NEXT_PUBLIC_VAPID_PUBLIC_KEY`、`VAPID_PRIVATE_KEY`、`VAPID_SUBJECT` 和 `CRON_SECRET`。前者可公開，後三者只可放在 Vercel server environment；同一個 `CRON_SECRET` 的雜湊保存在 `private.notification_dispatch_config`，原值保存在 Supabase Vault。正式 Vercel route 就緒後，才可設定 Supabase Cron 每五分鐘以帶有 Bearer secret 的 HTTP request 呼叫 `/api/cron/notifications`；job 可安全重覆執行，發送工作以 dedupe key 及 claim lock 防止重複。

Restart Checkpoint 的資料模型、RLS 及 rollback 說明見 [`docs/restart-checkpoints.md`](docs/restart-checkpoints.md)。

Inbox Processing Mode 的 transaction、RLS、idempotency、Undo 與 rollback 說明見 [`docs/inbox-processing.md`](docs/inbox-processing.md)。

Today Auto‑Plan 與 Minimum Viable Day 的 scoring、確認邊界、RLS 及 rollback 說明見 [`docs/today-auto-plan.md`](docs/today-auto-plan.md)。

通知的授權、私隱 payload、RLS、server dispatch、排程啟用及 rollback 說明見 [`docs/notifications.md`](docs/notifications.md)。

任務依賴、Project milestones、RLS、cycle prevention 及 rollback 說明見 [`docs/task-dependencies-milestones.md`](docs/task-dependencies-milestones.md)。

重複工作的 completion-only generation、RLS、私隱與 rollback 說明見 [`docs/recurring-routines.md`](docs/recurring-routines.md)。

低壓力 Weekly Review 的資料、capacity 提示、確認邊界及 rollback 說明見 [`docs/weekly-review.md`](docs/weekly-review.md)。

Body Double 的兩人 session、checkpoint 完成條件、私隱、重連及 rollback 說明見 [`docs/body-double.md`](docs/body-double.md)。

Task Resource Pack 的類型、Focus Mode、RLS、Storage signed URL 及 rollback 說明見 [`docs/task-resource-pack.md`](docs/task-resource-pack.md)。

Mobile Quick Capture 的 Inbox 整合、idempotency、PWA share target、私人附件與 rollback 說明見 [`docs/mobile-quick-capture.md`](docs/mobile-quick-capture.md)。

Time Estimation Learning 的個人化建議、RLS、資料不足邊界及 rollback 說明見 [`docs/time-estimation-learning.md`](docs/time-estimation-learning.md)。

Focus Session History 的狀態、checkpoint 關聯、RLS、idempotency 及 rollback 說明見 [`docs/focus-session-history.md`](docs/focus-session-history.md)。

Offline Write Queue 的帳戶分區、本機私隱、衝突、冪等同步及 rollback 說明見 [`docs/offline-write-queue.md`](docs/offline-write-queue.md)。

Backup／Restore 的匯出範圍、預覽、只新增 transaction、RLS 及 rollback 說明見 [`docs/backup-restore.md`](docs/backup-restore.md)。

Capacity Overload Warning 的計算資料、buffer、低影響候選、確認邊界及私隱說明見 [`docs/capacity-overload-warning.md`](docs/capacity-overload-warning.md)。
