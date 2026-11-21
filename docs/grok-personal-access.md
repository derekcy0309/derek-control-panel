# Grok 本人資料連接

這是日序既有 Grok 整合之外的一個獨立連接；不改每日 08:30 三日摘要、已批的學校 Bot 權限或其他使用者的設定。Migration 不會自動啟用任何連接。

## 開啟及停用

1. 用 Derek 的日序管理員帳戶登入。到「設定 → Grok 本人資料」核對分享範圍，產生新的 Access Code。這一步會要求近期登入。
2. 將新 Code 放入你控制的 Grok 私人 HTTP 工具的 **Bearer credential** 欄位，只用於下方兩個端點。不要貼到一般對話、URL、公開指令、Webhook 或任何第三者服務。日序只保存 Code 的 SHA-256；頁面只在簽發時顯示一次。忘記或外洩可換 Code 或即時停用。不要覆蓋每日摘要用的舊 Code。
3. 用 `GET /api/agent/personal` 確認可用資料類別。只在需要時查相應 `dataset`，不需要定期拉取全帳戶。`GET /api/agent/personal?dataset=icloud&month=2026-11` 只回傳指定香港月份，按 Derek 在日序所選的 iCloud Calendar 讀取；可按需要查其他月份。Apple 端仍然只讀，要改行程請去 iPhone。

「可信」代表 Derek 專門為此連接簽發可撤銷的 Code，不代表 Grok 成為日序帳戶、管理員或密碼持有人。任何持有 Code 的工具可用上述端點，日序不能由 Code 驗證 X 帳戶身分，也不能替 Grok 承諾外部資料保存期限。不要將包含財務或藥物的回覆轉發到共用對話或頻道。

## 閱讀及封存邊界

- 新連接只讀取登入帳戶本人擁有的資料；在其他帳戶的名下、受指派、共用的私人記錄不會因 Derek 看得到而進入範圍。只回傳各類的固定欄位，不提供任意表、備份、附件、銀行／登入憑證、其他 Bot 密鑰或整站權限。財務只包括本人家庭／個人範圍，不包括其他使用者或公司帳目。
- 只有 Derek 本人要求處理時，Grok 才應用 `POST /api/agent/personal/archive-requests` 為指定的一筆可復原資料建立草稿。這個請求**不執行封存**，亦不能為整批資料操作。Grok 應回覆「未封存，請在日序核對」，不可將 HTTP 202 報作刪除成功。
- 「設定 → Grok 本人資料」顯示待你核對的紀錄。逐筆閱讀，只有你真的提出過指令才確認「這是我本人要求」，再確認封存。近期登入、授權撤銷、逾時、內容或分享權限有變，系統會拒絕執行原草稿。日序不把 Grok 對話中的「係／yes」當作確認。
- 可封存例如本人私人的 Task、Notes、部分家庭／學校事項、部分單筆個人收支。相連或共用紀錄、恆常規則、藥物紀錄、Apple 行程、帳戶、分享設定不接受這種刪除草稿。封存並非永久刪除；現有原始紀錄保留，可按日序相應模組的權限處理。

OpenAPI：`public/grok-personal-openapi.yaml`。該檔描述 HTTP 介面，不會自行在 Grok 安裝或開啟授權。

## 上線及回復

本機可用 `pnpm test:grok-personal` 跑授權及資料範圍測試，`pnpm test:grok-personal-api` 跑有假資料的 Next.js HTTP 流程，及設定本機 `PGLITE_MODULE` 後用 `pnpm test:grok-personal-sql` 驗證 migration。這些測試不會使用正式資料。

先在隔離的 Supabase 環境驗證 migration（尤其是 active admin 身分、跨使用者邊界、失效 Code、重新登入、未確認不變更任何紀錄）。往正式環境推出時先套用 migration，再部署相符 Git commit；待 Derek 在正式站主動簽發，方可在他的私人 Grok 工具驗收。不要將 Preview 或測試用 Code 設到正式 Grok。

回復時先停用新連接（使 Code 和未完成草稿失效），再按相應 deployment 回退應用程式。如果設定頁不可用，由資料庫管理員在對應環境驗證後使用 `supabase/rollback-20261121193738-grok-personal-approved-archive.sql`。留存已封存的原資料和 audit metadata，不刪 policy/audit tables，也不要回退舊的三日摘要／學校授權 migration。緊急時不要以停用所有 Supabase Auth 或清除舊授權代替，免影響其他使用者。
