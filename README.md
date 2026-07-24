# Derek Control Panel

私人優先、雙帳戶獨立的 ADHD-friendly 生活與工作控制台。登入後標題會按帳戶顯示為 `{displayName} Panel`；所有記錄預設私人，只有明確分享、接受指派或接受共同擁有後才可見。

## 主要能力

- Today 指揮中心：唯一首要項目、WIP、容量 check-in、快捷任務及 Focus Mode
- Restart Checkpoint：Focus 暫停／離開時自動保存草稿、正式歷史、下一個最小步驟及安全資源捷徑
- Inbox Processing Mode：每次只處理一項、8 個清晰選擇、防重複提交、保留原始來源及最近一次 Undo
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
```

升級檔是 additive migration：保留舊表與資料，回填 `tasks.owner_id`，加入雙帳戶 profile／planning／sharing／operating item schema，並重建 private-by-default RLS。套用前請先備份及在 staging 驗證。

回退檔：

```text
supabase/migrations/202607220001_control_panel_operating_system.rollback.sql
supabase/migrations/20260724120731_restart_checkpoints.rollback.sql
supabase/migrations/20260724121803_checkpoint_resource_privacy.rollback.sql
supabase/migrations/20260724150744_inbox_processing_mode.rollback.sql
```

回退會移除新功能表、policy、trigger 與 function，但刻意保留舊表上新增的 nullable/default columns，避免回退本身刪除已寫入資料。示例資料在 `supabase/seed-operating-system.sql`；先替換兩個示例 user UUID，切勿在 production 直接使用佔位值。

## 驗證

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

測試涵蓋 Today 固定規則、deadline/latest-safe-start、WIP、Restart Checkpoint、Inbox 防重複／Undo 合約、跨帳戶與分享權限、busy-only redaction、通知私隱及 migration contract。正式上線前仍需以 Derek／Suki 測試帳戶跑一次真實 RLS 與登入 E2E。

## 部署

Vercel build command 使用 `npm run build`，並配置與本機相同的兩個 public Supabase environment variables。部署網址必須加入 Supabase Auth URL Configuration。Service worker 不 cache API、Dashboard、任務或其他私人頁面資料。Settings 的 About 區會顯示 app version、build time、Git commit SHA 及 environment，正式部署必須對應一個已推送 commit。

Restart Checkpoint 的資料模型、RLS 及 rollback 說明見 [`docs/restart-checkpoints.md`](docs/restart-checkpoints.md)。

Inbox Processing Mode 的 transaction、RLS、idempotency、Undo 與 rollback 說明見 [`docs/inbox-processing.md`](docs/inbox-processing.md)。
