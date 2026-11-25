// Exercise actual Next.js handlers against a local Supabase HTTP fixture.
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
// NextURL normalizes loopback hosts to localhost; use the same origin a browser
// uses, rather than weakening the application's Origin check for 127.0.0.1.
const base='http://localhost:3146',key='dcp_grok_'+'x'.repeat(43),hash=createHash('sha256').update(key).digest('hex');
const workspaceKey='dcp_grok_'+'y'.repeat(43),workspaceHash=createHash('sha256').update(workspaceKey).digest('hex');
let operations=0,revoked=false,logs='',schoolOpen=false,schoolApplies=0,pinSaves=0,workspaceCreates=0,workspaceEdits=0,workspaceArchiveRequests=0,workspaceGrants=0;
const fixtureOwner='11111111-1111-4111-8111-111111111111',proposalId='55555555-5555-4555-8555-555555555555';
const backend=http.createServer(async(req,res)=>{
  let result={},status=200;
  if(req.url==='/rest/v1/rpc/agent_access_operation'){
    let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw);operations++;
    const workspace=body.p_token_hash===workspaceHash;
    assert.equal(req.headers.authorization,'Bearer fixture-service');assert.ok(workspace||body.p_token_hash===hash);
    assert.equal(raw.includes(key)||raw.includes(workspaceKey),false);
    if(revoked){status=400;result={message:'AGENT_UNAUTHORIZED',code:'P0001'};}
    else if(body.p_action==='status')result={id:fixtureOwner,label:'Grok Bot',expiresAt:new Date(Date.now()+(workspace?365:30)*86400000).toISOString(),tags:[],
      ...(workspace?{scope:'owner_workspace'}:{}),permissions:{read:true,create:true,update:workspace,delete:false,...(workspace?{requestArchive:true}:{})}};
    else if(body.p_action==='update'||body.p_action==='request_archive'){
      if(!workspace){status=400;result={message:'AGENT_FORBIDDEN',code:'P0001'};}
      else if(body.p_action==='request_archive'){
        assert.deepEqual(body.p_payload,{kind:'note',id:proposalId});
        workspaceArchiveRequests++;result={id:proposalId,status:'pending'};
      }else{
        assert.deepEqual(body.p_payload,{kind:'task',id:proposalId,request_id:proposalId,changes:{title:'Updated',due_date:null,tag_ids:[]}});
        workspaceEdits++;result={id:proposalId,kind:'task'};
      }
    }
    else if(body.p_action==='create_task'){
      assert.deepEqual(body.p_payload,{request_id:proposalId,title:'Unlabelled task',description:'',due_date:null,priority:3,tag_ids:[]});
      if(!workspace){status=400;result={message:'AGENT_TAG_INVALID',code:'P0001'};}
      else{workspaceCreates++;result={id:proposalId,kind:'task'};}
    }
    else if(body.p_action==='create_note')result={id:'22222222-2222-4222-8222-222222222222',kind:'note',duplicate:false};
    else result={items:[],nextOffset:null};
  }else if(req.url==='/rest/v1/rpc/create_my_owner_workspace_agent'){
    let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw);
    assert.equal(req.headers.authorization,'Bearer human-session');
    assert.deepEqual(Object.keys(body).sort(),['p_days','p_label','p_token_hash']);assert.equal(body.p_days,365);
    assert.equal(body.p_label,'Workspace fixture');assert.match(body.p_token_hash,/^[0-9a-f]{64}$/);
    workspaceGrants++;result={id:proposalId,owner_workspace:true};
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
  const cookieLifetime=response=>Number(response.headers.getSetCookie().find(value=>value.startsWith('dcp_agent='))?.match(/Max-Age=(\d+)/i)?.[1]);
  const previousLifetime=cookieLifetime(login);
  assert.ok(previousLifetime<=30*86400&&previousLifetime>30*86400-10);
  const loginWorkspace=await request('/api/agent/session',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({key:workspaceKey})});
  assert.equal(loginWorkspace.status,200);
  const longLifetime=cookieLifetime(loginWorkspace);
  assert.ok(longLifetime<=365*86400&&longLifetime>365*86400-10);
  const before=operations;
  for(const method of ['DELETE','PUT'])assert.equal((await request('/api/agent',{method})).status,403);
  assert.equal((await request('/api/agent',{method:'PATCH'})).status,415);
  assert.equal((await request('/api/agent?view=delete')).status,403);assert.equal((await request('/api/agent?key=not-allowed')).status,400);assert.equal(operations,before);
  const note={kind:'note',requestId:'33333333-3333-4333-8333-333333333333',title:'Fixture',description:'Not production'};
  const create=await request('/api/agent',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify(note)});assert.equal(create.status,201);
  const bad=await request('/api/agent',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({...note,ownerId:'forged'})});assert.equal(bad.status,422);
  const workspaceRequest=(method,body,headers={Authorization:'Bearer '+workspaceKey})=>fetch(base+'/api/agent',{
    method,headers:{'Content-Type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})
  });
  const workspaceStatus=await(await workspaceRequest('GET')).json();assert.equal(workspaceStatus.scope,'owner_workspace');
  assert.deepEqual(workspaceStatus.permissions,{read:true,create:true,update:true,delete:false,requestArchive:true});
  const edit={kind:'task',id:proposalId,requestId:proposalId,changes:{title:'Updated',dueDate:null,tagIds:[]}};
  const archive={action:'request_archive',kind:'note',id:proposalId};
  const noTag={kind:'task',requestId:proposalId,title:'Unlabelled task'};
  assert.equal((await workspaceRequest('PATCH',edit,{Authorization:'Bearer '+key})).status,403);
  assert.equal((await workspaceRequest('PATCH',edit,{Authorization:'Bearer '+workspaceKey,'Content-Type':'application/jsonp'})).status,415);
  assert.equal((await workspaceRequest('POST',archive,{Authorization:'Bearer '+key})).status,403);
  assert.equal((await workspaceRequest('POST',noTag,{Authorization:'Bearer '+key})).status,422);
  assert.equal((await workspaceRequest('PATCH',edit,{Cookie:'dcp_agent='+workspaceKey})).status,403);
  assert.equal((await workspaceRequest('PATCH',edit,{Cookie:'dcp_access=human-session',Origin:base})).status,401);
  assert.equal((await workspaceRequest('PATCH',{...edit,changes:{admin:true}})).status,422);
  assert.equal((await workspaceRequest('POST',{...archive,ownerOrdered:true})).status,422);
  assert.equal((await workspaceRequest('PATCH',edit)).status,200);
  assert.equal((await workspaceRequest('POST',noTag)).status,201);
  const pending=await workspaceRequest('POST',archive,{Cookie:'dcp_agent='+workspaceKey,Origin:base});
  assert.equal(pending.status,202);assert.equal((await pending.json()).status,'pending');
  assert.equal((await workspaceRequest('DELETE')).status,403);
  for(const protectedPath of ['/api/agent-access','/api/control?view=bootstrap','/api/backup']){
    assert.equal((await request(protectedPath,{headers:{Authorization:'Bearer '+workspaceKey}})).status,401);
  }
  const settingsDenied=await request('/api/control',{method:'POST',headers:{Authorization:'Bearer '+workspaceKey,Origin:base,'Content-Type':'application/json'},body:JSON.stringify({
    action:'save_settings',settings:{pinned_pages:['/calendar']},
  })});
  assert.equal(settingsDenied.status,401);assert.equal(pinSaves,0);
  const grant={action:'create',label:'Workspace fixture',days:365,acknowledged:true};
  const issue=(headers,data=grant)=>fetch(base+'/api/agent-access',{method:'POST',headers:{Origin:base,'Content-Type':'application/json',...headers},body:JSON.stringify(data)});
  assert.equal((await issue({Authorization:'Bearer '+workspaceKey})).status,401);
  assert.equal((await issue({Authorization:'Bearer human-session'})).status,403);
  assert.equal((await issue({Cookie:'dcp_access=human-session'},{...grant,days:366})).status,422);
  const issued=await issue({Cookie:'dcp_access=human-session'});assert.equal(issued.status,201);
  assert.match((await issued.json()).accessCode,/^dcp_grok_[\w-]{43}$/);
  assert.deepEqual([workspaceCreates,workspaceEdits,workspaceArchiveRequests,workspaceGrants],[1,1,1,1]);
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
  console.log('PASS actual Agent API: hash-only isolated credential, consented workspace create/update/archive request, old-grant restriction, no direct delete/settings/backup, origin guards and revocation');
  console.log('PASS actual month and pin APIs: human account-scoped read/write isolation, bounded query inputs, owner-filtered settings and no public cache');
}catch(error){throw new Error(`${error.message}\n${logs.slice(-1800)}`,{cause:error});}
finally{server.kill();await new Promise(r=>backend.close(r));}
