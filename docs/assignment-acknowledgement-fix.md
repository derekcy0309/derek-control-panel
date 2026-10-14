# 交辦「確認收到」權限修正（2026-10-14）

## 問題及根因

前端 `acknowledge_assignment` 只寫入 `assignments.acknowledged_at`，不應把「確認收到」等同接受任務。
2026-10-04 加入此欄位及通知 trigger 時，未同步修改既有 `private.enforce_assignment_update_permission()`：
舊 guard 不容許收件人在 `pending_acceptance` 狀態更新，也不容許改 `acknowledged_at`，因此拋出 `ASSIGNMENT_UPDATE_FORBIDDEN`。
正式日誌與 authenticated 收件人的真實資料庫測試均已重現，並非帳戶登入或一般 SELECT RLS 問題。

## 修正範圍

- Migration：`supabase/migrations/20261014065549_assignment_acknowledgement_permission.sql`（Supabase CLI 2.109.1 產生）。
- Derek self `ygsfertgpaofaanvxjkg` 已套用；遠端 migration 版本 `20261014065941`，名稱 `assignment_acknowledgement_permission`。
- 僅修改既有 private trigger guard。先獨立檢查 acknowledgement，再進入原有派出者／收件人進度規則。
- 只有原收件人、仍待接受、尚未確認、只更新確認時間（及系統更新時間）才准許。
- 不可夾帶狀態、期限、instructions 或身份變更；派出者不能代確認；確認後不可清除或改寫。
- 沿用既有 trigger 的伺服器時間、通知偏好／安靜時段及去重 key。
- 不修改 RLS、table grants、既有任務、分享設定、帳戶或實際通知偏好；private guard 不對 anon／authenticated 開放直接執行。
- 沒有改前端或 API；共用此資料庫的既有 Production／Preview 即時使用修正，不需發佈其他未驗收頁面。

## 驗證及限制

`tests/sql/assignment-acknowledgement.sql` 並非 mock：用三個現有 active／handoff-enabled 帳戶輪流作派出者、收件人及第三者，實際切換 `authenticated` 與對應 `auth.uid()`。

每組驗證：

1. `start_task_handoff` 建立測試交辦及原有分享／notes。
2. 收件人不能在確認時夾帶修改內容、期限或接受狀態；派出者不能代確認。
3. 第三者不能讀取或確認此交辦及任務。
4. 收件人確認成功，時間由 server 提供；其他欄位不變，仍待接受。
5. 按 API 同一 `acknowledged_at IS NULL` 條件重試，不更新第二次，也不重複建立回覆通知。
6. 派出者可讀回確認時間及唯一一項確認通知。
7. 按現行 `assignment_response/accept` 的資料庫寫入次序，接受、設定目前負責人、加交接 note 和 audit log 均成功。
8. 派出者可讀到接受狀態、目前負責人、交接 note，以及唯一一項接受通知；收件人仍可更新進度。

測試在 subtransaction 最後刻意 rollback：測試任務、分享、交辦、notes、audit、通知及臨時通知偏好全部回復，不會發送測試通知或留下任務。原報錯交辦仍保持 `pending_acceptance`、未 acknowledge、未 accept。

發佈時把相同測試作為 migration 的 atomic release gate；任一非預期錯誤都會中止套用。套用後再獨立重跑三組測試，全部通過。另有 284 項單元／合約測試通過。

本次是資料庫實測及現行 API 寫入次序驗證，並未冒用三個使用者登入瀏覽器，也未驗證裝置實際收到 Web Push。通知測試確認佇列、收件人、去重及可讀回，不把「已排入通知」宣稱為「裝置已收到」。

## 重跑及回復

- 本機契約測試：`npm run test:handoff`。
- 真實資料庫測試：以管理 SQL 連線執行 `tests/sql/assignment-acknowledgement.sql`；需至少三個現有 active／handoff-enabled 帳戶，不會建立新帳戶。
- 如測試舊版本，先在同一 session 設定 `test.expect_legacy_ack_failure = 'on'`；修正版本測試須設為 `off` 或用新 session。
- 回復檔：`supabase/rollback-20261014065549-assignment-acknowledgement-permission.sql`。不刪資料，但會恢復原本 acknowledgement bug，只有明確需要回復才套用。

## 安全檢查

前後 advisor 數目相同，沒有新增警告。原有 6 項匿名及 34 項已登入使用者可執行 SECURITY DEFINER 函數，以及 1 項 leaked-password protection 未開啟，並非本次新增；未藉此次修正改動其他模組。
後續檢查參考：[匿名函數權限](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable)、[登入使用者函數權限](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)、[密碼保護](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)。
