# Request Duty 提示專區

## 目的

Request Duty 專區用最少輸入記錄「哪一日要提出甚麼 duty request」，避免事項散落在訊息、紙張或記憶中。

## 使用方法

1. 在側欄「工作」打開 `Request Duty`。
2. 輸入提醒日期及事項。
3. 按「加入提示」。
4. 正式提出 request 後，剔選「已 request」。
5. 系統把同一項 Task 設為 `done`，記錄完成時間，並移到可選擇顯示的已完成清單。

如誤剔，可顯示已完成項目，再取消剔選以重新開啟。

## 系統整合

- 使用既有 `tasks` 表及 `create_task`／`update_task` API，沒有第二套重複 mutation。
- `source_type = duty_request` 只負責識別專區項目。
- 專區建立的項目預設歸入 `SEC` 工作（`area = work`、`scope = home`），沿用 private-by-default RLS、audit trail、Today 排程及搜尋。
- `due_date` 是提醒日期，因此會自然進入既有 deadline 顯示及每日三日到期電郵。
- 剔選只會完成 Task，不會刪除或立即 archive，保留日後查閱紀錄。

## 資料庫升級及回退

Migration：`supabase/migrations/20260909120022_request_duty.sql`

Rollback：`supabase/migrations/20260909120022_request_duty.rollback.sql`

Rollback 不會刪除 Task；現有 `duty_request` 項目會轉回 `follow_up`，再恢復舊有 source type constraint。
