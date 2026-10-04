# 任務拆解與交接提示

## 使用方式

「項目」不再出現在導航或新增表單；舊 `/workspace/project` 只顯示轉往任務的說明，原有資料不會刪除。打開任務詳情後按「新增子任務」，輸入名稱即可；到期日及指派對象可選。每項子任務都是既有 `tasks` 表的一筆記錄，擁有獨立交接和完成狀態。完成子任務不會自動結束原任務。舊 `task_steps` 如已有紀錄仍可查看及更新，但不再新增，以免與子任務重疊。

按「AI 幫我拆細」會為目前任務準備一段經常見敏感資料遮罩的 ChatGPT 指令。用戶先檢查、複製並在 ChatGPT 送出，再把 JSON 回覆貼回任務頁。系統會驗證任務識別碼及步驟格式，展示最多六項可修改、可取消勾選的子任務草稿。只有按「確認建立已勾選子任務」後，才逐項寫入既有 `tasks` 表。建立過的項目不會在網絡重試時重複；AI 不會自行指派、改期或關閉原任務。一般 AI 子任務不另設到期日，避免每步重複提醒；Request Duty 類別因既有規則會沿用原任務日期。手動新增子任務仍然可用。

此流程沿用既有手動 ChatGPT，無新增付費 API 或環境變數。未送出前，用戶必須自行確認遮罩後的 Prompt 沒有私人或敏感資料；系統無法保證辨識所有姓名或內容。`ai_analysis_events` 只記錄回覆 hash 和步驟數，不儲存拆解全文。正式環境仍需先套用本頁下方所列的子任務 migration；AI 拆解本身不需要新 migration。

交出任務後，接收者在使用系統時會看到畫面提示，可按「確認收到」。這只記錄 `assignments.acknowledged_at`，不等於接受接手；對方可稍後在「交辦及分享」選擇接受、要求補充或改期。派任者會看到已收到提示；如自行啟用了瀏覽器通知，亦會收到 generic Web Push。若直接接受，既有 `accepted_at` 及 `handover_accepted` 通知仍照常使用。未確認時，接收者下次開啟系統仍會看到待確認提示。

如個人安靜模式正在生效，畫面彈出提示會暫停；交接資料照常記錄，安靜模式結束後再顯示。

已確認收到或已接受、但未完成的任務在到期前一天（香港日期）會在派任者畫面提示追進度。已啟用 Web Push 的派任者另按自己的 deadline 提前時間收到一則 generic 通知。提示不包含任務標題、備註或其他私人內容；每個指派及到期日只排一次。沒有瀏覽器通知授權時，畫面提示仍有效。

## 資料、安全及回退

Migration `20261004150000_task_children_assignment_followups.sql` 只新增 nullable `tasks.parent_task_id`、nullable `assignments.acknowledged_at`、部分索引、驗證 trigger 及冪等的 cron RPC。子任務只可掛在自己擁有、未封存的上層任務，並沿用相同分類；不會因 parent 已分享而自動分享 child。子任務仍受原 `tasks` RLS、分享及交接規則限制。Parent link 建立後不可指向另一項任務，以避免循環；上層任務硬刪除時 child 會自動解除連結，資料不會跟隨刪除。

Cron RPC 只接受既有 `CRON_SECRET` 的受驗證呼叫，使用 `(user_id,dedupe_key)` 防止重複發送；非緊急 Web Push 遵守使用者通知開關及安靜時段。新 RPC 出錯不會阻斷原有通知派送，但 cron 回應會標示 `followupSchedulingFailed` 供監控。

配對 rollback 只關閉新 follow-up RPC。程式可退回上一個 Git commit；`parent_task_id` 和 `acknowledged_at` 故意保留，避免回退時破壞已建立的子任務及確認紀錄。正式套用前須先在 Preview／staging 驗證 migration，並確認備份；本改動不需要搬移或刪除舊 Project／Task 資料。

現有 JSON 備份會包含 `parent_task_id`，但舊 restore 流程暫不重建 parent link；還原預覽會明確列出數量。原子任務內容不會被刪除，但會暫作獨立任務，故正式還原前須先核對預覽。
