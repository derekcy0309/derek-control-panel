# Tags 延續：重複工作及備份／還原

## 範圍

- 現有 tasks、Tags 表及 RLS 不變，不新增另一套任務系統。
- `task_recurrence_generations` 寫入下一期 ID 後，由 private invoker trigger 複製擁有者自己的有效 Tags；只新增缺少連結。
- `GET /api/backup` 的 V1 JSON 加入三個可選集合，舊 JSON 相容。任務 CSV 亦列出 Tags。
- `POST /api/backup` 預覽重複／無法連結項目，確認後以 invoker `restore_backup_v3` 原子地還原原資料及 Tags，不覆蓋現有資料。
- 無新環境變數、付費服務、帳戶或分享權限變更。

## 驗證

- `tests/backup.test.ts`：JSON round-trip、舊格式、帳戶隔離、非法連結、同名／改名／已刪除 Tags、零 Tags marker。
- `tests/tag-continuity.test.ts`：API、分頁、私有 trigger、明確還原確認及無 definer／RLS 放寬合約。
- `tests/sql/tag-continuity.mjs`：本機隔離 PostgreSQL，三角色、真實 recurrence generator、每日／週／月／自訂／interval、無期限、交接者完成、私隱、重試不重複、只新增還原及整筆 rollback。V2 只用最小測試替身；正式 V1／V2 鏈另用 Supabase ROLLBACK transaction 驗證。
- `tests/browser/backup-tags.mjs`：三角色手機／桌面，JSON 下載、Tags 預覽、二次確認、還原失敗重試、無 voice／AI 依賴。資料請求使用 fixture，不改真實使用者資料。

## 回復

部署前穩定版本：`83e4a79a6f86c43112bec846bf89a3ac197407fe`，Vercel `dpl_3ix684jAbic5nGuckiscfHPeJ2iX`。先將 app 指回該部署，再執行 migration 對應 stop switch；不 DROP 新舊表或刪資料。重新啟用只需恢復 authenticated 對 V3 的 EXECUTE 及同一 trigger。

## 限制

- 不自動更改以前已產生的下一期 Tags；避免覆蓋用戶後來自行整理的分類。
- 沿用現有安全還原邊界：重複規則只備份、不自動啟用；分享／交接權限不從備份重建。
- Tags 是私人整理標籤，還原不會令另一人的任務或資料變為可見。
