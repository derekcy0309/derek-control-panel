# Focus Session History

Focus Session History 將普通 Focus Mode 的開始、暫停、繼續、結束變成持久記錄。它的目的只是協助下次快速恢復工作及改善個人估時，不用於監察、排名或比較 Derek 和 Suki。

## 每節記錄內容

- 開始及結束時間、計劃分鐘、實際分鐘、暫停秒數
- 狀態：進行中、已暫停、完成、部分完成或中斷
- 中斷次數及阻塞原因
- 完成／離開前安全儲存的 checkpoint

開始另一節 Focus 前，上一節仍在進行或暫停的 session 會被記為中斷，避免留下多個錯誤的「進行中」計時。API 以使用者提供的 `client_session_id` 去重；網絡重試不會建立重複 session。

## 私隱與可靠性

`focus_sessions` 的 RLS 只允許 `user_id = auth.uid()` 讀取。任務被分享、共同處理或由對方交接，也不會讓對方讀取你的 Focus History。所有寫入都經過資料庫 RPC：每個 RPC 檢查登入者、任務 checkpoint 權限、合法狀態和 checkpoint 是否屬於同一任務及本人。

Focus Mode 的任務計時和 checkpoint 仍是基本功能；若 History 服務暫時失敗，畫面會清楚提示，但不會假稱已記錄，亦不會阻止任務本身繼續。

## 回退

先匯出或明確移除 Focus sessions，才可執行 `20260725230000_focus_session_history.rollback.sql`。rollback guard 會阻止意外刪除，並保留所有既有 task、checkpoint、Body Double session 及 time-estimation data。
