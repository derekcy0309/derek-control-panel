# Restart Checkpoint

版本：0.2.0

Migrations：`20260724120731_restart_checkpoints`、`20260724121803_checkpoint_resource_privacy`

## 資料模型

`public.task_checkpoints` 為每次可恢復工作位置保存：

- 任務及作者：`task_id`、`author_id`
- 狀態：`draft` 或 `saved`
- 剛完成內容、目前位置、下一個最小步驟
- 最多 10 個 HTTPS 資源連結；網址存於 author-only 的 `task_checkpoint_resources`
- 阻塞原因及最後工作時間
- 建立／更新時間

每位作者在同一任務最多有一筆 draft；正式儲存會把該 draft 轉成不可覆寫的 history。`latest_task_checkpoints` 是 `security_invoker` view，只返回每項任務最新一筆 saved checkpoint。向後相容的 `task_checkpoints.resource_links` 欄位會強制保持空陣列，避免直接讀表時洩漏私人網址。

## 權限

- 任務 owner 可新增 checkpoint。
- 具有 `update_status`、`edit` 或 `co_owner` 的有效分享者可新增 checkpoint。
- 已接受、處理中、waiting 或 blocked 的受派者可新增 checkpoint。
- Draft 只讓作者本人看，避免未完成筆記意外分享。
- Saved history 跟隨既有 task read permission，讓交接雙方看到正式進度。
- View／comment-only 分享者不能新增或修改 checkpoint。
- 已 saved 的記錄不能 update 或 delete；每次修改都建立新 history。
- 所有寫入使用 authenticated session、RLS、`security invoker` RPC 及 server-side input validation；不使用 service role key。

## Autosave 可靠性

Focus Mode 會在變更後 debounce 自動保存。畫面區分 pending、saving、saved 及 error；只有伺服器回應成功後才顯示「草稿已安全儲存」。離開頁面前如仍有未完成或失敗的寫入，瀏覽器會提示使用者。RPC 使用 transaction advisory lock，避免同一作者的快速重試產生多筆 draft。

## Rollback

`20260724120731_restart_checkpoints.rollback.sql` 只移除 Restart Checkpoint 的 view、function、policies、trigger 及新 table；不改動 tasks、assignments、shares 或其他 production data。Rollback 會刪除 checkpoint history，執行前應先匯出該新表。
