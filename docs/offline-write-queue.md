# Offline Write Queue

Offline Write Queue 只處理最小且可安全重播的寫入：純文字 Mobile Quick Capture、task checkpoint、Focus Session 暫停及完成。它不是一份完整離線資料庫：任務清單、Dashboard、分享資料、健康／家庭內容與 API response 不會被 Service Worker 快取。

## 本機資料與私隱

- 待同步內容只存在瀏覽器 IndexedDB，並以目前 Supabase user id 分區。
- 登出成功後，該帳戶的待同步內容會立即刪除；不會刪除其他帳戶的本機待同步內容。
- 相片、文件、原始錄音和其他附件不會離線保存。離線 Quick Capture 只接受純文字／網址，連線後才可上載附件。
- Service Worker 只快取 public offline shell 和靜態資產，從不快取 `/api`、Dashboard、任務或其他帳戶資料。

## 同步與衝突

- 網絡恢復或重新開啟已登入 app 時，系統先確認目前登入者與 queue owner 相同，才按建立次序重播。
- Mobile Capture 使用既有 `clientCaptureId` receipt；checkpoint 使用新增 `client_mutation_id`。重試會返回原本的 checkpoint，而非建立多筆正式 history。
- Focus 完成會先同步 checkpoint，再以 checkpoint mutation id 完成 Focus history；Focus pause／finish RPC 本身亦可安全重試。
- 離線 Focus task update 帶有原本的 `last_progress_at`。如伺服器已有較新的資料，會標示為需要重新確認，絕不自動覆蓋。
- 對於衝突項目，頂部會清楚提示；使用者可以保留，或自行選擇捨棄本機副本。系統不會自動丟棄或覆蓋。

## 資料庫

`20260725235900_offline_write_queue.sql` 只會在 `task_checkpoints` 新增 nullable `client_mutation_id` 和唯一 partial index，並新增兩個 `SECURITY INVOKER` RPC：

- `save_task_checkpoint_idempotent`
- `finish_focus_session_after_checkpoint`

兩個 RPC 都先驗證 `auth.uid()`／既有 task checkpoint 權限，並撤銷 `public`／`anon` 執行權。Rollback 會在任何 checkpoint 已有 client mutation id 時拒絕執行，要求先明確處理資料，避免破壞待重播的資料。
