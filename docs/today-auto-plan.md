# Today Auto‑Plan 與 Minimum Viable Day

## 行為邊界

Auto‑Plan 只產生建議。預覽階段不會新增、完成、延期、交接或修改任務；使用者按「確認加入 Today」後，系統才會寫入該使用者自己的 `user_planning_metadata`。重新安排、太難、換一件及拆細一點同樣只重算或顯示建議。

確認由 `accept_today_auto_plan` transaction 處理：

- 每次最多一項 `now`、兩項 `later` 及三項 `quick_win`。
- `idempotency_key` 防止重複提交。
- 只接受登入者擁有或已接受交接的任務。
- `done`、`cancelled`、`blocked`、`waiting` 或有 `blocked_reason` 的任務會被拒絕。
- 只取代同一使用者、同一日、來源為 `auto_plan` 的舊建議；手動安排及對方安排不會被清除。
- 不會更新 `tasks.status`、deadline、owner 或 assignee。

`today_plan_acceptances` 是 append-only 私人審計記錄。Authenticated role 只有 SELECT／INSERT，RLS 限定 `user_id = auth.uid()`。

## Scoring 與容量

所有排序規則集中在 `lib/planning.ts`，並由 `tests/planning.test.ts` 覆蓋。評分會考慮：

- deadline 及 latest safe start
- safety、child／family、legal 及 revenue impact
- critical path
- 已開始及已接受交接
- 個人 priority 及已安排日期
- 今日能量、night-shift-friendly context
- WIP limit
- 預計分鐘

系統先預留約 20% buffer，再以剩餘分鐘揀一項 Now、最多兩項 Later 及一至三項 Quick Wins。沒有預計分鐘時使用保守預設；所有選入項目連 buffer 不會超出今日可用分鐘。超出容量的 backlog 只作提示，不會全部塞入 Today。

## Minimum Viable Day

Suki 在低能量、Gentle 或 minimum-step 模式會進入 Minimum Viable Day；Derek 亦可在今日容量選擇同一模式。

- 只顯示一項核心最低任務。
- 額外項目最多兩項，每項不超過 10 分鐘。
- 隱藏 Today 畫面的 backlog 數字，但原有任務及 Handover 頁仍保留。
- 「今日休息」只在 `daily_capacity_checkins.rest_day` 記錄當日選擇，不會移動或完成任何任務。
- 「只完成第一步」開啟 10 分鐘 Focus，並保留 Restart Checkpoint。
- 「請對方接手」及「延至指定日」都需要使用者明確確認。
- 已確認的核心任務完成後顯示「今日核心責任已完成」。

## Migration 與 rollback

Migration：

`supabase/migrations/20260724154148_today_auto_plan_mvd.sql`

Rollback：

`supabase/migrations/20260724154148_today_auto_plan_mvd.rollback.sql`

Rollback 會移除 acceptance audit table、新 RPC 及新增的 planning／rest 欄位，但不會刪除 `tasks`、`assignments`、`user_planning_metadata` 或 `daily_capacity_checkins`，亦不會清空 production 資料。
