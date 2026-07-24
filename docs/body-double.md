# Body Double 同步專注

## 使用方式

「同步專注」讓 Derek 和 Suki 建立一節 15、20、25 或 45 分鐘的共用時段。兩人各自選一項任務、按「準備好」後，任何一方都可以同步開始。計時以伺服器記錄的開始時間計算，因此重新載入或重新連線後會回到正確的剩餘時間。

每人可以個別暫停、提早離開或完成；這些動作不會中斷另一人。沒有產量排名，也不會在此流程自動完成、延期、交接或更改任何 task。完成自己的一節前，系統會要求先儲存該任務的 Restart Checkpoint；資料庫會實際檢查 checkpoint 已由本人在本節開始後儲存，前端不能偽造完成。

## 私隱與重新連線

任務名稱只有在任務擁有者於建立／準備該節時明確勾選後才會顯示給對方。未勾選時，對方只會看到「私人任務」；文件、網址、notes、Definition of Done 和 checkpoint resource links 都不會因 Body Double 自動分享。

每個活躍裝置約每十秒更新一次自己的 session heartbeat。若另一方暫時離線或離開，畫面只顯示中性的連線狀態，並明確指出自己仍可繼續。離線時本地倒數和 checkpoint 草稿仍可使用；恢復網絡後可再同步狀態。這一版刻意使用可驗證的持久化 REST polling，而不是把敏感任務內容放進公開 Realtime channel。

## 資料與權限

Migration `20260725190000_body_double_mode.sql` 新增：

- `body_double_sessions`：兩人、時長、開始／結束狀態。
- `body_double_participants`：每人的任務快照、明確的標題分享選擇、ready／pause／complete／last-seen 狀態。

兩張表均啟用 RLS，只有 session 的兩名參與者可以讀取。前端沒有表格的 insert、update 或 delete 權限；所有變更都經過有 `auth.uid()`、信任夥伴、可寫入 checkpoint 的 task 和狀態轉換檢查的受限 RPC。局部唯一索引防止同一對人同時建立兩節未結束的 session。

`20260725190100_body_double_checkpoint_eligibility.sql` 再把任務選單收窄為「目前帳戶確實可儲存 checkpoint」的任務，避免純 view 分享在收尾時才失敗。

## 回退

配對 rollback 只會移除 Body Double 的 RPC、policy、trigger 和兩張新表。它不會改動或刪除 `tasks`、`task_checkpoints`、`assignments`、`share_records` 或帳戶資料。回退前如需保留 session 歷史，請先匯出這兩張新表。
