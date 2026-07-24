# Task Resource Pack

每個任務可有一個小型、可直接在 Focus Mode 開啟的資源包。可加入 HTTPS 網址、外部文件、已有的文件／Notes／SOP／Decision／Project／Waiting 項目、聯絡人，以及 Supabase Storage 檔案。

## 私隱與分享

- 每個資源都有自己的 `owner_id`，預設 `share_with_task = false`，即使任務已分享或指派也只讓建立者看見。
- 建立者可逐項剔選「明確分享給可查看此任務的人」。取消剔選會立即回到私人狀態。
- 連到現有 operating item 的資源，在顯示時會再次檢查收件人是否本身可讀取該項目；任務分享不能繞過該項目的 RLS。
- Storage 檔案只在使用者按「開啟檔案」時，以目前登入者的 Supabase JWT 取得 5 分鐘 signed URL。系統不使用或暴露 service-role key；Storage bucket／object policy 仍是最終授權來源。
- 若 Storage object 已刪除或目前帳戶沒有 object 的讀取 policy，開啟會失敗，不會顯示另一人的檔案。

## 使用方式

在「任務」卡按「加入資源」，選擇類型並填入一項最需要的內容。已有 Notes、SOP、Decision、Project、Waiting 或文件可從現有項目中選擇。Storage 檔案需提供 bucket 與 object path，例如 `private-files` 和 `derek/quote.pdf`。

Focus Mode 只載入該任務且目前帳戶獲授權的資源，避免把整個 backlog 或私人文件帶入專注畫面。

## 資料庫與回復

Migration：`20260725200000_task_resource_pack.sql`，新增 `public.task_resources`、索引、資料驗證 trigger 及 RLS policies；不改動既有 task、operating item、checkpoint、sharing 或 Storage object。

Rollback 檔會先拒絕在仍有 resource row 時直接執行，避免誤刪資料。請先匯出或明確處理資源資料，再執行 `20260725200000_task_resource_pack.rollback.sql`。它只移除本功能的 table、policy 與 trigger。
