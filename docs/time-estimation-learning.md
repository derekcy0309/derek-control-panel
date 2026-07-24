# Time Estimation Learning

Time Estimation Learning 幫 Derek 和 Suki 分開比較自己填寫的「預計分鐘」與「實際分鐘」。它用於減少日後估時的壓力，不是監察、排名或比較兩人的產量。

## 記錄方式

- 在 Focus Mode 暫停或完成時，系統記錄該次任務目前的實際分鐘；任務表單亦可手動補填。
- 每筆 observation 包含任務類型、情境、能量、預計／實際分鐘及完成或暫停狀態。中斷次數欄位已保留，會由 Focus Session History 階段補上。
- 舊有任務如已有合法的預計與實際分鐘，會以 task owner 作一次性歷史回填；新紀錄會屬於實際登入並更新該任務的人。

## 建議邏輯

輸入預計分鐘後，系統按下列順序找至少三筆同一人的資料：

1. 同任務類型、情境及能量
2. 同任務類型及情境
3. 同任務類型
4. 該使用者所有有紀錄工作

每一層取「實際／預計」比例的中位數，並把單筆極端比例限制在 0.25 至 4 倍。系統會清楚顯示原始預計、樣本數和建議分鐘；除非使用者按「採用建議」，不會改動任何任務。

## 私隱、RLS 與回退

Migration `20260725220000_time_estimation_learning.sql` 的 `task_time_observations` 只容許 `user_id = auth.uid()` 的人讀取。Derek 看不到 Suki 的學習資料，反之亦然；分享任務不會分享另一人的 observation。前端沒有寫入權，資料只由受限 trigger 在使用者明確更新 task time 時產生。

回退前須先匯出或明確移除 observations，然後才執行 `20260725220000_time_estimation_learning.rollback.sql`。rollback guard 會阻止意外刪除學習資料，而且不會刪除任何既有 task 或其 estimate／actual 欄位。
