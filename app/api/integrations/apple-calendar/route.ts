import { NextRequest } from "next/server";
import { authenticateRequest, privateJson } from "@/lib/server/request-context";
import { agentOriginAllowed, readAgentBody } from "@/lib/server/agent-request";
import { hasOnlyAgentFields, agentUuidPattern } from "@/lib/agent-access";
import { appleMetadata, calendarService, refreshApple } from "@/lib/server/calendar-brief";
import { discoverAppleCalendars } from "@/lib/integrations/apple-calendar";
import { encryptCalendarToken } from "@/lib/integrations/google-calendar";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=60;
export async function GET(request:NextRequest) {
 const ctx=await authenticateRequest(request);if(ctx instanceof Response)return ctx;
 try {
  const [apple,grants,permissions]=await Promise.all([appleMetadata(ctx.user.id),ctx.client.from("agent_access_grants").select("id,label,expires_at,revoked_at").eq("owner_id",ctx.user.id).is("revoked_at",null).gt("expires_at",new Date().toISOString()).neq("create_tag_ids","{}").order("created_at",{ascending:false}).limit(5),ctx.client.from("agent_brief_permissions").select("grant_id,revoked_at").eq("owner_id",ctx.user.id)]);
  if(grants.error||permissions.error)throw new Error("DB");
  return privateJson({apple,grants:grants.data??[],permissions:permissions.data??[]});
 }catch{return privateJson({error:"未能讀取私人 Calendar 設定，請重試。"},503);}
}
export async function POST(request:NextRequest) {
 if(!agentOriginAllowed(request,true))return privateJson({error:"請由 Panel 設定頁操作。"},403);
 const ctx=await authenticateRequest(request);if(ctx instanceof Response)return ctx;
 const profile=await ctx.client.from("user_profiles").select("active").eq("user_id",ctx.user.id).maybeSingle();
 if(profile.error||!profile.data?.active)return privateJson({error:"帳戶未啟用。"},403);
 const body=await readAgentBody(request,4096);if(body instanceof Response)return body;
 if(body.action==="enable_brief") {
  if(!hasOnlyAgentFields(body,["action","grantId","acknowledged"])||body.acknowledged!==true||typeof body.grantId!=="string"||!agentUuidPattern.test(body.grantId))return privateJson({error:"請先確認本人行程及現有／日後 Task 的讀取授權。"},422);
  const result=await ctx.client.rpc("enable_my_agent_brief",{p_grant_id:body.grantId});
  return result.error?privateJson({error:"未能開放此連接；請檢查本人管理員及連接狀態。"},403):privateJson({ok:true});
 }
 const service=calendarService();
 try {
  if(body.action==="connect") {
   if(!hasOnlyAgentFields(body,["action","email","password","acknowledged"])||body.acknowledged!==true||typeof body.email!=="string"||!/^\S+@\S+\.\S+$/.test(body.email.trim())||body.email.length>254||typeof body.password!=="string"||!/^[A-Za-z]{4}(?:-[A-Za-z]{4}){3}$/.test(body.password.trim()))return privateJson({error:"請填 Apple Account 電郵及 App 專用密碼（xxxx-xxxx-xxxx-xxxx），不要填主密碼。"},422);
   const email=body.email.trim().toLowerCase(),calendars=await discoverAppleCalendars(email,body.password.trim());
   const saved=await service.from("apple_calendar_connections").upsert({owner_id:ctx.user.id,account_email:email,secret_ciphertext:encryptCalendarToken("apple-calendar:v1:"+body.password.trim()),calendars,selected_ids:[],status:"select_calendars",error_code:null,last_attempt_at:null,updated_at:new Date().toISOString()},{onConflict:"owner_id"}).select("id").single();
   if(saved.error)throw new Error("DB");
   const removed=await service.from("private_calendar_snapshots").delete().eq("owner_id",ctx.user.id).eq("source_key",saved.data.id);if(removed.error)throw new Error("DB");
   await service.from("activity_logs").insert({resource_type:"apple_calendar_connection",resource_id:saved.data.id,actor_id:ctx.user.id,action:"connected",summary:"本人私人 Calendar 已連接（唯讀）"});
   return privateJson({apple:await appleMetadata(ctx.user.id,service)});
  }
  const connection=await service.from("apple_calendar_connections").select("id,calendars,selected_ids,last_attempt_at").eq("owner_id",ctx.user.id).maybeSingle();
  if(connection.error||!connection.data)return privateJson({error:"請先連接 Apple Calendar。"},404);
  const c=connection.data;
  if(body.action==="select") {
   if(!hasOnlyAgentFields(body,["action","calendarIds"])||!Array.isArray(body.calendarIds)||body.calendarIds.length<1||body.calendarIds.length>10||body.calendarIds.some(id=>typeof id!=="string"||!(c.calendars as {id:string}[]).some(x=>x.id===id)))return privateJson({error:"請揀 1 至 10 個已連接的 Calendar。"},422);
   const update=await service.from("apple_calendar_connections").update({selected_ids:[...new Set(body.calendarIds)],status:"connected",last_attempt_at:null,updated_at:new Date().toISOString()}).eq("owner_id",ctx.user.id).eq("id",c.id);if(update.error)throw new Error("DB");
   await service.from("private_calendar_snapshots").delete().eq("owner_id",ctx.user.id).eq("source_key",c.id);
   const synced=await refreshApple(ctx.user.id,true,service);
   return privateJson({apple:await appleMetadata(ctx.user.id,service),sync:synced.source});
  }
  if(body.action==="refresh"&&hasOnlyAgentFields(body,["action"])) {
   if(c.last_attempt_at&&Date.now()-Date.parse(c.last_attempt_at)<30000)return privateJson({error:"剛更新過，請等 30 秒再試。"},429);
   const synced=await refreshApple(ctx.user.id,true,service);return privateJson({apple:await appleMetadata(ctx.user.id,service),sync:synced.source});
  }
  if(body.action==="disconnect"&&hasOnlyAgentFields(body,["action"])) {
   const update=await service.from("apple_calendar_connections").update({status:"disconnected",secret_ciphertext:"",selected_ids:[],calendars:[],updated_at:new Date().toISOString()}).eq("owner_id",ctx.user.id).eq("id",c.id);if(update.error)throw new Error("DB");
   await service.from("private_calendar_snapshots").delete().eq("owner_id",ctx.user.id).eq("source_key",c.id);
   return privateJson({apple:await appleMetadata(ctx.user.id,service)});
  }
  return privateJson({error:"不支援此操作；Panel 不提供修改或刪除 Apple 行程。"},400);
 }catch{return privateJson({error:"Apple Calendar 未能完成連接／更新。請檢查 App 專用密碼及網絡後重試；不會更改 iPhone 行程。"},502);}
}
