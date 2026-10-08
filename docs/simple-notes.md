# 私人筆記精簡（2026-10-08）

## 操作

在「個人 → 私人筆記」按「新增筆記」，填標題、內容及可選分類／Remark。
預設分類：車輛、個人財務、公司、工作、個人、家庭；亦可直接輸入自訂分類。
點擊筆記卡片可打開全文及修改。上方可搜尋標題、內容、分類，或按分類篩選。
筆記不再顯示死線、日期、下一步、urgency 或工作狀態，也不需要標記完成。

## 保存及私隱

- 沿用 `operating_items`（`item_type = note`），沒有第二套資料來源。
- 分類儲存在既有 `metadata.noteCategory`；移除分類只刪除此 key，不改動來源及其他 metadata。
- 新筆記為 `personal + private + sensitive`；「公司／工作／個人財務」只是標籤，不會自動分享或產生收支。
- 更新只提交標題、內容及分類，保留舊筆記原有日期、狀態、下一步及其他資料；舊「已完成」筆記仍可在筆記頁找回。
- 沿用既有驗證、RLS、owner 編輯限制及 audit log。未新增資料表、欄位、環境變數或 migration。
- 表單草稿只暫存在同一帳戶、同一瀏覽器分頁的 sessionStorage；返回及重新整理可恢復，登出會清除。這不是正式儲存，也不跨裝置同步。
- 斷線或 API 失敗會顯示未儲存及重試提示，保留文字；只在收到成功回覆後清除草稿並更新卡片，不整頁 reload。
- 標題上限 500 字、內容 10,000 字、分類 40 字；超限回報錯誤，不靜默截斷。

## 驗證

- `tests/notes.test.ts`：分類、自訂標籤、驗證、metadata 保留、搜尋、舊完成狀態、帳戶草稿隔離及 API 契約。
- `tests/browser/notes.mjs`：Derek／Suki／Amigo × 1280px／390px；新增、修改、草稿返回／重整、離線、API 失敗重試、分類搜尋、保留舊欄位、無整頁重載及橫向溢出。所有應用 API 使用模擬資料，不代表真人登入驗收。
- 瀏覽器測試需 `VERIFY_URL`；可用 `PLAYWRIGHT_MODULE` 及 `BROWSER_EXECUTABLE` 指定本機 Playwright／瀏覽器，`SCREENSHOT_DIR` 可選。
- Supabase 以交易內臨時 fixture 驗證分類持久化、舊資料保留、非擁有者不能讀／改；最後 `ROLLBACK`，沒有改動使用者資料。
- 本次結果：全部 281 項單元／合約測試、六組本機瀏覽器流程、lint、typecheck 及 Next.js build 通過。

## 部署及回復

此改動先部署 feature branch Preview；沒有授權本次 Production 發佈。
回復可重新部署本次修改前的 commit `3740e015ae2cd2dabc5a6aa163b8b49a48a79ca8`。
不用回復資料庫；舊版程式會忽略 `metadata.noteCategory`，已儲存的標題／內容仍可使用。

## 尚有限制

- 草稿是分頁內暫存，不是離線同步佇列；正式保存仍需連線及按「儲存筆記」。
- 目前一則筆記一個分類，沒有新增附件、置頂、提醒或多人協作。
- 沿用既有 operating-items 讀取範圍，這次没有擴大成全量 backlog 查詢。
