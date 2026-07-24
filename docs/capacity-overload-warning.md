# Capacity Overload Warning

Today 會在確實接近或超出容量時顯示一個溫和的「可以先收窄一點承諾」面板。這是建議工具，不是績效比較或自動排程器。

## 計算資料

- 今日填寫的可用分鐘、能量、minimum／gentle／night-shift 模式
- 已開始、已安排今日或已到安全開始／到期日的可執行任務預估時間
- 進行中 WIP 與個人 WIP 上限
- 上星期 Weekly Review 為本週填寫的可用時間（如有），以及本週餘下時間到期的本人家庭、學校、健康、寵物、家居或日程事項
- deadline、latest safe start、safety／child／legal／revenue impact 與 critical path

低能量、night-shift 及即將到期的家庭／健康事項會提高 buffer；blocked、waiting、已完成、封存和沒有被接受的共享任務不會計入可執行工作量。

## 建議邊界

面板只會列出低影響、未開始、非關鍵且沒有安全、子女、法律或收入影響的工作作「可考慮延後」候選。交接按鈕只會開啟既有的 Handover notes／確認畫面。它從不自動延期、交接、完成、刪除或改派任何資料。

今日與本週餘下時間的容量分開顯示；如沒有填寫可用時間，系統保持中性，不假設容量，也不產生壓力提示。

## 資料與私隱

功能使用現有 `daily_capacity_checkins`、`weekly_reviews`、tasks、planning、assignments 和 RLS 已限制的本人 `operating_items`。沒有新資料表、沒有新增敏感欄位，也不會將家庭或健康內容放進通知或分享資料。
