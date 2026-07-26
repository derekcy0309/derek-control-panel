# Life OS v1 架構與產品邊界

## 目的

Derek Control Panel 不是用意志力逼使用者完成更多工作。它的任務是補償 ADHD、抑鬱、照顧小朋友及動物、夜更、家庭與財務壓力造成的時間盲、啟動困難、過量承諾及中斷成本。

核心循環：

```text
捕捉事情
→ 權限及安全規則篩選
→ 輸入今日真正可工作時段
→ AI 以最低 effort 安排
→ 使用者接受內部計劃
→ Focus／Checkpoint
→ 完成、Waiting 或重新評估
```

## 三層資料權限

`area` 和 `visibility` 是兩個不同概念。

| area | 預設可見性 | 行為 |
|---|---|---|
| `personal` | `private` | 只有 owner 可見；Suki 的介面、搜尋、AI 和電郵均不可讀取 Derek 私人項目，反之亦然 |
| `work` | `private` | 只有 owner 可見；需要合作時使用既有 explicit share／assignment／joint ownership |
| `family` | `household`（家庭邀請已接受後） | 同一 household 的兩位成員可讀取及更新進度；owner 仍控制內容、擁有權及分享 |

未處理 Inbox 是例外：即使選擇 `family`，捕捉內容仍維持 `private`。只有處理後建立的家庭 Task／Waiting／Event 等才會轉成 `household`，防止未整理文字意外曝光。

RLS 是真正的存取控制；前端隱藏只屬使用體驗。家庭成員不能藉改網址或 API 讀取私人項目。

## Household 邀請

家庭共享必須經過兩步：

1. 一位用戶用另一位的登入電郵發出邀請。
2. 對方登入後接受。

接受前不會取得家庭資料。接受後，雙方現有的 `family + private` 項目會安全轉成 `household`；未處理 Inbox 仍保持私人。

## AI Daily Planner

每日由使用者提供：

- 一段或多段可工作時間
- 能量
- 今日模式
- 家庭負擔
- 恢復需要
- 突發／休息 buffer

系統先用既有確定規則排除 Blocked、Waiting、未完成 dependency、超出 WIP、安全或權限不符的工作。AI 只能在伺服器提供的候選 Task ID 中排序，不能自行建立任務。

伺服器會再：

- 拒絕模型新增或重複的 Task ID
- 避開已確認家庭／本人行程
- 將工作限制在輸入時段
- 保留 buffer
- 對 Minimum Viable Day 或高恢復需要硬性限制為一項
- 對 depression／gentle／低能量／高家庭負擔限制最多三項
- 對 ADHD 限制轉題數量並要求具體第一步
- 每位用戶每分鐘最多五次、滾動二十四小時最多五十次 AI 分析

AI 失效時會回退到既有規則式排序。AI draft 只存在 `ai_daily_plans`；使用者接受後，伺服器會沿用現有 `accept_today_auto_plan` transaction，把同一批 Task 寫入既有 Today planning metadata。AI 不會建立第二套 Task mutation，亦不會寫入 Google Calendar、完成 Task、改 deadline 或交接工作。

## AI Task Analysis

單一 Task 可要求：

- 最快完成路徑
- 頭十分鐘可見動作
- 停止條件
- 估時
- 可否交接
- 缺少資料
- 減少 effort 方法

系統先遮罩 HKID、電話、長帳戶號碼、電郵、常見 reference code，以及有「病人／客戶／姓名／地址」標籤的識別資料。AI route 只讀取目前登入者經 RLS 可見的 Task。任務仍不應輸入病人姓名、完整地址或完整醫療紀錄。分析結果是預覽；只有使用者在 Task Card 明確確認，才沿用既有 `update_task` mutation 更新 Next Action／估時。

## Google Calendar 邊界

Google Calendar 代表外部已確認承諾，不代表 backlog。

同步條件必須全部成立：

```text
item_type = event
schedule_status = confirmed
calendar_target in (personal, family, work)
```

| Calendar target | 必須登入的 Google 帳戶 |
|---|---|
| Personal | 該 Derek Control Panel 使用者的登入電郵；Derek 是 `derekcy0309@gmail.com`，Suki 是她自己的登入電郵 |
| Family | 使用者自己的登入 Google 帳戶，再選擇雙方有寫入權限的共享 Family Calendar |
| Work | `info@wecarenursing.com.hk` |

普通 Task、AI Planned Task、Focus Session、Quick Win 及 tentative schedule 均不會同步。取消確認會刪除已同步 Google event。改 Calendar target 時，系統先刪除舊事件，再建立一個新事件；資料庫每個 schedule 只容許一個 event link。

OAuth access／refresh token 以 AES-256-GCM 加密，只存於 `private.google_calendar_tokens`。瀏覽器、RLS Data API 回應及 AI prompt 均不會取得 token。

## 每日三日到期電郵

Vercel Cron 每日約香港時間 08:30 呼叫受 `CRON_SECRET` 保護的 route。資料庫 security-definer claim 只會為 Derek 登入帳戶及顯示名稱為 Suki 的 active 帳戶，各自建立當天一個 delivery；其他測試／管理帳戶不會收到：

- 日期範圍是今日、明日及後日，共三個曆日
- 包括本人 Task、已接受 assignment、本人 Operating Item 及 household family item
- 私人資料只寄往 owner／獲授權用戶自己的登入電郵
- sensitive Operating Item 使用泛化標題並移除 Next Action
- 每封最多列出五十項，避免摘要本身變成壓力來源
- 即使沒有到期事項亦寄出溫和的「三日內未有到期事項」確認
- Resend idempotency key 防止同一 delivery 重複寄出

## 不由 AI 控制的項目

- RLS、權限及家庭成員資格
- Deadline、Latest Safe Start、WIP、安全及 dependency
- 確認／取消 Google Schedule
- 完成、延期、刪除、分享或交接
- 醫療、法律、臨床或財務結論

以上改動全部需要確定規則或使用者明確確認。
