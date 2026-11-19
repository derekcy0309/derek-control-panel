import { NextRequest } from "next/server";
import { agentJson,agentOriginAllowed,readAgentBody } from "@/lib/server/agent-request";
import { authenticateRequest } from "@/lib/server/request-context";
import { schoolId,schoolMode } from "@/lib/school-bot";
import { hasOnlyAgentFields } from "@/lib/agent-access";
import { schoolFailure } from "@/lib/server/school-bot";
import { newAgentKey } from "@/lib/server/agent-key";
export const dynamic="force-dynamic";
async function human(request:NextRequest) {
  if(!request.cookies.get("dcp_access")?.value || request.headers.has("authorization")) return agentJson({error:"請用本人帳戶登入 Panel。"},401);
  const ctx=await authenticateRequest(request); if(ctx instanceof Response) return ctx;
  const profile=await ctx.client.from("user_profiles").select("active,is_admin").eq("user_id",ctx.user.id).maybeSingle();
  if(profile.error) return schoolFailure(profile.error);
  return profile.data?.active && profile.data.is_admin ? ctx : agentJson({error:"只限本人管理自己嘅 bot。"},403);
}
export async function GET(request:NextRequest) {
  if(!agentOriginAllowed(request)||request.nextUrl.search) return agentJson({error:"來源或參數不符。"},400);
  const ctx=await human(request);if(ctx instanceof Response)return ctx;
  const now=new Date().toISOString();
  const [grants,scopes,pending]=await Promise.all([
    ctx.client.from("agent_access_grants").select("id,label").eq("owner_id",ctx.user.id).is("revoked_at",null).gt("expires_at",now).order("created_at").limit(30),
    ctx.client.from("agent_school_scopes").select("grant_id,mode").eq("owner_id",ctx.user.id),
    ctx.client.from("agent_school_proposals").select("id,grant_id,operation,before_fields,changes,expires_at").eq("owner_id",ctx.user.id).eq("status","pending").gt("expires_at",now).order("created_at").order("id").limit(21)
  ]);
  const e=grants.error??scopes.error??pending.error;if(e)return schoolFailure(e);
  const modes=new Map((scopes.data??[]).map(s=>[s.grant_id,s.mode]));
  return agentJson({grants:(grants.data??[]).map(g=>({...g,mode:modes.get(g.id)??"off"})),pending:(pending.data??[]).slice(0,20),more:(pending.data??[]).length>20});
}
export async function POST(request:NextRequest) {
  if(!agentOriginAllowed(request,true)||request.nextUrl.search)return agentJson({error:"請由本人嘅 Panel 頁面確認。"},403);
  const ctx=await human(request);if(ctx instanceof Response)return ctx;
  const data=await readAgentBody(request,1024);if(data instanceof Response)return data;
  if(data.action==="newCode"){
    if(!hasOnlyAgentFields(data,["action","label","mode"])||typeof data.label!=="string"||!data.label.trim()||[...data.label].length>50||(data.mode!=="omit"&&data.mode!=="redact"))return agentJson({error:"請填 bot 名稱，並選擇敏感事項點處理。"},422);
    const credential=newAgentKey();
    const result=await ctx.client.rpc("create_my_school_only_bot",{p_hash:credential.hash,p_label:data.label.trim(),p_days:30,p_mode:data.mode});
    return result.error?schoolFailure(result.error):agentJson({id:result.data,accessCode:credential.key},201);
  }
  if(!schoolId(data.id)||!hasOnlyAgentFields(data,data.action==="scope"?["action","id","mode"]:["action","id"])
    || !(data.action==="scope"?schoolMode(data.mode):data.action==="approve"||data.action==="reject")) return agentJson({error:"操作不正確。"},422);
  const result=await ctx.client.rpc("school_owner_decision",{p_action:data.action,p_id:data.id,p_mode:data.mode??null});
  return result.error?schoolFailure(result.error):agentJson({status:result.data});
}
