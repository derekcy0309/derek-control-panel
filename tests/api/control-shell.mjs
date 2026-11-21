import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";

const base = "http://localhost:3152";
const shell = base + "/api/control?view=shell";
const warmOwner = "75111111-1111-4111-8111-111111111111";
const coldOwner = "75111111-1111-4111-8111-111111111112";
const profileSelect = "display_name,active,is_admin,must_change_password";
const settingsSelect = "theme,visual_intensity,accent_colour,dashboard_density,pinned_pages";
const reads = [], inserts = [], faults = [];
let createdProfile = false, racedSettings = false, lastSeen = 0, logs = "";

const profile = {display_name:"Fixture",active:true,is_admin:true,must_change_password:true,avatar_url:"private-fixture"};
const settings = {theme:"dark",visual_intensity:"quiet",accent_colour:"teal",dashboard_density:"compact",pinned_pages:["/cashflow"],email:"private-fixture"};
const tokens = new Map([
  ["warm", {id:warmOwner,email:"warm@example.test",app_metadata:{show_encouragement:true}}],
  ["cold", {id:coldOwner,email:"cold@example.test",user_metadata:{display_name:"suki"}}]
]);

const backend = http.createServer(async (req,res) => {
  let payload = null, status = 200;
  try {
    const user = tokens.get(req.headers.authorization?.replace(/^Bearer /,""));
    const url = new URL(req.url, "http://fixture");
    if (url.pathname === "/auth/v1/user") {
      if (!user) {status=401;payload={message:"not a user JWT"};}
      else payload={aud:"authenticated",role:"authenticated",...user};
    } else {
      assert.ok(user,"Only user JWTs may read shell rows");
      assert.equal(req.headers.apikey,"local-shell-anon");
      if (url.pathname === "/rest/v1/rpc/touch_current_user_last_seen") {
        assert.equal(req.method,"POST");
        lastSeen++;
      } else {
        const profileTable=url.pathname==="/rest/v1/user_profiles";
        assert.ok(profileTable||url.pathname==="/rest/v1/user_settings","No ordinary private dashboard collection may load for the shell");
        assert.equal(url.searchParams.get("select"),profileTable?profileSelect:settingsSelect);
        const cold = user.id===coldOwner;
        if (req.method==="GET") {
          assert.equal(url.searchParams.get("user_id"),"eq."+user.id);
          reads.push([user.id,url.pathname]);
          if (!cold) payload=[profileTable?profile:settings];
          else if (profileTable) payload=createdProfile?[{...profile,display_name:"Suki",is_admin:false,must_change_password:false}]:[];
          else payload=racedSettings?[{...settings,theme:"light",pinned_pages:["/calendar"],dashboard_density:"calm"}]:[];
        } else {
          assert.equal(req.method,"POST");
          assert.ok(cold,"Do not rewrite an already-provisioned account");
          let raw="";for await (const chunk of req) raw+=chunk;
          const data=JSON.parse(raw);
          inserts.push(url.pathname);
          if (profileTable) {
            assert.deepEqual(data,{display_name:"Suki",user_id:coldOwner});
            createdProfile=true;
            payload={...profile,display_name:"Suki",is_admin:false,must_change_password:false};
          } else {
            assert.deepEqual(data,{email:"cold@example.test",gentle_mode:true,dashboard_density:"calm",support_profile:"depression",user_id:coldOwner});
            racedSettings=true;
            status=409;payload={code:"23505",message:"another bootstrap inserted this owner"};
          }
        }
      }
    }
  } catch (error) {
    faults.push(error.message);
    status=500;payload={message:"unexpected shell API fixture request"};
  }
  res.writeHead(status,{"Content-Type":"application/json"});res.end(JSON.stringify(payload));
});

await new Promise((resolve,reject)=>backend.listen(0,"127.0.0.1",resolve).once("error",reject));
const next=spawn(process.execPath,["node_modules/next/dist/bin/next","dev","--hostname","127.0.0.1","--port","3152"],{
  env:{...process.env,NEXT_PUBLIC_SUPABASE_URL:"http://127.0.0.1:"+backend.address().port,NEXT_PUBLIC_SUPABASE_ANON_KEY:"local-shell-anon",NEXT_TELEMETRY_DISABLED:"1"},
  stdio:["ignore","pipe","pipe"]
});
for(const stream of [next.stdout,next.stderr]) stream.on("data",c=>{logs+=c;});
const query=(token,suffix="")=>fetch(shell+suffix,{headers:token?{Cookie:"dcp_access="+token}:{}});

try {
  let anon;
  for (let i=0;i<100;i++) {
    if (next.exitCode!==null) throw Error("Fixture Next server exited before validation");
    try {anon=await query(); if(anon.status===401) break;} catch {}
    await new Promise(resolve=>setTimeout(resolve,350));
  }
  assert.equal(anon?.status,401);
  assert.match(anon.headers.get("cache-control"),/private, no-store/);
  assert.equal((await query("warm","&user_id="+coldOwner)).status,400);
  assert.equal(reads.length,0);
  const existing=await query("warm");
  assert.equal(existing.status,200);
  assert.match(existing.headers.get("cache-control"),/private, no-store/);
  const brief=await existing.json();
  assert.deepEqual(brief,{
    currentUser:{id:warmOwner,displayName:"Fixture"},
    profile:{active:true,is_admin:true,must_change_password:true},
    settings:{theme:"dark",visual_intensity:"quiet",accent_colour:"teal",dashboard_density:"compact",pinned_pages:["/cashflow"]},
    showEncouragement:true
  });
  assert.deepEqual(reads.map(r=>r[1]).sort(),["/rest/v1/user_profiles","/rest/v1/user_settings"]);
  assert.deepEqual(inserts,[]);
  assert.equal(lastSeen,2);
  const firstLogin=await query("cold");
  assert.equal(firstLogin.status,200);
  assert.deepEqual((await firstLogin.json()).settings.pinned_pages,["/calendar"],"Concurrent creation must not overwrite saved preferences");
  assert.deepEqual(inserts.sort(),["/rest/v1/user_profiles","/rest/v1/user_settings"]);
  assert.equal(reads.filter(([id])=>id===coldOwner).length,3,"A duplicate insert only re-reads the affected row");
  assert.deepEqual(faults,[]);
  console.log("PASS actual shell handler: two private own-row reads, no dashboard queries or excess response fields, valid auth flags and pins, cold init and concurrent preferences retained");
} catch(error) {
  throw new Error(error.message+"\n"+logs.slice(-2600),{cause:error});
} finally {
  next.kill();
  await new Promise(resolve=>backend.close(resolve));
}
