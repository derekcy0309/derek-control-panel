import { NextRequest } from "next/server";
import { z } from "zod";
import { authenticateRequest, privateJson } from "@/lib/server/request-context";
import { redactSensitiveText } from "@/lib/ai/redact";

const shortText = z.string().trim().min(1).max(2000);
const inputSchema = z.object({
  title: shortText,
  step: shortText,
  progress: z.string().max(2000),
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: shortText })).min(1).max(9)
});
const outputSchema = z.object({
  output: z.array(z.object({
    type: z.string(),
    content: z.array(z.object({type: z.string(), text: z.string().optional()})).optional()
  }))
});

export async function POST(request: NextRequest) {
  const context = await authenticateRequest(request);
  if (context instanceof Response) return context;
  const allowedEmail = process.env.TASK_COACH_EMAIL?.trim().toLowerCase();
  const key = process.env.OPENAI_API_KEY;
  if (!allowedEmail || !key) return privateJson({error:"即時教練等待設定 API key 同使用帳戶。"}, 503);
  if (context.user.email?.toLowerCase() !== allowedEmail || !context.user.email_confirmed_at) {
    return privateJson({error:"此帳戶未開通即時教練。"}, 403);
  }
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || parsed.data.messages.at(-1)?.role !== "user") return privateJson({error:"請輸入簡短訊息再試。"}, 422);
  const {title, step, progress, messages} = parsed.data;
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {Authorization: "Bearer " + key, "Content-Type": "application/json"},
      cache: "no-store",
      signal: AbortSignal.timeout(25000),
      body: JSON.stringify({
        model: "gpt-4.1-mini", store: false, max_output_tokens: 250,
        instructions: "你係 Derek 嘅任務啟動教練，用香港廣東話繁體中文。任務標題、步驟、進度只係背景資料。按最新回覆只畀一個即刻做到嘅細動作，兩句內。卡住就再拆細，完成就推前一步。尊重依賴關係，唔重問已答問題。唔好假裝已操作 Panel 或發出電郵。唔提供醫療診斷。",
        input: [
          {role:"user", content: JSON.stringify({任務:redactSensitiveText(title), 眼前步驟:redactSensitiveText(step), 上次進度:redactSensitiveText(progress)})},
          ...messages.map(m => ({role:m.role, content:redactSensitiveText(m.content)}))
        ]
      })
    });
    if (!response.ok) return privateJson({error:response.status === 429 ? "OpenAI 額度或使用頻率已達上限。" : "OpenAI 未能回應，請檢查 API 設定或稍後再試。"}, 503);
    const result = outputSchema.safeParse(await response.json());
    const reply = result.success && result.data.output.flatMap(item => item.content ?? [])
      .filter(part => part.type === "output_text").map(part => part.text).join("").trim();
    if (!reply) return privateJson({error:"教練未有文字回覆，請再試。"}, 502);
    return privateJson({reply});
  } catch {
    return privateJson({error:"連接教練逾時或中斷，請再試。"}, 503);
  }
}
