# 私人 Calendar／Grok 三日日報

## 使用方式

首頁保留最多三項 Task，再顯示今日／聽日／後日的私人行程及未完成 Deadline。香港時間由 server 計算，Deadline 只有日期，不捏造 23:59 或將 Task 變成約會。跨日／全日行程會出現在重疊的日期，全日結束日期採 exclusive 規則。

獨立「日曆」頁按目前顯示月份讀取本人已揀嘅 iCloud Calendar，包括月曆格中的相鄰星期，最多 42 日。「更新 iPhone 行程」重新讀取目前月份；會區分未連接、未揀 Calendar、讀取失敗及確定冇行程。只存在 iPhone 本機，或者出自 Google／Exchange 帳戶嘅行程唔會由 iCloud 讀到；仍在 iPhone 改動，日序不會寫回。首頁同 Grok 日報繼續只睇三日。

「日曆」頁另讀你正在看的月份（包括畫面上的月初／月尾跨月格），所以可以看到三日以外的 iCloud 行程。「iPhone · 唯讀」仍只限你已揀的 iCloud 日曆；iPhone 入面的 Google、Exchange 或只存在本機的 Calendar 不會由 iCloud 讀到。首頁和 Grok 日報繼續只顯示三日。

跨日行程同時列出開始及結束日期，避免只列時間而看起來像重複的一小時約會。單次行程跨超過 31 日會提示檢查原本 Calendar 的「結束」日期（不是「結束重複」）；只屬來源資料提示，不會自動縮短、刪除或修改原本行程。合法長行程仍會完整保留。

「更新」會先經已驗證來源／本人權限的 Apple refresh endpoint 重新讀取（保留每帳戶 30 秒保護），再獨立讀取 Panel 行程及 Deadline；唔會因為五分鐘自動讀取快取而令手動操作沒有作用。未連接 Apple 的帳戶仍可更新 Panel；Apple 失敗或 cooldown 亦不阻止 Task 更新。畫面保留上次結果，顯示完整更新日期、安全錯誤原因及 retry；前端 50 秒／Apple transport 整體 40 秒時限避免一直轉圈。

錯誤只保存固定 allowlist 代碼，絕不記錄原始 provider error、帳戶網址或 ICS。沒有 DTEND／DURATION 的 DATE-TIME 行程按 RFC 5545 視為時間點，包括香港午夜，不應令整份 Calendar 失敗；倒置日期仍不會當作正確行程。

支援 Apple 省略 VTIMEZONE 時仍提供的 IANA TZID（例如 Asia/Tokyo、America/New_York）；以固定版本、僅 server-side 的 Temporal polyfill 正確轉 UTC，並處理每一期夏令時間及重複／不存在的本地時間。原有 VTIMEZONE 定義仍優先使用；真正未知的時區會顯示安全錯誤，絕不當作香港時間猜測。

Settings → 私人 Calendar 及 Grok 日報：

1. 用 Apple Account 電郵及 App 專用密碼連接，再明確揀 1–10 個 iCloud Calendar。需要 Apple 雙重認證；密碼只能在頁面表格輸入，不貼聊天、不保存表單草稿。
2. iPhone 改行程，Panel 只讀。不要使用公開 Calendar URL，不需要把行程抄入 Task。
3. 明確開放一個本人 Grok grant 的 Calendar 摘要／本人現有及日後 Task。此權限可由停用整個 Agent Code 撤銷；Notes 的逐項範圍不擴大。
4. 將 Routine 指令送到本人的 Grok Bot 私人對話：每日 Asia/Hong_Kong 08:30，只讀 `/agent/brief` 一份文字並回報當日起三日。先試跑並核對儲存時間；Panel 不會把「複製指令」當作已建立排程。

原本三日摘要尾有一行「登入日序開工」。只有已開放本人日報嘅 Agent 先可讀摘要；只有能確認首項為本人手排、本人擁有而可開始嘅工作時，先會顯示名稱。否則只列登入入口，唔估工作名。入口連去本人登入後嘅「而家做」，冇 Task ID、檔案／網址或密碼；以開啟時嘅實際「今日」次序為準。呢行唔會額外寄通知、改 08:30 排程或授權 Bot 開文件。

現有 Google 同步（Panel confirmed schedule → 選定 Google Calendar）不改動。需要顯示 Google 原有行程，可到「設定 → Google Calendar → 工作 Calendar」，確認已連接帳戶及日曆，再開啟「喺『行程同限期』顯示」。只在本人首頁額外讀取所選工作日曆的三日行程，不加到月曆、開工提示或 Grok 摘要。此開關預設關閉，更換帳戶或日曆後要重開；要更改行程仍到 Google Calendar。iPhone 上的 Google／Exchange 行程不是 iCloud 行程，並不經 Apple 連接讀取。

Google 讀取使用現有連接，對 events API 只作有時限的 GET；不儲存 Google 行程，亦不從讀取流程覆寫原有 OAuth 憑證。只讀取顯示及去重需要的欄位，私人／機密標題顯示「私人行程」，不讀備註、地點或出席者。Dayline 已送去 Google 的副本按同步標記去重，不用標題猜測。取得 Google 資料途中如關閉開關、更換連接或 Calendar，應丟棄舊結果。讀取失敗不阻止 Apple、Dayline 或 Deadline 顯示。

## 私隱與技術

- `apple_calendar_connections`、`private_calendar_snapshots`、`agent_brief_permissions` 全部開 RLS；只按本人 owner 限制，不繼承 household、share_records 或共同跟進權限。
- Apple 密碼經既有 `GOOGLE_TOKEN_ENCRYPTION_KEY` AES-256-GCM 加密，明文另有 apple-purpose 前綴驗證。只在 server 解密，authenticated 連 ciphertext 欄位亦不可 SELECT；不交 Grok、不輸出 log。
- App 專用密碼不是 Apple 原生 readonly scope；由程式 transport 限制 HTTPS、只准 Apple CalDAV 主機及 GET／OPTIONS／PROPFIND／REPORT，禁止 PUT／DELETE／POST 等寫入。redirect 每一跳重新檢查，不能轉發 credentials 到其他主機。
- 釘選 `tsdav` 2.5.0／`ical.js` 2.2.1。首頁與 Grok 摘要讀取固定三日，日曆頁讀取所選月份。兩者要求 server 展開 recurrence，並支援本機 recurrence／exception／cancellation 解析。未知時區、過大回應、展開上限會明確失敗，不會悄悄漏報。
- 快取只留最少顯示欄位，不留原始 ICS、description、attendees、附件。最多 200 個事件，超限明確標記不是完整清單。刷新成功以一個 DB upsert 原子替換；比較 fetched_at 防舊回應覆蓋新快取，鎖定 connection revision 防更改 Calendar 選擇後的舊同步落地。
- Dashboard／Grok 讀取時更新，5 分鐘內重用 server 快取；失敗退回同一 window 的舊快取並顯示 stale，跨日不冒充最新空清單。未連接顯示 not_connected。瀏覽器 API 永遠 private/no-store，不加入 PWA 離線快取。
- `/api/calendar-brief` 驗證人用 auth，owner 由 session 決定；不接受任意 owner／日期參數。
- `/api/apple-calendar-month?month=YYYY-MM` 只限有效人用帳戶及單一月份參數，以本人 session 定 scope。唯讀載入原有選擇，上限 500 個事件、超限有標示；不儲存月曆行程、不取代三日快取、不存瀏覽器持久快取。連接或選擇已變更時不回傳尚未完成的舊結果。
- `/api/apple-calendar-month` 只給已登入、已啟用的用戶。只接受一個月份、最多 42 日的顯示範圍；owner 由 session 決定。月份讀取不改動 Apple 行程、三日快取、Grok 授權或排程，不需新 schema。
- `/api/agent/brief` 只接受 Agent Code／cookie，先由 service-only SECURITY INVOKER `agent_brief_owner` 驗證 active admin owner、grant、額外 consent、expiry／revocation，再以回傳 owner 查詢。沒有前端 service key，沒有從 HTTP body 接收 owner。
- 額外 consent 只擴大「本人 Task」讀取，連另一人分享給本人但不是本人擁有的 Task 也不開放。無 AI／付費 API 調用、無自動改期／完成／交派。

## Migration／回復

Migration `20261114102407_private_calendar_daily_brief.sql` 只新增表、index、invoker RPC，並在已 opt-in grant 的舊 Task read RPC 加入本人未來 Task 範圍。修改前以精確字串計數檢查 RPC 漂移，否則 migration 停止。

回復先部署舊 app commit `257f805b1e14815e8cab77efef0eb338d3abe36f`，再執行 `supabase/rollback-private-calendar-daily-brief.sql`，停用新增摘要權限／RPC。保留原有 Task、Notes、財務、分享和新 audit，不 DROP database。若只是停用一個連接，可在 Settings 撤銷其 Agent Code；Apple 可按停止讀取，清除本系統保存的密碼／快取，原始 iPhone 行程不動。完整撤銷 Apple credential 需使用者到 Apple Account 撤銷 App 專用密碼。

沒有新增環境變數；沿用現有 Supabase server key 及 Calendar 加密 key。Grok 排程由其 cloud Routine 持有，不在 Panel 再建立重複 Cron／Email。

工作 Google Calendar migration `*_google_work_calendar_agenda.sql` 只在已有 owner RLS 的連接表加入預設關閉偏好、Work 限制及更換來源時的 reset trigger。回復時先部署上一版本，再執行相應 `*.rollback.sql`；只移除新偏好，不刪除工作連接、Google 行程或 Dayline 資料。

## 驗證及安全修補

- `tests/calendar-brief.test.ts`：HK 三日、跨月年、未完成 Deadline、優先序、全日／跨日、去重、stale／overflow、host／method／redirect 限制、recurrence cancellation，且不保留 ICS description。
- `tests/apple-calendar-month.test.ts`：新 API 的月份及 owner scope 合約、本人選擇、載入期間撤銷防護、跨午夜及全日行程、舊三日範圍回歸。
- `tests/sql/grok-agent-access.mjs`：完整 migrations，明確 opt-in 才讀 future own Task，other owner 拒絕，secret column 拒絕，私人快取隔離及 grant 撤銷。
- `tests/api/grok-agent.mjs`：真正 Next handlers＋本機 HTTP fixture，hash-only credential、owner filter、三日結果、拒絕偽造 owner。
- `tests/browser/simple-mode.mjs`：三個角色、360／1280px，各自 Dashboard／Deadline、原有 Task／Tags／quiet／草稿流程。
- `tests/browser/grok-agent.mjs`：精簡摘要、不顯示新增按鈕；Settings 明確 consent、Calendar 不自動全選、密碼不保存草稿；原有 Agent flows。
- `tests/browser/apple-calendar-month.mjs`：以隔離帳戶驗證手機／電腦、翻月、三日外行程、跨午夜／全日日期、失敗重試，以及首頁仍只讀三日。
- `tests/google-work-agenda*.test.ts`、`tests/sql/google-work-agenda.mjs`、`tests/browser/work-google-agenda.mjs`：固定唯讀 API、日期、私隱及去重，關閉／更換來源時拒絕舊結果，RLS 帳戶隔離及 rollback，360／1280 px 開關、儲存失敗及首頁顯示。這些使用隔離資料／模擬 Google，不代表已讀取正式帳戶。

在加入私人 credential 前一併做相容性安全修補：Next／eslint-config-next 15.5.29，zod 4.6.6，PostCSS 8.5.33，sharp 0.35.5，source-map-js 1.2.2，nanoid 3.3.18。npm production audit 為 0（當次掃描，不是永久無漏洞保證）。不升 Next／React 大版本。

實際 Apple 帳戶連接與 Grok Secure Form 需要使用者授權；fixture 通過不能冒稱第三方已接駁或 Routine 已開始。實際部署、來源與 UAT 狀態另記 release report。
