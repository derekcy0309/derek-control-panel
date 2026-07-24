# Backup／Restore

Settings 的「你的資料備份及安全還原」提供帳戶範圍的 JSON 及常用 CSV 匯出。每次匯出、預覽和還原都會建立不含任務內容的 audit 記錄。

## 匯出範圍

JSON 只包含目前登入帳戶擁有的任務、工作項目、財務、會議、容量、規劃、checkpoint、可讀取的任務資源、依賴、里程碑、週檢視，以及供參考的個人設定。它不包含另一位使用者的資料、分享與交接權限、帳戶憑證、通知裝置／送達紀錄或 Supabase Storage 檔案本體。

CSV 只提供任務及財務兩個常用視圖；以公式符號開頭的欄位會強制作純文字，避免試算表公式注入。

## 還原安全邊界

1. 選取 JSON 後，server 先確認格式、版本、登入帳戶 ID 與每項集合的安全上限。
2. 預覽顯示資料數、已存在的本人 ID，以及不會自動還原的類別。
3. 使用者必須勾選「只新增、不覆蓋」並輸入 `RESTORE`。
4. `restore_backup_v1` 以目前使用者的 RLS／權限執行單一 transaction；所有 existing ID 或其他 unique conflict 都以 `ON CONFLICT DO NOTHING` 略過，從不 update、delete 或 reset 資料。
5. 重複規則、Focus／估時歷史、通知設定、帳戶 Settings／權限及 Storage 檔案暫只保留在 JSON，不會自動重建，以免產生重複任務或失效檔案連結。

還原會重建可安全獨立存在的本人資料：工作項目、任務、財務、會議、容量、Today 規劃、checkpoint、非 Storage 資源、依賴、里程碑和週檢視。任務與工作項目會保持私人，絕不以備份重新建立 Derek／Suki 分享或指派。

## Migration 與回復

`20260726003000_backup_restore.sql` 新增 `backup_restore_audit_logs`（RLS：僅本人可讀寫）及 SECURITY INVOKER 的 `restore_backup_v1(jsonb)`。它不改動既有表或資料。

Rollback 在 audit log 已存在時會拒絕執行，避免無意刪除追蹤紀錄。若確定只在空的 preview／staging 環境回退，先依變更管理程序處理 audit rows，再套用 `20260726003000_backup_restore.rollback.sql`。
