import { NextRequest } from "next/server";
import { authenticateRequest, privateJson } from "@/lib/server/request-context";
import { readCalendarBrief } from "@/lib/server/calendar-brief";
import { readDashboardFamilyDates } from "@/lib/server/dashboard-family-dates";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=60;
export async function GET(request:NextRequest) {
 if(request.nextUrl.search) return privateJson({error:"摘要不接受其他用戶或自訂日期參數。"},400);
 const ctx=await authenticateRequest(request);if(ctx instanceof Response)return ctx;
 const profile=await ctx.client.from("user_profiles").select("active").eq("user_id",ctx.user.id).maybeSingle();
 if(profile.error||!profile.data?.active)return privateJson({error:"帳戶未啟用。"},403);
 try {
  const now=new Date();
  const [brief,family]=await Promise.all([readCalendarBrief(ctx.user.id,ctx.client,undefined,now),readDashboardFamilyDates(ctx.client,ctx.user.id,now).catch(()=>null)]);
  return privateJson({...brief,familyDates:family?.dates??[],familyWarning:family===null?"學校／家庭日期暫時未能讀取，請按更新再試。":family.truncated?"學校／家庭日期未全部列出，請打開原清單。":undefined});
 }
 catch {return privateJson({error:"未能安全讀取三日安排。請重試；現有資料沒有改動。"},503);}
}
