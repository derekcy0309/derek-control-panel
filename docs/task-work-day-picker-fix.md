# 工作日「加入」修正 — 2026-10-05

## 原因及操作

`fd45dbc` 已修正資料庫 EXECUTE 權限，但 UI 仍要求完成日，與「完成／截止日（可留空）」矛盾。開始日及工作日已填、截止日留空時，按鈕會靜默停用。三個角色均已重現。

- 打開任務的「自訂哪幾日做／提醒」，揀日子後按「加入」；Enter 也只加入日期，不提交整個任務。
- 開始日未填時使用第一個加入的日子，**不會自動填寫或改動截止日**。
- 完成日可以留空；如有填寫，工作日仍不可超出開始／完成日。
- 已選日子即時顯示，可按日期移除；必須儲存任務才生效。
- 空白、重複、超出範圍及超過 90 日會說明原因。改開始／完成日不會偷偷刪掉選項；有衝突時須明確修正。
- 儲存失敗顯示錯誤並保留輸入。沿用現有 TaskForm 草稿及既有統一新增入口，不新增任務來源。

## Migration／schema

`supabase/migrations/20261005160000_task_work_days_optional_deadline.sql` 只修改既有 `private.valid_task_work_dates(date,date,date[])` 的純驗證函數：`p_due` 可為 NULL，其他開始日、日期範圍、唯一性及 1–90 日限制不變。

沒有新增欄位、更新任務資料、改 RLS、擴大分享權限或改通知排程。函數使用 SECURITY INVOKER，只向 authenticated 保留 EXECUTE，anon/PUBLIC 仍不可執行。沒有新增環境變數。

已套用到 Derek self（`ygsfertgpaofaanvxjkg`），遠端 migration 版本 `20261005074354`；套用後確認無截止日有效、超出完成日無效、authenticated 可執行、anon 不可執行。

檔案由 Supabase CLI `migration new` 建立；CLI 產生的 UTC 編號比既有同日手動編號小，因此順延為 `20261005160000`，確保重播時在 `20261005150500_task_work_schedule_validation_grant.sql` 之後執行。

## 驗證

- 全部 274 項單元／合約測試通過；typecheck、lint 通過。
- Next.js production build 通過。
- 六組本機瀏覽器流程：Derek、Suki、Amigo × 1280px／390px。API 使用隔離測試資料，並非三個真實帳戶登入。
- 工作日測試涵蓋無截止日、無預填開始日、空白、重複、超出範圍、修改範圍保留已選日期、Enter 加入、儲存失敗後重試、儲存後 Today 即時顯示、修改既有任務並重新打開讀回日期，以及沒有整頁 refresh。
- Supabase 預檢在 transaction 中暫時套用函數，以 authenticated 身分新增、讀回、更新 deadline-free schedule，確認非法範圍拒絕；最後 ROLLBACK，沒有留下測試任務。
- 安全檢查仍有原有 SECURITY DEFINER／密碼保護警告；本次純驗證函數不屬其中，沒有為此改動其他業務函數。

可重跑 `npm run test:schedule`。瀏覽器回歸：啟動有 Supabase **測試公開設定**的本機 Next.js，設定 `VERIFY_URL`，執行 `node tests/browser/work-days.mjs`。使用既有 Playwright 安裝；如不在專案 dependencies，`PLAYWRIGHT_MODULE` 指向其 `index.mjs`，`BROWSER_EXECUTABLE` 可指定本機 Chromium／Edge。不需要安裝付費服務，也不需真實使用者密碼。

## 回復

應用程式可回復至 Git `fd45dbc767aa1efef32a5fb1164bc8dad3ea8ca4`／原 Vercel deployment `dpl_GMJa2V7ubws5WttqepMEjWrpMXb5`，但會恢復舊 UI 問題；一般應保留新的向後相容 validator。

如確需還原資料庫函數，使用 `supabase/rollback-20261005160000-task-work-days-optional-deadline.sql`。如已存在無截止日的自訂工作日，rollback 會拒絕執行，避免令已存資料無效；不能為回復而刪除或改動這些任務。
