import { NextRequest } from "next/server";
import { agentJson,agentOriginAllowed,readAgentBody } from "@/lib/server/agent-request";
import { schoolBotRPC,schoolCredential } from "@/lib/server/school-bot";
import { validSchoolProposal } from "@/lib/school-bot";
export const dynamic="force-dynamic";
export async function GET(request:NextRequest) {
  if (!agentOriginAllowed(request)) return agentJson({error:"來源不符。"},403);
  const hash=schoolCredential(request); if(!hash) return agentJson({error:"請用 bot Access Code 登入。"},401);
  const params=request.nextUrl.searchParams, offset=params.get("offset")??"0";
  if ([...params.keys()].some(k=>k!=="offset") || params.getAll("offset").length>1 || !/^\d{1,5}$/.test(offset)||Number(offset)>10000) return agentJson({error:"清單參數不正確。"},400);
  return schoolBotRPC(hash,"list",{offset:Number(offset)});
}
export async function POST(request:NextRequest) {
  const bearer=request.headers.has("authorization");
  if(!agentOriginAllowed(request,!bearer)||request.nextUrl.search) return agentJson({error:"來源或參數不符。"},403);
  const hash=schoolCredential(request); if(!hash) return agentJson({error:"請用 bot Access Code 登入。"},401);
  const data=await readAgentBody(request,4096); if(data instanceof Response) return data;
  if(!validSchoolProposal(data)) return agentJson({error:"請提交名稱或日期嘅建議；修改／刪除需附上剛讀到嘅版本。"},422);
  return schoolBotRPC(hash,"propose",data);
}
