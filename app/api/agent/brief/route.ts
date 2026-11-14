import { NextRequest } from "next/server";
import { agentCookie, hashAgentKey } from "@/lib/server/agent-key";
import { agentDatabaseError, agentJson, agentOriginAllowed } from "@/lib/server/agent-request";
import { calendarService, readCalendarBrief } from "@/lib/server/calendar-brief";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=60;
export async function GET(request:NextRequest) {
 if(request.nextUrl.search||!agentOriginAllowed(request))return agentJson({error:"此摘要不接受額外參數。"},400);
 const auth=request.headers.get("authorization")??"",hash=hashAgentKey(auth.startsWith("Bearer ")?auth.slice(7):request.cookies.get(agentCookie)?.value);
 if(!hash)return agentJson({error:"請先登入 Grok 工作區。"},401);
 try {
  const service=calendarService(),owner=await service.rpc("agent_brief_owner",{p_token_hash:hash});
  if(owner.error)return agentDatabaseError(owner.error);
  if(typeof owner.data!=="string")return agentJson({error:"未有每日摘要授權。"},403);
  const brief=await readCalendarBrief(owner.data,service,service);
  // No credentials, owner identifier, Notes or underlying backlog returned.
  return agentJson(brief);
 }catch{return agentJson({error:"未能讀取最新摘要，請稍後重試；不要以舊報告當作最新。"},503);}
}
