# Task Dependencies and Project Milestones

Migration：`supabase/migrations/20260724172250_task_dependencies_milestones.sql`

這一層延續既有 `tasks`、Projects（`operating_items.item_type = 'project'`）、handover 和 sharing；不會建立第二套任務系統。

## 行為

- 任務可選擇所屬 Project。這是規劃連結，不會自動分享任務、改變 owner 或把私人資料帶到 Project。
- 「此任務要先等」寫入 `task_dependencies`。若前置任務未是 `done`，後置任務不會進入 Today Auto‑Plan 的 Now／Later／Quick Wins。
- 完成前置項只會讓後置項重新變成可建議的候選項；系統不會自動開始、完成、延期、指派或交接。
- 資料庫 trigger 用 recursive query 拒絕 self-reference 和循環依賴。
- Project War Room 的 milestone 可記錄可驗證結果、日期、關鍵標記及狀態；完成 milestone 不會自動改動任何任務。

## 權限與私隱

兩張新表均啟用 RLS：

- `task_dependencies` 只有同時看得到前置和後置任務的人可以讀取；只有後置任務 owner、明確 `edit` 分享者或已接受的 `co_owner` 可以新增／移除。
- `project_milestones` 只有看得到 Project 的人可以讀取；只有 Project owner、明確 `edit` 分享者或已接受的 `co_owner` 可以新增、更新或刪除。
- `private.current_user_can_edit` 只存在 private schema，並只授權 authenticated role。它不把 status-only assignment 視為可以更改依賴或里程碑。

資料庫驗證會在 task project link 時確認目標是非封存的 Project，並重新檢查使用者有權看到該 Project。

## 索引與查詢範圍

索引包括 `tasks(project_id, status)`、每個 dependency 方向及 `(project_id, deadline, status)`。Today route 只取得其候選／已確認任務所需的 dependency 與前置任務，不會一次讀取所有 task backlog。

## Rollback

`20260724172250_task_dependencies_milestones.rollback.sql` 在任何 dependency、milestone 或 task project link 存在時會拒絕執行，避免靜默刪除新資料。需要回退時，先回退前端 deployment；只有在已匯出並明確處理該功能資料後，才移除 schema objects。
