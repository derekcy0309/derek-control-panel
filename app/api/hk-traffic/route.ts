import {roadReport} from "@/lib/server/road-feeds";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=15;
export async function GET(req:Request){
 const q=new URL(req.url).searchParams,vehicle=q.get("vehicle")??"PC";if((vehicle!=="PC"&&vehicle!=="MC")||[...q.keys()].some(x=>x!=="vehicle")||q.getAll("vehicle").length>1)return Response.json({error:"只支援私家車或電單車。"},{status:400,headers:{"Cache-Control":"no-store"}});
 const v=await roadReport(vehicle);const ok=!!(v.roads?.length||v.spots?.length||v.notices!==null||v.tolls.length);
 const seconds=Math.min(15,59-new Date(v.at).getUTCSeconds());return Response.json(v,{status:ok?200:503,headers:{"Cache-Control":ok?"public, max-age=0, s-maxage="+seconds+", must-revalidate":"no-store","X-Content-Type-Options":"nosniff"}});
}
