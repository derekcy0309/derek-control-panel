# Derek 控制面板

私人用 ADHD 外置執行功能 Web App。介面以繁體中文為主，分開「家庭」和「公司」，集中處理任務、收入、支出、會議，以及每日最重要的一件事。

## 專案結構

```text
app/                    Next.js 頁面
components/             共用 UI、表單、卡片
hooks/                  資料讀取 hook
lib/                    型別、中文標籤、計算邏輯、Supabase client
supabase/schema.sql     Supabase 資料表、RLS、索引
supabase/seed.sql       測試資料
supabase/update-2026-07-15-task-changes.sql  任務更新升級 SQL
```

## 本機設定

1. 複製環境變數範本：

```bash
cp .env.example .env.local
```

2. 在 `.env.local` 填入：

```bash
NEXT_PUBLIC_SUPABASE_URL=你的 Supabase Project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=你的 Supabase anon public key
```

3. 安裝和啟動：

```bash
npm install
npm run dev
```

## Supabase 設定步驟

1. 建立 Supabase project。
2. 到 SQL Editor 執行 `supabase/schema.sql`。
3. 到 Authentication > Providers，啟用 Email。
4. 到 Authentication > URL Configuration，加入本機網址 `http://127.0.0.1:3000`、`http://localhost:3000` 和 Vercel 網址。
5. 到 Authentication > Sign In / Providers，確認 Email 已啟用。
6. 建議到 Authentication > Users 手動新增自己的使用者，設定電郵和密碼，並確認使用者已啟用。
7. 用 App 的「密碼登入」登入一次，然後到 Authentication > Users 複製你的 user id。
8. 在 `supabase/seed.sql` 把 `00000000-0000-0000-0000-000000000000` 換成你的 user id。
9. 到 SQL Editor 執行 `supabase/seed.sql`。

## 已有資料庫的升級步驟

如果你已經在 Supabase 執行過舊版 `schema.sql`，請到 SQL Editor 再執行：

```text
supabase/update-2026-07-15-task-changes.sql
```

這個升級會：

- 取消任務「下一步」必填
- 加入完成日期及時間
- 加入刪除日期，刪除任務會先保留 30 日

## Vercel 部署步驟

1. 把專案推到 GitHub。
2. 在 Vercel 匯入專案。
3. Build command 使用 `npm run build`。
4. 在 Vercel Project Settings > Environment Variables 加入：

```bash
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
```

5. 部署完成後，把 Vercel 網址加入 Supabase Authentication > URL Configuration。

## Dashboard 排序邏輯

「今日只做一件」會用以下優先順序計分：

1. 狀態是「有問題」
2. 已逾期
3. 今日到期
4. 3 日內到期
5. 3 日內要付款
6. 預計收入已延遲
7. 風險是「高」
8. 公司收入相關任務
9. 家庭債務 / 付款相關任務

## 第一版刻意不包含

- Email 自動提醒
- AI 自動拆會議
- WhatsApp、Apple Calendar、Google Calendar integration
- 多租戶 SaaS 權限
