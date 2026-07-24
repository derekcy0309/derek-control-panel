# Weekly Review

## 使用方式

「每週檢視」以八個小步驟逐項帶領 Derek 或 Suki 檢視：本週完成、仍在處理、受阻、Waiting 跟進、下週三件事、可用時間、是否要重新分工，以及下星期第一個最小行動。頁面只展開有限數量的近期項目；它不會顯示完成率排名，也不會一次打開整個 backlog。

可用時間由使用者自行填寫才會顯示 capacity 訊號。系統只提示「已排定」工作的已知預估是否接近或超出該時間；它不會自動延期、交接、完成、刪除或加入 Today。重新分工只會留下備註和連往交辦中心，正式交接仍需由使用者確認。

## 資料與權限

Migration `20260724182259_weekly_review.sql` 新增 `weekly_reviews`，每個帳戶每週一筆 draft 或 completed review。記錄保存使用者確認過的下週成果、可用分鐘、分工備註、第一個最小行動及不含任務內容的 compact snapshot。

表格已啟用 RLS；使用者只可讀取、建立及更新自己的 review，沒有前端刪除權限。trigger 鎖定 owner 和 week start，完成後不可降回 draft，並要求完成檢視時必須留下第一個最小行動。這張表不會觸碰 `tasks`、`assignments` 或分享紀錄。

## 回退

配對 rollback 只會移除 Weekly Review 的 table、trigger 及 validation function；它不會刪除或重設既有任務、交接、分享或帳戶資料。回退前如需保留 review 歷史，請先匯出該表資料。
