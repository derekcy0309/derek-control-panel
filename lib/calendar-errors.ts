// Only fixed codes cross the provider boundary. Never return/log raw errors:
// DAV errors can contain account URLs, Authorization headers or calendar text.
const messages = {
 APPLE_AUTH_REQUIRED:"Apple 授權未能通過，請到 Settings → 私人 Calendar 用 App 專用密碼重新連接。",
 APPLE_CALENDAR_MISSING:"其中一個已選 Calendar 已移除或搬動，請到 Settings → 私人 Calendar 檢查選擇。",
 APPLE_TIMEOUT:"Apple 連線逾時，請稍後再按更新。唔需要改動原有行程。",
 APPLE_NETWORK:"暫時連唔到 Apple，請稍後再試。",
 APPLE_UNAVAILABLE:"Apple 暫時未能提供行程，請稍後再試。",
 APPLE_EVENT_INVALID:"Apple 有行程日期未能讀取，請在 iPhone 檢查開始／結束日期。",
 APPLE_TIMEZONE_UNSUPPORTED:"Apple 有行程時區未能讀取，請檢查原本 Calendar 的時區。",
 APPLE_RECURRENCE_LIMIT:"Apple 有重複行程超出安全讀取上限，請檢查原本 Calendar 的重複設定。",
 APPLE_RESPONSE_LIMIT:"Apple 回傳資料過多，請在 Settings 減少本次選擇的 Calendar。",
 APPLE_REQUEST_LIMIT:"本次 Apple 讀取已到安全上限，請稍後重試。",
 APPLE_HOST_REJECTED:"Apple 回傳的連接未通過安全檢查，未有讀取其他網站。",
 APPLE_WRITE_FORBIDDEN:"已阻止非唯讀操作，原有 Apple 行程沒有改動。",
 APPLE_REDIRECT:"Apple 回跳資料不完整，請稍後重試。",
 APPLE_REDIRECT_LIMIT:"Apple 回跳次數過多，請稍後重試。",
 APPLE_DISCOVERY_FAILED:"暫時未能找到 Apple Calendar 服務，請稍後重試。",
 APPLE_RESPONSE_INVALID:"Apple 回傳的 Calendar 資料未能讀取，請稍後重試。",
 APPLE_PARSE_FAILED:"Apple 有行程格式未能讀取，請稍後重試；原有行程沒有改動。",
 CALENDAR_CREDENTIAL:"Calendar 連接憑證未能讀取，請到 Settings → 私人 Calendar 重新連接。",
 CALENDAR_SELECTION:"已選 Calendar 與目前連接不符，請到 Settings → 私人 Calendar 重新選擇。",
 CALENDAR_DATABASE:"暫時未能儲存 Calendar 更新，請稍後重試。",
 APPLE_REFRESH_FAILED:"Apple Calendar 未能更新，請稍後重試或在 Settings 檢查連接。",
 GOOGLE_RECONNECT:"工作 Google Calendar 授權或日曆未能通過檢查，請到設定檢查工作 Calendar。",
 GOOGLE_UNAVAILABLE:"暫時讀唔到工作 Google Calendar，請稍後再按更新。"
} as const;
export type CalendarErrorCode = keyof typeof messages;
export function calendarErrorCode(error: unknown): CalendarErrorCode {
 if(error instanceof Error){
  if(Object.hasOwn(messages,error.message))return error.message as CalendarErrorCode;
  if(error.name==="AbortError"||error.name==="TimeoutError")return "APPLE_TIMEOUT";
  if(error instanceof TypeError)return "APPLE_NETWORK";
 }
 return "APPLE_REFRESH_FAILED";
}
export function calendarErrorMessage(code?: string | null) {
 return code&&Object.hasOwn(messages,code)?messages[code as CalendarErrorCode]:messages.APPLE_REFRESH_FAILED;
}
