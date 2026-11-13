# 簡易模式（2026-11-14）

## 用法

1. 「加 Task」：輸入任務名稱、揀一個或多個 Tags，按「加 Task」。Priority 預設 P2；P1 高、P3 低。可以用裝置鍵盤聽寫，儲存前仍由本人確認。
2. 「日期／邊個跟」：需要時先打開。預設無 Deadline、我自己；指派只列出真實 participant_profiles 用戶，接收確認沿用既有交接流程。
3. 「更多設定」：保留指定工作日、Follow-up、Routine、備註、共同跟進及通知。舊估時／能量等資料留在 DB，不再要求填寫，也不參與簡易首頁排序。
4. 首頁：今日完成進度、Waiting、未來七日 Deadline。最多一件 Now、兩件 Next。未安排時只按 Priority 建議；按「開始做」才加入 Today。已有 Today 則沿用本人次序，做完後顯示下一件；不自動補入更多 backlog。
5. 「今日全部」繼續使用現有排序及 To-do List 列印；「任務總表」按自己的 Tags／名稱篩選，各組先收起。
6. 「管理我的 Tags」可新增、改名、移除任何 Tag，無鎖定名稱。移除 Tag 不刪 Task；無分類的 Task 在「全部／未分類」仍找得到。

## 資料模型與安全

Migration：`20261113172120_personal_task_tags.sql`（已套用於 Derek self），只新增三張表、索引、RLS 和 invoker RPC，不 UPDATE／DELETE 舊 Task 或財務資料。三人 authenticated 角色的 transaction／rollback 權限測試通過；Task、收支及恆常收支規則的 row count／fingerprint 套用前後完全相同。

| Table | 用途 | 權限 |
|---|---|---|
| personal_task_tags | 本人的名稱、穩定 ID、soft-delete 日期 | 只限本人；最多 60 個有效 Tags，名稱 1–40 字 |
| task_tag_preferences | 記錄已首次設定 | 本人讀／新增，不可刪 marker 令預設重建 |
| task_tag_assignments | 本人 Task 的多個 Tags | 本人 + Task 原有 RLS 可讀；複合 FK 確保 Tag 屬於本人 |

`ensure_my_task_tags` 在單一交易首次設定：Derek 的登入電郵沿用四分類；其餘人只用個人／Wecare。只映射本人可讀的既有 Task，絕不改 area/scope/visibility。新收到或未分類 Task 仍在全部清單可見，不會因 Tag 自動分享。

`manage_my_task_tag` 改名／soft-delete 不改 link ID 或他人的 Tags。`set_my_task_tags` 只取代目前登入者對該 Task 的 links，最多 20 個，並驗證可見性及 Tag 所有人。兩者使用 generic audit summary，不記錄私人筆記。

新增 Task 會先驗證 Tags，沿用 client_request_id 防重複提交；儲存失敗保留草稿與同一識別碼。新表單不再傳能量／估時或 legacy 分類更新，避免改寫歷史資料和分享。Tag 改名直接更新本機定義，Task 儲存以返回資料更新清單；不觸發 document reload。

沒有新增路由、Cron、AI／語音服務、付費依賴或環境變數。Focus、checkpoint、handover、財務、藥物及既有頁面保留。

## 驗證

- `tests/simple-mode.test.ts`：只按 Priority、stable ties、最多三件、手動次序、下一件、Waiting／dependencies／非工作日篩選、交接及權限界線。
- `tests/sql/personal-task-tags.mjs`：本機隔離 PGlite，三人 RLS、非法連結、分享撤回、改名／刪除不改 Task／財務、seed 一次、匿名拒絕、generic audit。
- `tests/browser/simple-mode.mjs`：三人，360／1280 px，表單、草稿、失敗重試、工作日、Tags CRUD、安靜模式、無 document reload；所有 data API 為 mock，不代替真人 Google 登入測試。
- `tests/browser/todo-print.mjs`：三人手機／桌面、Today 次序、Tags 篩選、A4 print CSS／PDF、分頁、空白及錯誤重試，無 live writes。
- 最終完整單元測試 308／308 通過，lint、typecheck 及 Next.js production build 通過。工作日舊流程亦完成三人 390／1280 px 的修改／重新讀取、無 Deadline、範圍與重複提示回歸測試。

### Preview 真實登入驗收

2026-11-14：使用者明確批准後，只新增以下一條 Supabase redirect URL：

`https://derek-control-panel-9np0k0vgn-derekcy0309-4881s-projects.vercel.app/api/auth/google/callback?state=*`

原有四條 redirect URL 及正式 Site URL 全部保留；沒有更改 Google provider、OAuth credentials、帳戶或登入名單，也沒有加入整個 Vercel 網域或其他 Preview。

獲批 Preview（commit `2d05028`）已完成 Derek 的真實 Google 登入：callback 留在同一 Preview，Dashboard 讀到原有工作、私人 Tags、任務詳情、修改表單及原本已選的 Tag，console 無錯誤。未在真實帳戶建立永久測試 Task，也沒有按完成或交接。

最新功能 commit `aed9ed7` 另補強純前端 Today 隱藏／snooze 篩選及 regression tests；Auth、API、DB 與已登入驗收的 Preview 相同。其 Preview build、308 個完整單元測試及三人隔離 browser fixture 均通過。這個紀錄不將三角色 fixture／SQL 身分測試冒稱為三個真人的 Google 登入。

真實 DB 額外以 authenticated Derek 在 rollback transaction 建立臨時 Task／Tag、設定 Tag，再驗證 Suki／Amigo 不可讀取或標記該私人 Task；整個交易回滾後，75 個 Task、35 筆收支、11 條恆常支出及 1 條恆常收入的完整內容 fingerprint 不變。

Security Advisor：新增 Tags 表及 RPC 沒有 finding。原有專案仍有舊 SECURITY DEFINER 執行權及 leaked-password-protection 警告，與本次變更無關，沒有擅改現有通知或帳戶權限。

## 部署及回復

先在本機驗證 migration，再套用 additive schema，部署 Git feature branch Preview，通過驗收後才更新 main／Production。每個 Vercel build 的 commit SHA 保留在 Settings → Build Info。

首選回復方式：將 Production 指回之前的 `42f2adac93f09f72a2292d7c216860d0595bc30b` 部署，保留新增 Tags 表及資料；舊 app 會忽略新表。只有需要停用新 RPC 時才在 app rollback 後執行 `supabase/rollback-20261113172120-personal-task-tags.sql`；不 DROP 表、清資料或改帳戶。重新啟用只需恢復同三個 RPC 的 authenticated EXECUTE。

限制：原有完整 JSON 匯出／還原尚未納入新 Tags；還原任務後可在「未分類」重新選 Tags。重複工作新一期亦可從未分類重新選擇 Tags；不會因缺少 Tag 而遺失或隱藏 Task。
