# 三角色每日工作流程

## 架構決定

- `public.tasks` 繼續是唯一 Work Queue；沒有建立第二套任務表。
- `workspace_role` 只控制首頁顯示，不授予管理員或資料權限。
- 交接沿用 `assignments`、`task_handoff_notes`、`share_records` 及現有 RLS。
- 財務沿用 `transactions`、`balances` 及現有 Cashflow 頁；Derek 首頁只讀取本月三個摘要數字。
- 語音使用瀏覽器／作業系統原生 Speech Recognition，沒有保存錄音或新增付費 AI。
- 自由文字只由本機規則整理成可修改預覽；確認前不會寫入資料庫。

## 新流程

1. 主頁按「語音交接」或「新增任務」。
2. 語音／文字先自動保存在該分頁的 versioned `sessionStorage`。
3. 規則整理個案代號、下一步、負責人、日期、物資、RN、家屬更新及待確認人。
4. 使用者修改並確認預覽；可能重複時必須再次明確確認。
5. `client_request_id` 防止網絡重試重複建立任務。
6. 指派另一人時沿用現有 handoff，對方接受前不會當作已開始。
7. 指定決定人只可確認 decision 欄位，不能藉此編輯任務其他內容。

## 資料庫

Migration：`20260804100000_three_role_daily_workflow.sql`

新增：

- `user_profiles.workspace_role`
- `tasks.case_code`
- `tasks.task_type`
- `tasks.needs_decision_from_id`
- `tasks.decision_resolved_at`
- `tasks.decision_resolved_by_id`
- `tasks.materials_required`
- `tasks.rn_required`
- `tasks.client_update_required`
- `tasks.client_request_id`
- `notification_preferences.quiet_mode_until`

Migration 不更新、搬動或刪除既有任務、財務或帳戶資料。新增外鍵及常用查詢均有索引；現有 table RLS 繼續保護新增欄位。

## 定期任務沒有期限

新增定期任務時，可在「每次是否有期限」選擇：

- 「每次有到期日」：沿用原本行為，下一個週期日期是該次到期日。
- 「沒有期限，只按週期提示」：不建立假逾期；週期日期會保存為提示／安排日期。到時該次工作會持續顯示，直至使用者按「今次已完成」、延後或暫停規則。

現有定期任務亦可在任務卡切換模式。切換為沒有期限時，目前未完成一輪的原有到期日會保留為安排／提示日期後才清除，因此不會遺失原本的提示時間，也不會被標示成逾期。

Migration：`20260804130000_recurring_no_deadline_reminders.sql`

- 新增 `task_recurrence_rules.deadline_mode`，舊規則預設維持 `scheduled`。
- 新增個人通知偏好 `notification_preferences.recurrence_enabled`。
- 每次完成只建立一個 successor；`notification_deliveries` 的 dedupe key 防止同一規則同一時段重複提示。
- 已授權 Browser／PWA 通知時，無期限 recurrence 會按使用者時區及 Today 提醒時間排入 server-side queue；安靜模式仍然生效。
- 鎖定畫面只顯示中性內容，不包括任務名稱、個案或健康資料。

## 回復

配對 rollback：`20260804100000_three_role_daily_workflow.rollback.sql`。

正式執行 rollback 前必須先匯出新欄位資料；rollback 會還原通知及 task update helper，再移除本版本新增欄位。核心 task、finance、account rows 不會被刪除。

## 私隱與安全

- 通知及 audit log 只保存中性摘要，不保存原始語音／交接全文。
- 原始文字只保存在獲授權的 task description；登出會清除本機未送出草稿。
- 高風險且明確標示 `safety_impact` 的工作可穿過安靜模式；其他通知延至恢復時間。
- 臨床內容只會成為待確認工作，不會自動診斷、安排治療或改動任務狀態。
- 角色首頁只列出資料庫內真實、active、handoff-enabled 的參與者；不建立虛構帳戶。

## 部署前檢查

1. 在 Preview Supabase backup／branch 驗證 migration 及 rollback。
2. 用 Derek、Suki、Amigo 三個真實測試帳戶檢查 RLS 和角色首頁。
3. 測試語音不支援、缺日期、重複提交、待決定確認、安靜模式及網絡重試。
4. Preview 通過後才可由使用者另行批准 production migration／deployment。
