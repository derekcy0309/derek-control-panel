// Exercise actual Next.js handlers against a local Supabase HTTP fixture.
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
// NextURL normalizes loopback hosts to localhost; use the same origin a browser
// uses, rather than weakening the application's Origin check for 127.0.0.1.
const base='http://localhost:3146',key='dcp_grok_'+'x'.repeat(43),hash=createHash('sha256').update(key).digest('hex');
let operations=0,revoked=false,logs='',schoolOpen=false,schoolApplies=0,pinSaves=0;
const fixtureOwner='11111111-1111-4111-8111-111111111111',proposalId='55555555-5555-4555-8555-555555555555';
const backend=http.createServer(async(req,res)=>{
  let result={},status=200;
  if(req.url==='/rest/v1/rpc/agent_access_operation'){
    let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw);operations++;
    assert.equal(req.headers.authorization,'Bearer fixture-service');assert.equal(body.p_token_hash,hash);assert.equal(raw.includes(key),false);
    if(revoked){status=400;result={message:'AGENT_UNAUTHORIZED',code:'P0001'};}
    else if(body.p_action==='status')result={id:'11111111-1111-4111-8111-111111111111',label:'Grok Bot',expiresAt:new Date(Date.now()+30*86400000).toISOString(),tags:[],permissions:{read:true,create:true,update:false,delete:false}};
    else if(body.p_action==='create_note')result={id:'22222222-2222-4222-8222-222222222222',kind:'note',duplicate:false};
    else result={items:[],nextOffset:null};
  }else if(req.url==='/rest/v1/rpc/school_bot_request'){
    let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw);
    assert.equal(req.headers.authorization,'Bearer fixture-service');assert.equal(body.p_token_hash,hash);
    if(!schoolOpen && body.p_action!=='brief'){status=400;result={message:'SCHOOL_OFF'};}
    else if(body.p_action==='propose'){assert.equal(body.p_data.operation,'create');status=200;result={proposalId,status:'pending',duplicate:false};}
    else result=schoolOpen?{enabled:true,items:[{title:'學校事項',date:'2026-11-19'}],more:false}:{enabled:false};
  }else if(req.url==='/rest/v1/rpc/school_owner_decision'){
    assert.equal(req.headers.authorization,'Bearer human-session');let raw='';for await(const part of req)raw+=part;
    const body=JSON.parse(raw);assert.equal(body.p_action,'approve');assert.equal(body.p_id,proposalId);schoolApplies++;result='approved';
  }else if(req.url==='/rest/v1/rpc/touch_current_user_last_seen')result=null;
  else if(req.url?.startsWith('/rest/v1/user_profiles?')){assert.equal(req.headers.authorization,'Bearer human-session');result=[{is_admin:true,active:true}];}
  else if(req.url?.startsWith('/rest/v1/user_settings?')){
    assert.equal(req.method,'PATCH');assert.equal(req.headers.authorization,'Bearer human-session');
    assert.equal(new URL(req.url,'http://fixture').searchParams.get('user_id'),'eq.'+fixtureOwner);
    let raw='';for await(const part of req)raw+=part;
    result=JSON.parse(raw);
    assert.deepEqual(result,{pinned_pages:['/calendar','/cashflow']});
    pinSaves++;
  }
  else if(req.url==='/rest/v1/rpc/agent_brief_owner'){
    let raw='';for await(const part of req)raw+=part;assert.equal(JSON.parse(raw).p_token_hash,hash);assert.equal(raw.includes(key),false);result='11111111-1111-4111-8111-111111111111';
  }else if(req.url?.startsWith('/rest/v1/tasks?')){
    const url=new URL(req.url,'http://fixture');assert.equal(url.searchParams.get('owner_id'),'eq.11111111-1111-4111-8111-111111111111');const due=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Hong_Kong'}).format(new Date());result=[{id:'44444444-4444-4444-8444-444444444444',title:'Own deadline',due_date:due,requested_priority:1,status:'not_started'}];
  }else if(req.url?.startsWith('/rest/v1/operating_items?')||req.url?.startsWith('/rest/v1/apple_calendar_connections?')){const url=new URL(req.url,'http://fixture');assert.equal(url.searchParams.get('owner_id'),'eq.11111111-1111-4111-8111-111111111111');result=[];
  }else if(req.url==='/auth/v1/user'){if(req.headers.authorization==='Bearer human-session')result={id:fixtureOwner,aud:'authenticated',role:'authenticated'};else{status=401;result={message:'not a user JWT'};}}
  else{status=404;result={message:'unexpected fixture endpoint'};}
  res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(result));
});
await new Promise(r=>backend.listen(4173,'127.0.0.1',r));
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--hostname','127.0.0.1','-p','3146'],{env:{...process.env,NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:4173',NEXT_PUBLIC_SUPABASE_ANON_KEY:'fixture-anon',SUPABASE_SERVICE_ROLE_KEY:'fixture-service',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']});
server.stdout.on('data',v=>{logs+=v;});server.stderr.on('data',v=>{logs+=v;});
const request=(path,init={})=>fetch(base+path,{...init,headers:{Authorization:`Bearer ${key}`,...init.headers}});
try{
  for(let i=0;i<100;i++){if(server.exitCode!==null)throw new Error(logs.slice(-1500));try{if((await fetch(base+'/api/agent')).status===401)break;}catch{}await new Promise(r=>setTimeout(r,400));}
  const status=await request('/api/agent');assert.equal(status.status,200);assert.match(status.headers.get('cache-control'),/private, no-store/);assert.equal((await status.json()).permissions.delete,false);
  const login=await request('/api/agent/session',{method:'POST',headers:{Origin:base,'Content-Type':'application/json',Cookie:'dcp_access=old-human; dcp_refresh=old-refresh'},body:JSON.stringify({key})});assert.equal(login.status,200);
  const cookies=login.headers.getSetCookie().join(';');assert.match(cookies,/dcp_agent=/);assert.match(cookies,/HttpOnly/i);assert.match(cookies,/SameSite=strict/i);assert.match(cookies,/dcp_refresh=;[^;]*Max-Age=0|dcp_refresh=;[\s\S]*Max-Age=0/i);
  const before=operations;
  for(const method of ['DELETE','PATCH','PUT'])assert.equal((await request('/api/agent',{method})).status,403);
  assert.equal((await request('/api/agent?view=delete')).status,403);assert.equal((await request('/api/agent?key=not-allowed')).status,400);assert.equal(operations,before);
  const note={kind:'note',requestId:'33333333-3333-4333-8333-333333333333',title:'Fixture',description:'Not production'};
  const create=await request('/api/agent',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify(note)});assert.equal(create.status,201);
  const bad=await request('/api/agent',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({...note,ownerId:'forged'})});assert.equal(bad.status,422);
  assert.equal((await request('/api/agent/session',{method:'POST',headers:{Origin:'https://untrusted.example','Content-Type':'application/json'},body:JSON.stringify({key})})).status,403);
  assert.equal((await request('/api/control?view=bootstrap')).status,401);assert.equal((await request('/api/backup')).status,401);
  const brief=await request('/api/agent/brief');assert.equal(brief.status,200);const report=await brief.json();assert.match(report.text,/Own deadline/);assert.match(report.text,/Apple Calendar未連接/);assert.equal(report.days.length,3);assert.equal((await request('/api/agent/brief?owner_id=forged')).status,400);
  assert.equal(report.familyDates,undefined);assert.equal(report.familyWarning,undefined);
  assert.doesNotMatch(report.text,/學校 Deadline/);assert.equal((await request('/api/agent/school')).status,403);
  schoolOpen=true;assert.match((await(await request('/api/agent/brief')).json()).text,/學校 Deadline/);
  assert.equal((await request('/api/agent/school')).status,200);
  const json={'Content-Type':'application/json'}, suggestion={operation:'create',requestId:proposalId,changes:{title:'Fixture only'}};
  assert.equal((await request('/api/agent/school',{method:'POST',headers:json,body:JSON.stringify(suggestion)})).status,202);
  assert.equal((await request('/api/agent/school',{method:'POST',headers:json,body:JSON.stringify({...suggestion,owner_id:fixtureOwner})})).status,422);
  assert.equal((await request('/api/agent/school',{method:'DELETE'})).status,405);
  assert.equal((await request('/api/school-bot-review')).status,401);assert.equal(schoolApplies,0);
  const sendDecision=(origin,headers={})=>fetch(base+'/api/school-bot-review',{method:'POST',headers:{...json,Origin:origin,Cookie:'dcp_access=human-session',...headers},body:JSON.stringify({action:'approve',id:proposalId})});
  assert.equal((await sendDecision('https://example.test')).status,403);
  assert.equal((await sendDecision(base,{Authorization:'Bearer '+key})).status,401);
  assert.equal((await sendDecision(base)).status,200);assert.equal(schoolApplies,1);
  assert.equal((await fetch(base+'/api/calendar-brief')).status,401);assert.equal((await request('/api/calendar-brief?owner_id=forged')).status,400);
  const monthly='/api/apple-calendar-month?month=2026-12';
  assert.equal((await fetch(base+monthly)).status,401,'anonymous month access');
  assert.equal((await request(monthly)).status,401,'Grok cannot access monthly Apple events');
  const human={Cookie:'dcp_access=human-session'};
  for(const suffix of ['&owner_id='+fixtureOwner,'&month=2026-12','&until=2027-12-01']) {
    assert.equal((await fetch(base+monthly+suffix,{headers:human})).status,400,'only a single month is accepted');
  }
  const ownMonth=await fetch(base+monthly,{headers:human});
  assert.equal(ownMonth.status,200);
  assert.match(ownMonth.headers.get('cache-control'),/private, no-store/);
  const calendar=await ownMonth.json();
  assert.equal(calendar.month,'2026-12');assert.equal(calendar.source.state,'not_connected');assert.deepEqual(calendar.events,[]);
  const savePins=(pins)=>fetch(base+'/api/control',{method:'POST',headers:{...human,'Content-Type':'application/json'},body:JSON.stringify({action:'save_settings',settings:{pinned_pages:pins}})});
  for(const pins of [['/admin/accounts'],['https://example.test'],['/calendar','/calendar']])assert.equal((await savePins(pins)).status,422);
  assert.equal(pinSaves,0);
  const pins=await savePins(['/calendar','/cashflow']);
  assert.equal(pins.status,200);assert.match(pins.headers.get('cache-control'),/private, no-store/);
  assert.deepEqual((await pins.json()).settings.pinned_pages,['/calendar','/cashflow']);assert.equal(pinSaves,1);
  revoked=true;assert.equal((await request('/api/agent')).status,401);
  console.log('PASS actual Grok API: hashed credential only, isolated cookie, read/create, no mutations, no normal user/backup access, CSRF and revocation');
  console.log('PASS actual month and pin APIs: human account-scoped read/write isolation, bounded query inputs, owner-filtered settings and no public cache');
}catch(error){throw new Error(`${error.message}\n${logs.slice(-1800)}`,{cause:error});}
finally{server.kill();await new Promise(r=>backend.close(r));}
