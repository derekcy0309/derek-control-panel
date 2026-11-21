import { NextRequest } from "next/server";
import { authenticateRequest, privateJson } from "@/lib/server/request-context";
import { readCalendarBrief, readWorkStop } from "@/lib/server/calendar-brief";
import { readDashboardFamilyDates, readNextDashboardSchoolDate } from "@/lib/server/dashboard-family-dates";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=60;
export async function GET(request:NextRequest) {
 const guide=request.nextUrl.search==="?view=work-stop";
 if(request.nextUrl.search && !guide) return privateJson({error:"摘要不接受其他用戶或自訂日期參數。"},400);
 const ctx=await authenticateRequest(request);if(ctx instanceof Response)return ctx;
 const profile=await ctx.client.from("user_profiles").select("active").eq("user_id",ctx.user.id).maybeSingle();
 if(profile.error||!profile.data?.active)return privateJson({error:"帳戶未啟用。"},403);
 try {
  const now=new Date();
  if(guide)return privateJson(await readWorkStop(ctx.user.id,ctx.client,undefined,now));
  const [brief,family,nextSchool]=await Promise.all([readCalendarBrief(ctx.user.id,ctx.client,undefined,now,true),readDashboardFamilyDates(ctx.client,ctx.user.id,now).catch(()=>null),
    readNextDashboardSchoolDate(ctx.client,ctx.user.id,now).then(date=>({date,failed:false})).catch(()=>({date:null,failed:true}))]);
  return privateJson({...brief,familyDates:family?.dates??[],nextSchoolDate:nextSchool.date,nextSchoolWarning:nextSchool.failed||undefined,familyWarning:family===null?"學校／家庭日期暫時未能讀取，請按更新再試。":family.truncated?"學校／家庭日期未全部列出，請打開原清單。":undefined});
 }
 catch {return privateJson({error:"未能安全讀取三日安排。請重試；現有資料沒有改動。"},503);}
}
