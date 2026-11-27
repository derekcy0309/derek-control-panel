// Actual authenticated Next route + SDK against a loopback fixture. No live credentials or data.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import http from "node:http";
import { registerHooks } from "node:module";

const base=new URL("../../",import.meta.url);
registerHooks({resolve(spec,ctx,next) {
  if(spec==="next/server") return next("next/server.js",ctx);
  if(spec.startsWith("@/")) return {url:new URL(spec.slice(2)+".ts",base).href,shortCircuit:true};
  if(ctx.parentURL?.startsWith(base.href)&&spec.startsWith(".")&&!/\.\w+$/.test(spec)) return {url:new URL(spec+".ts",ctx.parentURL).href,shortCircuit:true};
  return next(spec,ctx);
}});
const {NextRequest}=await import("next/server.js");
const {POST}=await import("../../app/api/agent-access/route.ts");
const owner="ab200000-0000-4000-8000-000000000001",other=owner.replace(/1$/,"2");
const target="ab200000-0000-4000-8000-000000000003",unrelated=target.replace(/3$/,"4"),session=target.replace(/3$/,"5");
const stamp="2026-12-14T07:26:08.468239+00:00";
const origin="http://dayline.test";
const ids=new Map();
const jwt=(id,offset,method="oauth")=>{
  const claims=Buffer.from(JSON.stringify({sub:id,role:"authenticated",session_id:session,iat:Math.floor(Date.now()/1000),
    amr:[{method,timestamp:Math.floor(Date.now()/1000)+offset}]})).toString("base64url");
  const token="fixture."+claims+".signature";
  ids.set(token,id);return token;
};
const valid=jwt(owner,0),stale=jwt(owner,-601),refreshed=jwt(owner,0,"token_refresh"),different=jwt(other,0);
let mutations=0,args,lastFailure;
const server=http.createServer(async(req,res)=>{
  const out=(body,code=200)=>{res.writeHead(code,{"content-type":"application/json"});res.end(JSON.stringify(body));};
  try {
    const id=ids.get(req.headers.authorization?.slice(7)),path=new URL(req.url,origin).pathname;
    if(path==="/auth/v1/user"){
      if(!id)return out({message:"Unauthenticated"},401);
      return out({id,email:id===owner?"derekcy0309@gmail.com":"different@example.test",email_confirmed_at:"2026-01-01T00:00:00Z",aud:"authenticated",is_anonymous:false,user_metadata:{},app_metadata:{}});
    }
    if(path.endsWith("/touch_current_user_last_seen"))return out(null);
    if(path.endsWith("/user_profiles"))return out([{active:true,is_admin:true}]);
    assert.equal(path,"/rest/v1/rpc/rotate_owner_workspace_brief_code");
    assert.equal(req.headers.authorization,"Bearer local-service-only");
    let input="";for await(const chunk of req)input+=chunk;
    const fields=JSON.parse(input);
    assert.equal(fields.p_owner_id,owner);assert.equal(fields.p_session_id,session);
    assert.match(fields.p_token_hash,/^[a-f0-9]{64}$/);
    if(fields.p_grant_id!==target||fields.p_expected_expires_at!==stamp||mutations) return out({message:"AGENT_ROTATE_CONFLICT"},400);
    args=fields;mutations++;
    return out({id:target,label:"Grok Bot（本人工作）",owner_workspace:true,expires_at:"2027-11-27T07:26:08.468239+00:00",code_rotated_at:"2026-11-27T07:26:08.468239+00:00"});
  } catch(error) {lastFailure=error;out({message:"fixture failure"},500);}
});
await new Promise(r=>server.listen(0,"127.0.0.1",r));
process.env.NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:"+server.address().port;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY="local-anon-only";
process.env.SUPABASE_SERVICE_ROLE_KEY="local-service-only";
function post(fields={},token=valid,options={}){
  const headers={origin,"content-type":"application/json",...options};
  if(token)headers.cookie="dcp_access="+token;
  return POST(new NextRequest(origin+"/api/agent-access",{method:"POST",headers,body:JSON.stringify({
    action:"rotate_brief_workspace",id:target,acknowledged:true,expectedExpiresAt:stamp,...fields
  })}));
}
try{
  assert.equal((await post({},null)).status,401);
  assert.equal((await post({},different)).status,403);
  assert.equal((await post({},null,{authorization:"Bearer "+valid})).status,403);
  assert.equal((await post({},valid,{origin:"https://another.example.test"})).status,403);
  assert.equal((await post({acknowledged:false})).status,422);
  assert.equal((await post({owner_id:other})).status,422);
  assert.equal((await post({expectedExpiresAt:"2026-12-14"})).status,422);
  for(const token of [stale,refreshed]) {
    const result=await post({},token);assert.equal(result.status,401);assert.equal((await result.json()).reauth,true);
  }
  assert.equal((await post({id:unrelated})).status,409);
  assert.equal(mutations,0);
  const [a,b]=await Promise.all([post(),post()]);
  const issued=[a,b].find(result=>result.status===201),conflict=[a,b].find(result=>result.status===409);
  assert.ok(issued&&conflict,lastFailure?.message);
  assert.match(issued.headers.get("cache-control"),/no-store/);
  const oneTime=await issued.json(),denied=await conflict.json();
  assert.equal(oneTime.loginPath,"/agent/brief");assert.equal(oneTime.grant.id,target);
  assert.match(oneTime.accessCode,/^dcp_grok_[a-zA-Z0-9_-]{43}$/);
  assert.equal(createHash("sha256").update(oneTime.accessCode).digest("hex"),args.p_token_hash);
  assert.equal(args.p_expected_expires_at,stamp);
  assert.ok(!Object.hasOwn(denied,"accessCode"));assert.equal(mutations,1);
  assert.equal(lastFailure,undefined);
  console.log("PASS rotation API: verified recent owner cookie, exact target, consent, microsecond revision, conflict and one-time no-store response.");
} finally {await new Promise(r=>server.close(r));}
