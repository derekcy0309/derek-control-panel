# 連接 Grok／其他 AI Bot

## 兩步登入

1. 本人先以平時方法登入日序，去「設定 → 連接 Grok／其他 AI Bot」，核對權限，揀有效期，再按「建立 Bot Code」。預設 30 日；一般 Task／記事 Code 可揀 1、7、30、90 或 365 日。不會延長已有 Code。
2. 用「複製登入網址」，叫 Grok Bot 打開網址，並顯示安全登入表格（Secure Form）。確認係日序登入頁後，另外用「複製 Code」，**只將 Code 貼入安全表格嘅 Bot Code 欄**。如果冇安全表格，可接管 Grok 嘅電腦，在日序頁面手動輸入。唔好將 Code 貼普通聊天、當作網址或填入自己已登入日序嘅瀏覽器；唔需要供應本人 Email 或 Google 密碼。參閱 [Grok 官方安全登入說明](https://docs.x.ai/grok-bot/vault)。

「365 日」係由簽發起計嘅有效期，唔係保證 Grok 一直保留個瀏覽器登入。如果對方清除登入，未到期嘅 Code 仍可用同一個安全方法登入。學校專用 Code 及進階 Grok 私人 API 係獨立功能，唔可以當一般登入 Code。

## 權限及操作

`/agent` 是現有 Panel 的受限工作區，不是另一套 Task system。Grok Bot 可使用瀏覽器打開它，再由使用者在 Grok Vault／Secure Form 填入 Access Code。毋須建立假 Email 或分享 Derek 的 Google／管理員密碼，亦不呼叫收費模型 API。

- **新 Code 預設「管理本人 Task／記事」**：只讀取授權人名下現有及日後的未封存 Task／Notes，新增私人項目，並修改指定欄位，例如標題、內容、期限、優先度、已存在的 Task Tags、筆記分類。私人非恆常任務也可按既有工作規則改狀態；共用、恆常、相連的流程不會由 Agent 自行更動。
- 新 Code 可以提出單筆封存，但不能直接封存或永久刪除。授權人須近期重新登入，核對本人指示，再到設定的「封存建議 · 由我確認」逐筆確認。已共用／相連、資料有變、授權失效或逾時的請求不執行。
- **舊 Code 保留舊權限**；建立時亦可揀「只開放指定項目」，沿用逐項讀取加新增。所有 Code 都不可操作用戶設定、其他用戶資料、指派、分享、權限或 Tags 定義。子女及學校、Calendar 及 Grok 本人資料仍各自授權，不由新預設開放。
- 即使另一人的工作已分享給授權者，也不能經此入口讀取。財務、藥物、附件、resource pack、handover notes 等不在 Agent API 範圍。
- 開放的 Task／Notes 文字本身可能包含私人內容，使用者應先檢查。沒有按名稱自動判斷健康狀況或刪改內容。

Bot Code 只回傳一次，可隨時停用。最多 5 個有效連接；需要換 Code 時先停用舊 Code，再建立新 Code，不會復活舊權限。

自訂 Agent 可沿用 `GET /api/agent?view=list&kind=task` ／ `view=detail&kind=note&id=…`，以及 `POST /api/agent` 新增。新 Code 容許省略 Task Tags。更新用 `PATCH /api/agent`，JSON 為 `{kind,id,requestId,changes}`，只提供想改的欄位（Task：`title`、`description`、`dueDate`、`priority`、`tagIds`、`status`；Notes：`title`、`description`、`category`）。寫入失敗重試用同一 request ID。提出封存用 `POST /api/agent` JSON `{action:"request_archive",kind,id}`；HTTP 202 只表示待本人確認，並非已封存。

Agent 登入會移除**該瀏覽器**原有的人用 session cookies，防止 Grok 共用電腦保留管理員登入；不撤銷其他裝置登入。原有三人的 Google Auth、帳戶及權限不改。

Grok 官方說明：同一 Grok 帳戶下的 Bots 共用 cookies／登入，並非逐個 Bot 隔離；請使用獨立、最小權限 Code。[電腦、Apps 及安全登入](https://docs.x.ai/grok-bot/computer-and-apps)。

## 技術邊界

- 隨機 256-bit Code，`dcp_grok_` 前綴；DB 只存 SHA-256 雜湊，authenticated 使用者連雜湊欄位亦不能 SELECT。
- 登入只收 JSON POST；Code 不可放網址。Cookie 為 HttpOnly／Secure（production）／SameSite Strict，Path `/api/agent`，到期不超過 grant。
- 一般 Bot Code 嘅有效期最多 365 日。伺服器每次操作仍檢查到期及停用，唔會因為用了長期 Cookie 而跳過授權。長期選項只供新簽發，唔改分享範圍或帳戶權限。
- 原本人用 API 不接受 Code；Agent API 不採用人用 cookie／JWT，也沒有任意 SQL／REST proxy。
- 伺服器保留原本 server-only `SUPABASE_SERVICE_ROLE_KEY`，只用它呼叫 allowlisted `agent_access_operation`。RPC 本身為 SECURITY INVOKER，只有 `service_role` 可 EXECUTE，重新驗證 hash、active admin owner、到期、撤銷、資料擁有者及 scope。封存確認只接受經驗證的本人 session，不接受 Agent Code 或 service JWT。
- 新增與 audit／Tags／idempotency ledger 在同一 DB transaction。以 grant + request UUID 防重複；同 UUID 不同內容回 409。
- 每連接每分鐘最多 60 次成功操作；指定項目 Code 每香港日最多新增 50 項，本人工作區 Code 每日最多 100 次新增／修改。計數與鎖在資料庫。
- log 只記錄固定錯誤碼；audit 只記 action、時間、grant／resource ID，不含 Code、文字、健康或財務內容。
- 草稿只存當前 grant 的 sessionStorage，不保存讀取的 Task 內容或 credentials；登出／撤銷時清除。

## Schema / migration

`20261125083037_standard_agent_code_lifetime_365.sql` 保留原有 RLS 同授權範圍，只提高一般 Code 新簽發嘅期限上限。學校專用同私人 API 保持原有期限。回復時先回退 app，再用 `supabase/rollback-standard-agent-code-lifetime-365.sql` 停止新簽發超過 90 日；已簽發嘅長期 Code 保持原到期日，仍可即時停用。舊版本瀏覽器登入可能按原有 90 日上限要求重新輸入未過期 Code。

`20261114071824_grok_agent_access.sql` 新增四表：`agent_access_grants`、`agent_access_resources`、`agent_access_events`、`agent_write_requests`，全部開 RLS。本人 admin 只能建立／查看自己的授權及不可逆停用，不能讀 hash 或操作其他人的授權。

`tasks`／`operating_items` 只新增可空的 `created_by_agent_id` 及 index；不可由一般使用者冒認或修改 attribution。既有 rows、RLS、欄位、財務、recurrence、分享不重寫。備份不包含 Access Code／grant，不會從舊 JSON 重新授權 AI。

兩個 `*_owner_workspace_agent*.sql` migration 新增範圍標記（舊 Code 默認 false）、只限 server 的操作及私人封存覆核。回復順序：先回退 app，再執行 `supabase/rollback-owner-workspace-agent-archive.sql` 及 `supabase/rollback-owner-workspace-agent.sql`。會停用新 Code／待覆核請求，保留 Task、Notes 及 audit，舊 Agent、學校及 Grok 授權不受影響。

回復：先將 app 回到部署前 commit `5b58437e66e9fcd4b7a7b35a82de7cb563b012a3`，再用 `supabase/rollback-20261114071824-grok-agent-access.sql` 停用 RPC。保留表、audit、已新增 Task／Notes，不 DROP 或清資料。

Security advisor 的 `agent_write_requests`「RLS enabled, no policy」是刻意的 deny-all：此表不授權 anon／authenticated，只由受限 service RPC 使用。既有 6 個 anon／34 個 authenticated SECURITY DEFINER 及 leaked-password 設定提示沒有增加或改動。

補充 migration `20261114072232_grok_agent_date_validator.sql` 只把既有純日期驗證函數的 EXECUTE 授予 service_role，讓 Agent 新 Task 通過原有 CHECK constraint；不更改驗證內容或一般用戶權限。回復時先停用 Agent，再執行對應 rollback 檔撤銷這項 grant。

## 驗證範圍

按使用者要求不展開大型權限矩陣，只做必要 smoke check：

- `tests/agent-access.test.ts`：key、輸入驗證、固定能力、API 隔離合約。
- `tests/sql/grok-agent-access.mjs`：隔離 Postgres，真實 migration、本人 scope、新增、重試、撤銷及舊財務不變。
- `tests/api/grok-agent.mjs`：真正 Next.js handlers／本機 HTTP fixture；login cookie、hash-only RPC、Origin、舊 Code 不能修改、新 Code 安全更新及拒絕人用 API。
- `tests/sql/owner-workspace-agent-archive.mjs` 及 `tests/api/owner-workspace-agent-archive.mjs`：已驗證本人確認、隔離、重試、一致性、撤銷及回復。
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
