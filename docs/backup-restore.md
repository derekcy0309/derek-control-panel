# Backup／Restore

Settings 的「你的資料備份及安全還原」提供帳戶範圍的 JSON 及常用 CSV 匯出。每次匯出、預覽和還原都會建立不含任務內容的 audit 記錄。

## 匯出範圍

JSON 只包含目前登入帳戶擁有的任務、工作項目、財務、會議、容量、規劃、checkpoint、可讀取的任務資源、依賴、里程碑、週檢視，以及供參考的個人設定。它不包含另一位使用者的資料、分享與交接權限、帳戶憑證、通知裝置／送達紀錄或 Supabase Storage 檔案本體。

JSON 亦包括 `personalTaskTags`（包括 soft-delete 歷史）、`taskTagAssignments` 和 `taskTagPreferences`。只匯出本人的 Tags／連結；共享任務亦只包括本人所選的 Tags，不會匯出其他人的私人標籤或整份任務。Tags 集合採分頁讀取，超出 10,000 項會明確失敗，不會靜默截斷。

CSV 只提供任務及財務兩個常用視圖；任務 CSV 包括使用中的 Tags 名稱。以公式符號開頭的欄位會強制作純文字，避免試算表公式注入。CSV 不供完整還原；請保留 JSON。

## 還原安全邊界

1. 選取 JSON 後，server 先確認格式、版本、登入帳戶 ID 與每項集合的安全上限。
2. 預覽顯示資料數、已存在的本人 ID，以及不會自動還原的類別。
3. 使用者必須勾選「只新增、不覆蓋」並輸入 `RESTORE`。
4. `restore_backup_v3` 以目前使用者的 RLS／權限執行單一 transaction，沿用 V2／V1 的只新增還原；所有 existing ID 或其他 unique conflict 都以 `ON CONFLICT DO NOTHING` 略過，從不 update、delete 或 reset 資料。Tags 驗證或寫入失敗會連同原有任務還原整筆 rollback。
5. 重複規則、Focus／估時歷史、通知設定、帳戶 Settings／權限及 Storage 檔案暫只保留在 JSON，不會自動重建，以免產生重複任務或失效檔案連結。

還原會重建可安全獨立存在的本人資料：工作項目、任務、財務、會議、容量、Today 規劃、checkpoint、非 Storage 資源、依賴、里程碑和週檢視。任務與工作項目會保持私人，絕不以備份重新建立 Derek／Suki 分享或指派。

### Tags 還原

- 相同 ID 沿用目前名稱；已改名或 soft-delete 的 Tag 不會被覆蓋或復活。
- 不同 ID 但名稱相同（不分大小寫、忽略首尾空格）會重用現有有效 Tag，並重接缺少的本人連結，不需要重新選。
- 只新增缺少的連結，保留現有所有選擇。任務仍必須通過原有 RLS；無權讀取或已刪除任務不會因 Tag 取得權限，預覽會說明略過原因。
- 已移除全部 Tags 的初始化 marker 會保留，避免下次登入重新產生預設。
- 舊版 V1 JSON 沒有 Tags 三個集合仍可正常還原；不會猜測或新建分類。
- 維持最多 60 個有效 Tags、每項任務最多 20 個；超出上限則整筆取消並顯示可修正錯誤。
- 原有 restore audit 記錄原資料集合；同一交易另加一筆僅含 Tags 數目的 audit，不記錄名稱或工作內容。

## Migration 與回復

`20260726003000_backup_restore.sql` 新增 `backup_restore_audit_logs`（RLS：僅本人可讀寫）及 SECURITY INVOKER 的 `restore_backup_v1(jsonb)`。它不改動既有表或資料。

Rollback 在 audit log 已存在時會拒絕執行，避免無意刪除追蹤紀錄。若確定只在空的 preview／staging 環境回退，先依變更管理程序處理 audit rows，再套用 `20260726003000_backup_restore.rollback.sql`。

Tags 延伸 migration：`20261113190743_recurrence_and_backup_tags.sql`，只新增 private trigger 和 `restore_backup_v3`，不回填或重寫舊資料。回復先將 app 指回上一個部署，再套用 `supabase/rollback-20261113190743-recurrence-and-backup-tags.sql` 停用新 trigger／RPC；V1／V2、資料表及已儲存的所有資料保留。
