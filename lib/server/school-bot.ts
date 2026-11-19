import type { NextRequest } from "next/server";
import { agentCookie, hashAgentKey } from "@/lib/server/agent-key";
import { agentJson } from "@/lib/server/agent-request";
import { calendarService } from "@/lib/server/calendar-brief";

export function schoolCredential(request: NextRequest) {
  const auth = request.headers.get("authorization");
  return hashAgentKey(auth ? (auth.startsWith("Bearer ")?auth.slice(7):null) : request.cookies.get(agentCookie)?.value);
}
export function schoolFailure(error: { message?: string }) {
  const msg=error.message ?? "";
  const reasons: [string,number,string][]=[
    ["SCHOOL_REAUTH",401,"請先用本人帳戶重新登入，再返嚟確認。"],
    ["SCHOOL_AUTH",401,"請先用有效嘅 bot Access Code 登入。"],
    ["SCHOOL_OFF",403,"呢個授權未開啟、已到期或已停用。"],
    ["SCHOOL_OWNER",403,"只限擁有呢個授權嘅本人使用。"],
    ["SCHOOL_CONFLICT",409,"記錄或授權已變，未有套用。請重新載入，再提交新建議。"],
    ["SCHOOL_MISSING",404,"呢項資料未開放或已不存在。"],
    ["SCHOOL_RATE",429,"請稍後再試，未有變更學校記錄。"],
    ["SCHOOL_GRANT_LIMIT",409,"目前最多可用五個 Access Code。請先停用一個用唔著嘅連接。"],
    ["SCHOOL_INVALID",422,"請檢查建議操作、名稱及日期。"]
  ];
  const hit=reasons.find(([tag])=>msg.includes(tag));
  return hit ? agentJson({error:hit[2],reauth:hit[0]==="SCHOOL_REAUTH"},hit[1]) : agentJson({error:"暫時未能核對資料。請重新載入，唔好當作已成功。"},503);
}
export async function schoolBotRPC(hash:string, action:"list"|"propose", data:Record<string,unknown>) {
  try {
    const result=await calendarService().rpc("school_bot_request",{p_token_hash:hash,p_action:action,p_data:data});
    return result.error ? schoolFailure(result.error) : agentJson(result.data,action==="propose"?202:200);
  } catch {return agentJson({error:"連線未完成。重試同一建議請沿用相同 requestId。"},503);}
}
