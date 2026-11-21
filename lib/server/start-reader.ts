import {NextRequest} from "next/server";
import {authenticateRequest,privateJson} from "./request-context";
export async function activeStartReader(req:NextRequest){
  const ctx=await authenticateRequest(req);if(ctx instanceof Response)return ctx;
  const result=await ctx.client.from("user_profiles").select("active").eq("user_id",ctx.user.id).maybeSingle();
  if(result.error)return privateJson({error:"暫時未能確認帳戶，請重試。"},503);
  if(!result.data?.active)return privateJson({error:"帳戶未啟用。"},403);
  return ctx;
}
