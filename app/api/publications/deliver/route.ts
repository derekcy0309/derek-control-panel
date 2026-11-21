import {createClient} from "@supabase/supabase-js";
import {NextRequest} from "next/server";
import {privateJson} from "@/lib/server/request-context";
import {preparePublication} from "@/lib/server/publication-source";
export const dynamic="force-dynamic";
export const runtime="nodejs";
/** A series-specific write-only capability; never accept an owner ID or an app session here. */
export async function POST(req:NextRequest){
 const proof=(req.headers.get("authorization")||"").replace(/^Bearer /,"");
 if(!/^dlpub_[a-f0-9]{64}$/.test(proof)||req.nextUrl.search)return privateJson({error:"刊物授權無效。"},401);
 if(!req.headers.get("content-type")?.startsWith("application/json"))return privateJson({error:"只接受 JSON。"},415);
 const reader=req.body?.getReader();if(!reader)return privateJson({error:"缺少內容。"},400);
 const buffers:Uint8Array[]=[];let size=0;try{for(;;){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>550000){await reader.cancel();return privateJson({error:"超過刊物大小限制。"},413);}buffers.push(r.value);}}finally{reader.releaseLock();}
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;if(!url||!key)return privateJson({error:"接收服務暫時未能使用。"},503);
 let doc=null,outcome,previous;try{const b=JSON.parse(Buffer.concat(buffers).toString("utf8"));outcome=b.outcome;previous=b.previous??null;
 if(!["issue","no_issue","failed"].includes(outcome)||previous!==null&&!/^[0-9a-f]{64}$/.test(previous))throw Error();
 if(outcome==="issue"){doc=preparePublication(b.issue);if(doc.sourceKind!=="codex-scheduled")throw Error();}else if(b.issue)throw Error();
 }catch{return privateJson({error:"未能讀取完整刊物；沒有新增或改動。"},422);}
 const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
 const r=await client.rpc("dayline_deliver",{proof,payload:doc,previous,outcome});if(r.error)return privateJson({error:r.error.code==="40001"?"與現有版本不符，未覆寫。":"未能接收刊物。"},r.error.code==="42501"?403:r.error.code==="40001"?409:503);
 return privateJson({receipt:r.data,...(doc?{revision:doc.revision}:{})});
}
