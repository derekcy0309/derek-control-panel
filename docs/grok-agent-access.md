# Grok Bot 專用登入

## 權限及操作

`/agent` 是現有 Panel 的受限工作區，不是另一套 Task system。Grok Bot 可使用瀏覽器打開它，再由使用者在 Grok Vault／Secure Form 填入 Access Code。毋須建立假 Email 或分享 Derek 的 Google／管理員密碼，亦不呼叫收費模型 API。

- 只可讀取授權者本人擁有、逐項開放的 active Task／Notes，以及此連接自己新增的項目。
- 可新增私人 Task／Notes，帶本人指定的 Tags；新項目仍進入原本 `tasks`／`operating_items`。
- 不可 update、完成、轉交、封存、delete、改 Tags 定義、分享或帳戶權限。
- 即使另一人的工作已分享給授權者，也不能經此入口讀取。財務、藥物、附件、resource pack、handover notes 等不在 Agent API 範圍。
- 開放的 Task／Notes 文字本身可能包含私人內容，使用者應先檢查。沒有按名稱自動判斷健康狀況或刪改內容。

管理員在 Settings →「Grok 專用登入」可選 Tags、開放項目及 1／7／30／90 日有效期，閱讀同意文字後建立。Access Code 只回傳一次，可隨時停用。最多 5 個有效連接；重設採停用舊 Code、建立新 Code，不會復活舊權限。

Agent 登入會移除**該瀏覽器**原有的人用 session cookies，防止 Grok 共用電腦保留管理員登入；不撤銷其他裝置登入。原有三人的 Google Auth、帳戶及權限不改。

Grok 官方說明：同一 Grok 帳戶下的 Bots 共用 cookies／登入，並非逐個 Bot 隔離；請使用獨立、最小權限 Code。[電腦、Apps 及安全登入](https://docs.x.ai/grok-bot/computer-and-apps)。

## 技術邊界

- 隨機 256-bit Code，`dcp_grok_` 前綴；DB 只存 SHA-256 雜湊，authenticated 使用者連雜湊欄位亦不能 SELECT。
- 登入只收 JSON POST；Code 不可放網址。Cookie 為 HttpOnly／Secure（production）／SameSite Strict，Path `/api/agent`，到期不超過 grant。
- 原本人用 API 不接受 Code；Agent API 不採用人用 cookie／JWT，也沒有任意 SQL／REST proxy。
- 伺服器保留原本 server-only `SUPABASE_SERVICE_ROLE_KEY`，只用它呼叫 allowlisted `agent_access_operation`。RPC 本身為 SECURITY INVOKER，只有 `service_role` 可 EXECUTE，重新驗證 hash、active admin owner、到期、撤銷、資料擁有者及逐項 scope。
- 新增與 audit／Tags／idempotency ledger 在同一 DB transaction。以 grant + request UUID 防重複；同 UUID 不同內容回 409。
- 每連接每分鐘最多 60 次成功操作、每香港日最多新增 50 項，counter 與鎖在 DB，不用不可靠的 function process memory。
- log 只記錄固定錯誤碼；audit 只記 action、時間、grant／resource ID，不含 Code、文字、健康或財務內容。
- 草稿只存當前 grant 的 sessionStorage，不保存讀取的 Task 內容或 credentials；登出／撤銷時清除。

## Schema / migration

`20261114071824_grok_agent_access.sql` 新增四表：`agent_access_grants`、`agent_access_resources`、`agent_access_events`、`agent_write_requests`，全部開 RLS。本人 admin 只能建立／查看自己的授權及不可逆停用，不能讀 hash 或操作其他人的授權。

`tasks`／`operating_items` 只新增可空的 `created_by_agent_id` 及 index；不可由一般使用者冒認或修改 attribution。既有 rows、RLS、欄位、財務、recurrence、分享不重寫。備份不包含 Access Code／grant，不會從舊 JSON 重新授權 AI。

回復：先將 app 回到部署前 commit `5b58437e66e9fcd4b7a7b35a82de7cb563b012a3`，再用 `supabase/rollback-20261114071824-grok-agent-access.sql` 停用 RPC。保留表、audit、已新增 Task／Notes，不 DROP 或清資料。

Security advisor 的 `agent_write_requests`「RLS enabled, no policy」是刻意的 deny-all：此表不授權 anon／authenticated，只由受限 service RPC 使用。既有 6 個 anon／34 個 authenticated SECURITY DEFINER 及 leaked-password 設定提示沒有增加或改動。

補充 migration `20261114072232_grok_agent_date_validator.sql` 只把既有純日期驗證函數的 EXECUTE 授予 service_role，讓 Agent 新 Task 通過原有 CHECK constraint；不更改驗證內容或一般用戶權限。回復時先停用 Agent，再執行對應 rollback 檔撤銷這項 grant。

## 驗證範圍

按使用者要求不展開大型權限矩陣，只做必要 smoke check：

- `tests/agent-access.test.ts`：key、輸入驗證、固定能力、API 隔離合約。
- `tests/sql/grok-agent-access.mjs`：隔離 Postgres，真實 migration、本人 scope、新增、重試、撤銷及舊財務不變。
- `tests/api/grok-agent.mjs`：真正 Next.js handlers／本機 HTTP fixture；login cookie、hash-only RPC、Origin、禁止寫入舊資料、拒絕人用 API。
- `tests/browser/grok-agent.mjs`：360／1280 px 的登入、閱讀、新增、Notes 無多餘日期、草稿／重試，以及管理員 Code 建立／停用。

沒有真人 Grok Bot E2E（需使用者自己的 Grok Vault／Secure Form）；不能把 Panel smoke check 說成已完成第三方連接。
# 子女及學校：逐個 bot 授權

Grok 小助手同其他支援 HTTPS Bearer／瀏覽器登入嘅 bot 都可用。唔按品牌、bot 名稱或共用 Access Code 認人；**每個 bot 用獨立 Code**。唔好將 Code、本人 Google 密碼或兒童資料貼落普通聊天。

- 本人登入「子女及學校」→「管理邊個 bot 可以用」。可為現有 Code 開放學校，或直接建立 30 日「只限學校」Code。後者不含 Task、Notes、財務或 Calendar，唔使揀 Task Tag。冇自動為現有 Code 開放。
- Bot 登入 /agent 後開「子女及學校」，或使用 /agent-school-openapi.yaml。只回傳本人未完成、未封存學校事項嘅名稱及日期，另有不含內容嘅識別碼同版本；唔包括人哋分享俾你嘅資料、備註、附件或其他家庭事項。敏感項目可完全唔分享（新 Code 預設）或只報「學校事項」同日期。
- GET /api/agent/school 按日期分頁；POST 只受理建議及回傳收據。同一份建議重試須沿用 requestId。唔提供直接修改、直接刪除或 bot 確認接口。
- 本人返「子女及學校」→「Bot 建議 · 等我確認」→睇改前／改後，再逐項確認或拒絕。登入超過 10 分鐘須重新登入，登入成功本身唔會執行建議。新增預設私人／敏感，確認刪除只封存原記錄。原資料有變、授權失效或建議超過 7 日不能套用；更改學校授權會取消未處理建議。
- 已同時授權三日日報及學校嘅一般 Code，沿用原本 /agent/brief 同香港時間 08:30 routine。只加今日起三日嘅學校 Deadline，唔會自動通知其他 bot。學校專用 Code 不能讀日報或 Calendar。
- Migration 20261119103927_school_bot_approval；對應手動 rollback 會停用學校權限及學校專用 Code，保留原記錄、建議及 audit。日誌只記動作識別及時間；記錄前後值只供本人覆核。
