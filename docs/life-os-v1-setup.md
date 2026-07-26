# Life OS v1 上線設定

## 1. 安裝與 migration

使用與 repository lockfile 相符的 Node／npm，安裝套件後依時間順序套用：

```text
20260726120000_life_os_ai_calendar_email.sql
20260726121000_life_os_boundary_hardening.sql
20260726122000_fix_family_visibility_record_shape.sql
```

先在 preview Supabase 執行，再用 Derek／Suki 測試帳戶完成 RLS 驗證，最後才套用 production。

## 2. Vercel AI Gateway

設定：

```text
AI_MODEL=openai/gpt-5.4
```

Vercel production 可使用 OIDC；本機或未啟用 OIDC 的環境需要設定：

```text
AI_GATEWAY_API_KEY=...
```

AI 不需要 Supabase service-role key。不要把 AI credential 加上 `NEXT_PUBLIC_`。

## 3. Google Cloud OAuth

在 Google Cloud 建立 Web OAuth Client，啟用 Google Calendar API，加入 production callback：

```text
https://derek-control-panel.vercel.app/api/integrations/google-calendar/callback
```

Preview／本機如需測試，要加入各自的完整 callback URL。設定：

```text
GOOGLE_CALENDAR_CLIENT_ID=...
GOOGLE_CALENDAR_CLIENT_SECRET=...
GOOGLE_OAUTH_STATE_SECRET=<最少 32 字元隨機值>
GOOGLE_TOKEN_ENCRYPTION_KEY=<32-byte base64 或 64 位 hex>
WORK_GOOGLE_ACCOUNT_EMAIL=info@wecarenursing.com.hk
SUKI_LOGIN_EMAIL=<Suki 的 Derek Control Panel 登入電郵>
```

安全要求：

- OAuth redirect 必須與目前登入 user 的 signed state 一致。
- Personal／Family target 必須用該用戶的登入 Google 電郵授權。
- Work target 必須由 `info@wecarenursing.com.hk` 授權。
- Google Workspace 管理員若限制第三方 OAuth，需要先批准此 OAuth app。
- 連接後在 Settings 為每個 target 選擇有 `writer` 或 `owner` 權限的 Calendar。
- 不可以在授權失敗時靜默改用另一個 Calendar。

## 4. Family Calendar

先在 Google Calendar 建立共享 Family Calendar，並向 Derek 及 Suki 的個人 Google 帳戶授予修改事件權限。兩人各自在 Derek Control Panel 連接 `Family` target，再選擇同一共享 Calendar。

## 5. Resend 每日電郵

在 Resend 驗證 `wecarenursing.com.hk` 寄件網域，設定：

```text
RESEND_API_KEY=...
REMINDER_FROM_EMAIL=Derek Control Panel <info@wecarenursing.com.hk>
NEXT_PUBLIC_APP_URL=https://derek-control-panel.vercel.app
CRON_SECRET=<現有通知系統使用的同一高強度 secret>
```

`vercel.json` 已設定每日 `00:30 UTC`，即香港時間約 08:30，呼叫 `/api/cron/due-email`。Vercel 會用 `Authorization: Bearer $CRON_SECRET`。同一 secret 的授權設定必須已按照現有通知文件寫入 Supabase private config／Vault。

## 6. 應用內設定

1. Derek 登入，Support profile 選 `ADHD 配合`。
2. Suki 登入，Support profile 選 `Depression／溫和配合`。
3. 一方用另一方的登入電郵建立家庭共享；另一方接受。
4. 兩位用戶各自確認每日三日到期電郵已啟用。
5. 連接 Personal、Family、Work Google targets。Work target 只需需要寫入工作 Calendar 的用戶連接。

## 7. 發佈前驗證

必須全部通過：

```text
npm run typecheck
npm run lint
npm test
npm run build
```

另外以 Derek／Suki 真實測試帳戶驗證：

- Suki 看不到 Derek personal／private work Task，反向亦然。
- 接受 household 後，雙方可看到 family Task；可更新進度但不能改 owner／visibility。
- 未處理 family Inbox 仍只由建立者看到。
- Suki 的 AI plan 不會讀取或暗示 Derek 私人 Task 數量／名稱。
- AI 建議未知 Task ID 會被伺服器丟棄。
- Minimum Viable Day／高恢復需要只安排一項。
- AI accepted plan 不會產生 Google event。
- tentative schedule 不同步；confirmed schedule 正確新增、更新、取消及切換 Calendar。
- Personal target 拒絕非登入電郵；Work target 拒絕非 `info@wecarenursing.com.hk`。
- 每位用戶只收到自己的私人到期項目；家庭項目可按 household 權限出現在雙方自己的電郵。
- 同日重跑 cron 不會重複寄信。
- 沒有到期事項仍收到無壓力摘要。

## 8. 發佈策略

先建立 preview deployment，完成 migration、RLS、OAuth、Resend、AI fallback 和兩帳戶 E2E。確認 production environment variables 後才 promote；不要在未完成真實 RLS 測試前直接覆蓋 production。
