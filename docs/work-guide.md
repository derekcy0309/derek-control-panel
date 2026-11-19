# 開工導航、一行加 Task 同三日 Dashboard

## 每日點用

1. 有件事要記？首頁打個 Task 名，按 Enter。預設本人、P2、無 Deadline。要改先按「更改設定」。可以用鍵盤聽寫；唔會自行建立或改返已移除嘅 Tag。
2. 想開工？按「帶我開工」。已有手排 Today 就照排位；未手排先按 Priority 建議，同級先睇 Deadline。已交俾人、未接受、等回覆、未解阻塞嘅工作唔會搶第一位。手動指定 Today 同自訂工作日沿用原有規則。
3. 導航只顯示一件，優先用原 Task 嘅實際步驟，否則接返已儲存嘅下一步，或按標題提供一個本機起步提示。「再細一步」可以只做起手動作，唔會當已結案；「呢步搞掂」會記錄進度。要中途走可按「記低下次點接」；正式儲存後其他裝置亦可接住做。未提交文字只暫存在本人目前分頁，登出清除。只有明確確認整件完成先關 Task；有未完成子任務會帶返原 Task。
4. 淺色 Dashboard 嘅「三日行程同 Deadline」會先列下一個行程、最近 Deadline，再按需要逐日打開。本人已揀選嘅 iCloud 行事曆保持唯讀，唔會轉成 Task；Apple 原有行程返 iPhone 改。只有本機、Google 或未揀嘅 iCloud 行事曆唔會憑空讀到。已有學校／家庭日期及未完成 Task 直接顯示，唔使重入；單一 Panel 行程同日亦有日期唔會顯示兩次。來源未更新時保留警示。

5. 「幾點要收手」會用下一個已定時間嘅約減出門／準備時間。例：14:52 開工，15:30 接放學，預留 20 分鐘，畫面顯示「15:10 收手 · 仲有 18 分鐘」。Dashboard 同導航都可以按「預留時間」改 0 至 180 分鐘；只記住本帳戶喺呢部裝置嘅數字。全日活動、待確認、已結束同 Task Deadline 唔會當成要出門；行程已開始會顯示進行中。提示唔響鐘、唔寫入 Calendar，亦唔改 Today 排位。

## 資料及權限

- 無新資料表、migration、外部 AI、推播、收費服務或環境變數。個人選用嘅預設標籤只保存標籤 ID，按帳戶及裝置分開。
- `/work-guide` 同 Dashboard 用同一個 Today 排序。讀取步驟用目前登入者及現有任務權限；`record_guide_step` 只新增 saved checkpoint，唔會將 Focus 私人草稿或相關連結變成公開進度。重試沿用同一操作 ID；紀錄唔含私人文字。
- 校園／家庭 dates 只由人用嘅 `/api/calendar-brief` 在本人 session 讀取：owner、三日香港日期、有上限、唔取備註。Grok 三日文字、授權、行程來源及 iCloud 設定不變。私人內容不會加入 PWA 離線 cache。
- Dashboard 重用已讀取嘅日曆，導航用同一個人用 endpoint 嘅 `?view=work-stop` 精簡回應（只含時間、標題同來源狀態，冇 Task、學校備註或帳戶 ID）。倒數喺裝置上計，唔會每分鐘查 DB。在前景約每五分鐘重讀；來源唔完整或過舊唔會估可用時間。

## 驗證及回復

- `npm run test:work-guide`：預設 Tags、手動次序／交接、起步／恢復、日曆取捨及去重。
- `node tests/api/work-guide.mjs` 以隔離的 Supabase 協定測真 Next routes：登入、用戶隔離、重試及 audit。`node tests/browser/simple-mode.mjs` 以三個測試身份、手機及桌面測新增、返回、手排、完成一步、完成整件、重試及日曆。
- `node tests/sql/work-guide.mjs` 可另用本機 PGLite 執行原有 checkpoint migrations，驗證 owner、唯讀成員、無關帳戶及可編輯成員嘅權限，唔會連去正式 DB。
- 無需 DB 回復；如要撤回，只需使用之前嘅 app deployment。原有 Task、Tags、排位及已儲存 checkpoint 可由原有頁面繼續讀取。
