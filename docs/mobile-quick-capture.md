# Mobile Quick Capture

Mobile Quick Capture 直接寫入既有的 `operating_items` Inbox 項目，並不會建立第二套任務或 backlog。使用者可以從頂部「快速收集」按鈕、手機拍相、選擇文件、貼上網址或 PWA 分享目標進入；不支援分享目標或語音轉文字的瀏覽器仍可直接輸入。

## 資料與確認邊界

- 每次送出有 `client_capture_id`，附件亦有 `client_file_id`。網絡中斷後以相同識別碼重試，不會建立重複 Inbox 項目或檔案 metadata。
- 使用者可選擇「預設後續處理者」，這只是 Inbox metadata 提示；系統不會自動交辦、分享內容或建立任務。
- 語音轉文字預設只保留文字。使用者剔選「保留原始錄音」後，才會嘗試上載音訊。
- 離線時頁面保留未提交文字並清楚提示；真正的 offline write queue 會在後續的 Offline Write Queue 階段處理。

## 私隱、RLS 與 Storage

Migration `20260725210000_mobile_quick_capture.sql` 新增：

- `mobile_capture_receipts`：擁有者限定的 idempotency receipt。
- `inbox_capture_files`：相片、文件及選擇保留的原始錄音 metadata；只限擁有者讀取和新增，且必須仍是其私有 Inbox 項目。
- 私人 Storage bucket `dcp-private-captures`：bucket 不是 public，物件路徑首段必須是當前使用者 UUID。只安裝 select／insert／delete 的 owner policy。
- `create_mobile_capture`：受限於 authenticated 的資料庫函式。函式驗證目前登入者、輸入長度／種類、HTTPS 分享網址與 Derek／Suki 信任名單，然後交易式建立或取回同一個 Inbox 項目。

即使 Inbox 之後被分享，`inbox_capture_files` 和 Storage object 也不會自動分享。附件只會透過目前登入擁有者的短期 signed URL（300 秒）開啟；沒有使用 service role key。

## 回退

先匯出或明確移除 `inbox_capture_files` rows、`mobile_capture_receipts` rows，以及 `dcp-private-captures` bucket 內的 Storage objects，才可執行 `20260725210000_mobile_quick_capture.rollback.sql`。回退有 guard，並刻意不會刪除既有 Inbox、任務或其他資料。
