# 日序：任務分級及香港時鐘

「加 Task」可選擇 First priority、Urgent、Semi urgent 或 Non urgent。新任務分別預填香港日期 +7 日、+14 日、+1 個曆月或 +42 日。一個曆月保留原日數；下月無嗰日就用月底。仍然可以只填名稱，亦可自行改或清除 Deadline。

- Deadline 控制行程、過期和限期提醒；修改它不會改分級。系統用獨立升級日期，進入一個月、14 日、7 日窗口時只升不降。原定日期已過亦不會降級。
- 如需降級，在「修改 Task」揀分級。手動設定會重新開始升級窗口，避免立即升返上去，但不會移動實際 Deadline。手排「今日」仍然優先。
- 先前屬於擁有者的 P1–P4 任務 Tags 過渡到同一套顯示及篩選，舊 Tag 資料及其他人的私人分類不會被更改。只有任務擁有者可手動改正式分級。無限期恆常工作沿用原始選擇且不新增 Deadline；有期限的下一期按原有恆常規則計期限和升級窗口。
- 全站時鐘同時顯示香港農曆及適用的公眾假期名稱。星期日及公眾假期以紅色標示日期。農曆採用 [香港天文台資料](https://data.gov.hk/en-data/dataset/hk-hko-rss-gregorian-lunar-calendar-conversion-table)，公眾假期採用 [政府 1823 資料](https://www.1823.gov.hk/tc/hong-kong-public-holidays-ical)。

## 部署及回復

先在隔離環境執行並驗證 `20261125092501_dayline_task_priority_grade.sql`，再部署 app。沒有新增環境變數或雲端排程；沿用原本香港時間 08:30 受驗證的 Cron 保存升級。在 Cron 前，介面亦以香港日期計出同樣的結果。資料庫只會改分級欄位及相容的排序數字，不改 Deadline 或 Tag links。Backup JSON 包含新欄位；restore v4 只還原今次新建立的本人任務，不更新衝突記錄。

若要回復，先回退 app，再依 `supabase/rollback-20261125092501-dayline-task-priority-grade.sql` 停用升級、還原新增的 trigger / RPC，保留已存分級、備份格式、Tags 及其他資料。香港時鐘的公開資料不需要登入或接觸帳戶資料。
