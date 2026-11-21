# 日序私人刊物庫

讀者：資訊站 → 資訊設定 → 開啟「刊物」。首頁只計自己有權限嘅版本；閱讀／收藏跟帳戶，唔跟瀏覽器。網站唔讀 Gmail，唔儲存郵箱權限，冇新增付費服務。原文唔可以放 Git、網站靜態資產、測試快照或服務日誌。首頁不展示新聞、刊名或跟進建議；刊內建議不產生 Task。

## 私人儲存與回復

本次 migration `20261121112726_dayline_publication_library.sql` 只新增獨立物件。每期身份為「擁有人＋系列＋出刊日」；授權名單、個人閱讀狀態、修訂內容分開。預設只授權擁有人。原始 HTML／Markdown 和公佈時的日期、涵蓋日期及來源識別保留；畫面只顯示文字、分段及安全 HTTP(S) 連結，唔會執行郵件 HTML。重試相同 digest 會回應 unchanged；修訂要提交上一版 digest，保留舊版。狀態唔受重試／修訂影響。

回復應先還原至上一個已驗證 Vercel deployment，保留刊物、版本、收藏及設定，舊版不會讀取新增表。要暫停接收可撤銷逐份授權；唔好 DROP 刊物 schema／清空正式庫。權限先以隔離 PostgreSQL 及另一帳戶驗證。此 migration 不會代用戶開啟任何開關。

## 出刊接收（非 Gmail 輪詢）

沿用原來五個 Codex 排程：home 二／四 10:00、ngo 三 10:00、chronic 五 10:00、weekly 六 09:00、us 一至六 20:00，香港時間。原本對話仍照常發表。程式不會自創第二個排程。

首次四封指定實刊由可信匯入程序以登入者對應嘅收件人，將完整 envelope 經 `preparePublication` 轉換後呼叫私有 `dayline_reading.ingest`。11 月 21 日市場試刊只應使用原對話已完整發表的內容。匯入過往刊物不等於排程成功。

其後：原排程完成出刊 → 用完整同一份輸出組合 envelope → 以該帳戶／該系列專用嘅 write-only key 呼叫 `POST /api/publications/deliver`。不得傳 Task、其他對話或用戶識別碼。key 不得放在 automations prompt、對話或 Git。每個 key 可獨立撤銷／輪換，180 日到期。用家已登入並在本網站確認後，可由 `POST /api/publications/publisher` 提交 `{series,action:"rotate"}` 或 revoke；key 只在建立時顯示一次。網站不需任何新 service-role／Vercel 秘密。

受信任的排程執行環境可透過秘密儲存注入 `DAYLINE_PUBLISH_HOME/NGO/CHRONIC/WEEKLY/US`（逐個執行程序只給所需系列），再用 `node scripts/dayline-publish.mjs <series>`。stdin 為 JSON：`{outcome:"issue",issue:{series,title,published,from,until,lead,format:"markdown",original,sourceRef,sourceKind:"codex-scheduled"}}`。真正無新刊可傳 no_issue、失敗傳 failed，唔可以將超時當作成功。HTTP 409 表示版本衝突，不應覆寫。原刊原文可可靠取得且收妥後才算成功；記錄 checked_at、結果，不記內容或 key。在既有排程環境有適當秘密儲存及真實觸發回執前，不應聲稱已自動同步。

## 驗證

現有五個本機排程已另加交件，不改收刊對話或時間。Windows 私人中轉工具 `scripts/publisher-relay.ps1` 安裝到出刊帳戶的 LocalAppData（不放 OneDrive）。每系列各有只能投遞的憑證，以 Windows CurrentUser DPAPI 加密；只有公用驗證雜湊入庫。不持有 Panel 登入、資料庫密碼、或其他帳戶權限。出刊先將該份原稿加密排隊，收到伺服器收條後才移除待送本；失敗留待同一個排程重試，不另開發刊排程。不應更換電腦或 Windows 帳戶後直接複製加密憑證。憑證有效 180 日，可逐份撤銷或由擁有人續授權；到期不擴權或靜默繞過。

以 `-Action Confirm -Series <系列> -Day YYYY-MM-DD` 核實指定日的收條；佇列清空不是成功證據。每系列首份真刊會自動將同一原文重送，只有伺服器回覆同一版本的 unchanged 才記錄首刊重送通過。正式出刊記錄需與原排程當日實際發表對照；不要將未輪到的系列標成已實測。2026-11-21 的美股正式刊與同日試刊各自有獨立 ID、原文及閱讀狀態。同日 regular 重試只會對上 regular，唔會覆寫 trial。

- 單元測試：`node --experimental-strip-types --test --test-isolation=none tests/*.test.ts`。
- `tests/publications-db.mjs`：隔離 PostgreSQL、真實 RLS／RPC、重試、修訂、搜索片段、獨立帳戶狀態、到期及撤銷授權。設定 `DAYLINE_PGLITE` 指向本機 PGlite dist/index.js；私有真刊可用 `--private-stdin`，只在記憶體傳入，毋須另外儲存郵件。
- `--browser` 搭配 localhost 正式模式 build，跑手機＋桌面：從首頁進未讀、收藏不改已讀、網絡失敗不改已讀、成功開啟／段落定位、重開同帳戶取回收藏、其他帳戶直接進入都讀唔到。驗證用測試身份不等於用過真人登入。
