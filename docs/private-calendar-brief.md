# 私人 Calendar／Grok 三日日報

## 使用方式

首頁保留最多三項 Task，再顯示今日／聽日／後日的私人行程及未完成 Deadline。香港時間由 server 計算，Deadline 只有日期，不捏造 23:59 或將 Task 變成約會。跨日／全日行程會出現在重疊的日期，全日結束日期採 exclusive 規則。

跨日行程同時列出開始及結束日期，避免只列時間而看起來像重複的一小時約會。單次行程跨超過 31 日會提示檢查原本 Calendar 的「結束」日期（不是「結束重複」）；只屬來源資料提示，不會自動縮短、刪除或修改原本行程。合法長行程仍會完整保留。

「更新」會先經已驗證來源／本人權限的 Apple refresh endpoint 重新讀取（保留每帳戶 30 秒保護），再獨立讀取 Panel 行程及 Deadline；唔會因為五分鐘自動讀取快取而令手動操作沒有作用。未連接 Apple 的帳戶仍可更新 Panel；Apple 失敗或 cooldown 亦不阻止 Task 更新。畫面保留上次結果，顯示完整更新日期、安全錯誤原因及 retry；前端 50 秒／Apple transport 整體 40 秒時限避免一直轉圈。

錯誤只保存固定 allowlist 代碼，絕不記錄原始 provider error、帳戶網址或 ICS。沒有 DTEND／DURATION 的 DATE-TIME 行程按 RFC 5545 視為時間點，包括香港午夜，不應令整份 Calendar 失敗；倒置日期仍不會當作正確行程。

支援 Apple 省略 VTIMEZONE 時仍提供的 IANA TZID（例如 Asia/Tokyo、America/New_York）；以固定版本、僅 server-side 的 Temporal polyfill 正確轉 UTC，並處理每一期夏令時間及重複／不存在的本地時間。原有 VTIMEZONE 定義仍優先使用；真正未知的時區會顯示安全錯誤，絕不當作香港時間猜測。

Settings → 私人 Calendar 及 Grok 日報：

1. 用 Apple Account 電郵及 App 專用密碼連接，再明確揀 1–10 個 iCloud Calendar。需要 Apple 雙重認證；密碼只能在頁面表格輸入，不貼聊天、不保存表單草稿。
2. iPhone 改行程，Panel 只讀。不要使用公開 Calendar URL，不需要把行程抄入 Task。
3. 明確開放一個本人 Grok grant 的 Calendar 摘要／本人現有及日後 Task。此權限可由停用整個 Agent Code 撤銷；Notes 的逐項範圍不擴大。
4. 將 Routine 指令送到本人的 Grok Bot 私人對話：每日 Asia/Hong_Kong 08:30，只讀 `/agent/brief` 一份文字並回報當日起三日。先試跑並核對儲存時間；Panel 不會把「複製指令」當作已建立排程。

現有 Google 同步（Panel confirmed schedule → 選定 Google Calendar）不改動。此版本不會將 Google Calendar 外部事件再經 iCloud 重複匯入。iPhone Calendar 裏的 Google／Exchange 行程並非 iCloud 行程，不能聲稱 Apple 連接會讀到它們。新總覽現有來源是本人 Panel event 及本人選定 iCloud Calendar。

## 私隱與技術

- `apple_calendar_connections`、`private_calendar_snapshots`、`agent_brief_permissions` 全部開 RLS；只按本人 owner 限制，不繼承 household、share_records 或共同跟進權限。
- Apple 密碼經既有 `GOOGLE_TOKEN_ENCRYPTION_KEY` AES-256-GCM 加密，明文另有 apple-purpose 前綴驗證。只在 server 解密，authenticated 連 ciphertext 欄位亦不可 SELECT；不交 Grok、不輸出 log。
- App 專用密碼不是 Apple 原生 readonly scope；由程式 transport 限制 HTTPS、只准 Apple CalDAV 主機及 GET／OPTIONS／PROPFIND／REPORT，禁止 PUT／DELETE／POST 等寫入。redirect 每一跳重新檢查，不能轉發 credentials 到其他主機。
- 釘選 `tsdav` 2.5.0／`ical.js` 2.2.1。讀取固定三日 window，要求 server 展開 recurrence，並支援本機 recurrence／exception／cancellation 解析。未知時區、過大回應、展開上限會明確失敗，不會悄悄漏報。
- 快取只留最少顯示欄位，不留原始 ICS、description、attendees、附件。最多 200 個事件，超限明確標記不是完整清單。刷新成功以一個 DB upsert 原子替換；比較 fetched_at 防舊回應覆蓋新快取，鎖定 connection revision 防更改 Calendar 選擇後的舊同步落地。
- Dashboard／Grok 讀取時更新，5 分鐘內重用 server 快取；失敗退回同一 window 的舊快取並顯示 stale，跨日不冒充最新空清單。未連接顯示 not_connected。瀏覽器 API 永遠 private/no-store，不加入 PWA 離線快取。
- `/api/calendar-brief` 驗證人用 auth，owner 由 session 決定；不接受任意 owner／日期參數。
- `/api/agent/brief` 只接受 Agent Code／cookie，先由 service-only SECURITY INVOKER `agent_brief_owner` 驗證 active admin owner、grant、額外 consent、expiry／revocation，再以回傳 owner 查詢。沒有前端 service key，沒有從 HTTP body 接收 owner。
- 額外 consent 只擴大「本人 Task」讀取，連另一人分享給本人但不是本人擁有的 Task 也不開放。無 AI／付費 API 調用、無自動改期／完成／交派。

## Migration／回復

Migration `20261114102407_private_calendar_daily_brief.sql` 只新增表、index、invoker RPC，並在已 opt-in grant 的舊 Task read RPC 加入本人未來 Task 範圍。修改前以精確字串計數檢查 RPC 漂移，否則 migration 停止。

回復先部署舊 app commit `257f805b1e14815e8cab77efef0eb338d3abe36f`，再執行 `supabase/rollback-private-calendar-daily-brief.sql`，停用新增摘要權限／RPC。保留原有 Task、Notes、財務、分享和新 audit，不 DROP database。若只是停用一個連接，可在 Settings 撤銷其 Agent Code；Apple 可按停止讀取，清除本系統保存的密碼／快取，原始 iPhone 行程不動。完整撤銷 Apple credential 需使用者到 Apple Account 撤銷 App 專用密碼。

沒有新增環境變數；沿用現有 Supabase server key 及 Calendar 加密 key。Grok 排程由其 cloud Routine 持有，不在 Panel 再建立重複 Cron／Email。

## 驗證及安全修補

- `tests/calendar-brief.test.ts`：HK 三日、跨月年、未完成 Deadline、優先序、全日／跨日、去重、stale／overflow、host／method／redirect 限制、recurrence cancellation，且不保留 ICS description。
- `tests/sql/grok-agent-access.mjs`：完整 migrations，明確 opt-in 才讀 future own Task，other owner 拒絕，secret column 拒絕，私人快取隔離及 grant 撤銷。
- `tests/api/grok-agent.mjs`：真正 Next handlers＋本機 HTTP fixture，hash-only credential、owner filter、三日結果、拒絕偽造 owner。
- `tests/browser/simple-mode.mjs`：三個角色、360／1280px，各自 Dashboard／Deadline、原有 Task／Tags／quiet／草稿流程。
- `tests/browser/grok-agent.mjs`：精簡摘要、不顯示新增按鈕；Settings 明確 consent、Calendar 不自動全選、密碼不保存草稿；原有 Agent flows。

在加入私人 credential 前一併做相容性安全修補：Next／eslint-config-next 15.5.29，zod 4.6.6，PostCSS 8.5.33，sharp 0.35.5，source-map-js 1.2.2，nanoid 3.3.18。npm production audit 為 0（當次掃描，不是永久無漏洞保證）。不升 Next／React 大版本。

實際 Apple 帳戶連接與 Grok Secure Form 需要使用者授權；fixture 通過不能冒稱第三方已接駁或 Routine 已開始。實際部署、來源與 UAT 狀態另記 release report。
