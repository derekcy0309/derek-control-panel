# Inbox Processing Mode

## 使用流程

`/workspace/inbox` 預設進入逐項處理模式，只載入目前一項及最多 20 項分頁清單，不會讀取整個 backlog。每項提供：

- 立即做
- 建立任務
- 加入 Project
- 加入 Waiting
- 交給 Derek／Suki
- 安排日期
- 保留作 Notes／Reference
- 略過，稍後再處理

建立任務時可同時填寫 next action、預計分鐘、能量及 context。指派沿用既有 `start_task_handoff`，不會建立第二套任務或分享模型。

## 資料模型

Migration：`supabase/migrations/20260724150744_inbox_processing_mode.sql`

新增 `inbox_processing_events`，每筆只屬於目前登入使用者，保存：

- 原始 Inbox item 的完整 JSON snapshot，包括 metadata 內的來源資料
- 處理 action 及已確認的 options
- 新 target 類型與 ID
- session ID、idempotency key、時間
- Undo 時間及執行者

`operating_items` 只新增 nullable 欄位：

- `inbox_available_after`
- `inbox_processed_at`
- `inbox_processing_event_id`

舊版程式會忽略這些欄位，因此 migration 可在新程式部署前安全套用。

## 防重複及 transaction

`process_inbox_item` 是單一 PostgreSQL transaction。`(user_id, idempotency_key)` 為 unique；相同 request 重試只會返回第一次結果，不會重複建立 task、project、waiting 或 handoff。

Function 使用 `SECURITY INVOKER`，並明確檢查 `auth.uid()`、Inbox owner、item 狀態及所有 enum／日期／長度。新表啟用 RLS，只授權 authenticated user 讀寫自己的 event；沒有 DELETE grant。

## Undo

`undo_last_inbox_processing` 只可撤銷：

- 目前使用者最近一筆尚未 Undo 的 event
- 15 分鐘內的處理
- 尚未產生後續實質進度的 target

如果 task 已完成、有 progress、Waiting／Blocked handoff 或 checkpoint，Undo 會拒絕並保留所有資料。安全撤銷時：

- 原始 Inbox item 由 snapshot 還原
- 新 task soft-delete 並取消／收回 handoff
- 新 operating item 會取消並封存
- event 寫入 `undone_at`，保留 audit trail

略過不會封存原項目，只設定 4 小時後重新可見。

## Rollback

`supabase/migrations/20260724150744_inbox_processing_mode.rollback.sql`

Rollback 只移除 Inbox Processing function、event table、index 及三個 nullable 欄位；不會刪除 `tasks`、`operating_items`、handoff、share 或使用者資料。若已使用功能，優先回退前端 deployment 並保留 additive table 作審計；只有確認不再需要 event history 時才執行 database rollback。
