# Recurring Routines

## 行為

重複工作從建立任務時啟用，可選每日、每星期指定日、每月同一日、自訂相隔日數或夜更週期，也可限制只在工作日產生。

系統不會預先產生未來數週或數月的任務。只有目前這一項由 `not_started`／其他未完成狀態首次轉為 `done` 時，才會建立一項下一次的私人任務。完成重送或重試不會重複建立，因為每個「規則 + 已完成來源任務」只可有一筆 generation。

下一項會保留任務的工作內容、預計時間、能量、context、Definition of Done、風險、影響旗標、項目連結及跟進日相對偏移；它不會複製舊有分享、交接、notes 或 checkpoint。這避免私人資料或原本的指派被意外帶到下一輪。

## 權限與私隱

- `task_recurrence_rules` 只可由任務擁有者讀取及管理。
- `task_recurrence_generations` 只可由該規則擁有者讀取。
- 一位獲交接或分享的跟進者仍可完成目前任務；如規則仍啟用，下一項只會建立為原擁有者的私人任務。
- 任務擁有者可在任務卡暫停或恢復規則。暫停後完成目前任務不會產生下一項。

所有新增 public table 均啟用 RLS。資料庫 trigger 只在受控的 private schema 執行；沒有 service role key 送到瀏覽器。

## 資料模型

- `public.task_recurrence_rules`：頻率、週日、工作日限制、夜更週期、不可變的 seed task、owner 和任務範本。
- `public.task_recurrence_generations`：來源任務、產生的下一項及安排日期；unique constraint 防止重複。
- `public.tasks.recurrence_rule_id`：可為空的向後相容連結。

## 回退

`20260724173935_recurring_task_routines.rollback.sql` 會先拒絕執行，除非 recurrence rule、generation history 和 task link 已被明確處理。它不會靜默刪除使用者的工作歷史或新產生的任務。

## 驗證

資料庫驗證應至少測試：完成後只產生一項、同一項重送不重複、暫停後不產生、Derek／Suki 互相看不到對方私人 recurrence rule 與 generation history。migration contract test 會鎖定 RLS、dedupe、completion-only trigger、private successor 及 safe rollback 的結構。
