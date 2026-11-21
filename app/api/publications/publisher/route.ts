import {randomBytes,createHash} from "node:crypto";
import {NextRequest} from "next/server";
import {activeStartReader} from "@/lib/server/start-reader";
import {privateJson} from "@/lib/server/request-context";
import {isSeries} from "@/lib/publications";
export const dynamic="force-dynamic";
export async function GET(req:NextRequest){const ctx=await activeStartReader(req);if(ctx instanceof Response)return ctx;const r=await ctx.client.rpc("dayline_sync_status");return r.error?privateJson({error:"未能核實接收狀態。"},503):privateJson({connections:r.data});}
export async function POST(req:NextRequest){if(req.headers.get("origin")!==req.nextUrl.origin||!req.headers.get("content-type")?.startsWith("application/json"))return privateJson({error:"請喺自己帳戶操作。"},403);
 const ctx=await activeStartReader(req);if(ctx instanceof Response)return ctx;
 const b=await req.json().catch(()=>null);if(!b||Object.keys(b).length!==2||!isSeries(b.series)||!["rotate","revoke"].includes(b.action))return privateJson({error:"請選擇刊物。"},422);
 const key=b.action==="rotate"?"dlpub_"+randomBytes(32).toString("hex"):null;
 const r=await ctx.client.rpc("dayline_publisher_key",{topic:b.series,digest_hex:key?createHash("sha256").update(key).digest("hex"):null});return r.error?privateJson({error:"未能更新接收授權。"},503):privateJson({key});
}
