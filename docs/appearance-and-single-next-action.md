# 單一步驟 Today 與視覺主題

## 目的

首頁第一屏只要求使用者處理一項工作，避免同時展示多個同等重要選項。視覺主題用作辨認範疇和提升使用意欲，不會改變 task priority、AI/rules 排程結果、資料權限或完成紀錄。

## Today 行為

- 第一項可執行工作顯示為「現在只做這一件」。
- 「開始 5 分鐘」沿用 Focus Mode，只降低啟動門檻，不自動完成 Task。
- 「我開始唔到」開啟既有拆細流程。
- 其餘兩項只放在「完成這一步後再看」，不與第一項競爭注意力。

## 分區身份色

| 分區 | 主色 | 輔助意象 |
|---|---|---|
| Today | Indigo | Sunrise |
| 家庭 | Sky blue | Warm yellow |
| 個人 | Teal | Green |
| 工作 | Violet | Magenta |
| 財務 | Amber | Coins |
| 健康 | Emerald | Heart |
| Urgent | Rose | 只在真正風險位置使用 |

每個分區同時使用標題、icon 和顏色，資訊不會只靠顏色表達。

## 可選主題

- Sunrise：明亮溫暖，預設日間主題。
- Ocean：藍綠、低刺激。
- Aurora：紫紅、較有活力。
- Night Shift：深藍、降低夜間亮度。

視覺強度另有 `quiet`、`balanced`、`vivid`。設定儲存在 `user_settings.visual_intensity`，只影響裝飾和色彩強度。

## 完成回饋

任務完成後，Task row 會短暫轉綠並顯示葉子和「完成一步」，然後重新載入最新資料。沒有 streak、扣分或持續閃爍，休息不會令使用者失去已取得的進度。

## Migration

套用：`supabase/migrations/20260910120000_visual_themes.sql`

回退：`supabase/migrations/20260910120000_visual_themes.rollback.sql`
