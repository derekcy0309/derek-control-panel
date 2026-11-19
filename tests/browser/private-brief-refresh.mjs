// Isolated UI fixtures: no real Apple account or Task is read/written.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const base=process.env.VERIFY_URL||'http://localhost:3149';let logs='',browser;
const server=process.env.VERIFY_URL?null:spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--hostname','127.0.0.1','-p','3149'],{env:{...process.env,NEXT_PUBLIC_SUPABASE_URL:'https://example.supabase.co',NEXT_PUBLIC_SUPABASE_ANON_KEY:'fixture',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']});
server?.stdout.on('data',v=>{logs+=v;});server?.stderr.on('data',v=>{logs+=v;});
try{
 if(server)for(let i=0;i<100;i++){if(server.exitCode!==null)throw new Error(logs.slice(-1500));try{if((await fetch(base+'/api/auth')).status===401)break;}catch{}await new Promise(r=>setTimeout(r,400));}
 browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE});
 for(const width of [360,1280]){
  const context=await browser.newContext({viewport:{width,height:920},serviceWorkers:'block'}),page=await context.newPage();page.setDefaultTimeout(20000);
  const id='11111111-1111-4111-8111-111111111111',errors=[];let phase=0,reads=0,refreshes=0,release;
  page.on('pageerror',e=>errors.push(e.message));
  const snapshot={currentUser:{id,displayName:'Derek'},profile:{user_id:id,display_name:'Derek',workspace_role:'derek',active:true,is_admin:true},settings:{theme:'light'},tasks:[],taskCatalog:[],taskQueueCatalog:[],taskTags:[],taskNoticeRecipients:[],taskFollowers:[],planning:[],assignments:[],shares:[],participants:[],taskDependencies:[],capacity:null,capacityCommitments:[],weeklyAvailableMinutes:null,reminders:[],notificationPreferences:null,cashflowHint:null,showEncouragement:false};
  await page.route('**/api/**',async route=>{
   const req=route.request(),url=new URL(req.url());let status=200,body={};
   if(url.pathname==='/api/auth')body={user:{id}};
   else if(url.pathname==='/api/integrations/apple-calendar'){
    assert.equal(req.method(),'POST');assert.deepEqual(req.postDataJSON(),{action:'refresh'});refreshes++;
    if(phase===5){await route.abort('failed');return;}
    if(phase===1)await new Promise(resolve=>{release=resolve;});
    if(phase===3){status=429;body={error:'剛更新過，請等 30 秒再試。'};}else body={sync:{state:phase===2?'stale':'fresh'}};
   }else if(url.pathname==='/api/calendar-brief'){
    assert.equal(req.method(),'GET');reads++;
    if(phase===4){await route.fulfill({status:503,contentType:'text/html',body:'upstream failed'});return;}
    const stale=phase===2;
    body={generatedAt:'2026-11-19T02:00:00Z',from:'2026-11-19',untilExclusive:'2026-11-22',days:[{date:'2026-11-19',events:[],deadlines:[{id:'22222222-2222-4222-8222-222222222222',title:`Deadline result ${phase}`,due:'2026-11-19',priority:1,status:'not_started'}]}],sources:[{label:'Panel',state:'fresh',lastSync:'2026-11-19T02:00:00Z'},{label:'Apple Calendar',state:stale?'stale':'fresh',lastSync:stale?'2026-11-18T02:00:00Z':'2026-11-19T02:00:00Z',...(stale?{errorCode:'APPLE_AUTH_REQUIRED'}:{})}],truncated:false,text:'Fixture'};
   }else if(url.searchParams.get('view')==='assignment_alerts')body={assignments:[],currentUserId:id,quietModeUntil:null};
   else{assert.equal(req.method(),'GET','No Task mutations are allowed');body=snapshot;}
   await route.fulfill({status,json:body});
  });
  await page.goto(base,{waitUntil:'domcontentloaded'});const panel=page.getByRole('region',{name:'三日行程同 Deadline',exact:true});await panel.getByText('Deadline result 0',{exact:true}).waitFor();assert.equal(refreshes,0);
  const initialReads=reads;phase=1;await panel.getByRole('button',{name:'更新',exact:true}).click();await panel.getByRole('button',{name:'更新中…',exact:true}).waitFor();assert.equal(await panel.getByRole('button',{name:'更新中…',exact:true}).isDisabled(),true);
  assert.equal(refreshes,1);release();await panel.getByText('Deadline result 1',{exact:true}).waitFor();assert.equal(reads,initialReads+1);
  phase=2;await panel.getByRole('button',{name:'更新',exact:true}).click();await panel.getByText('Deadline result 2',{exact:true}).waitFor();await panel.getByRole('alert').filter({hasText:'App 專用密碼重新連接'}).waitFor();assert.match(await panel.innerText(),/2026/);
  phase=3;await panel.getByRole('button',{name:'更新',exact:true}).click();await panel.getByText('Deadline result 3',{exact:true}).waitFor();await panel.getByRole('alert').filter({hasText:'等 30 秒'}).waitFor();
  phase=4;await panel.getByRole('button',{name:'更新',exact:true}).click();await panel.getByRole('alert').filter({hasText:'未能讀取伺服器回應'}).waitFor();assert.equal(await panel.getByText('Deadline result 3',{exact:true}).count(),1);assert.equal(await panel.getByRole('button',{name:'更新',exact:true}).isEnabled(),true);
  phase=5;await panel.getByRole('button',{name:'更新',exact:true}).click();await panel.getByText('Deadline result 5',{exact:true}).waitFor();await panel.getByRole('alert').filter({hasText:'獨立重讀 Panel'}).waitFor();
  assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  console.log(`PASS private brief ${width}px: real refresh POST, loading/duplicate guard, independent deadlines, safe source error/date, cooldown, retry and preserved prior results`);await context.close();
 }
}catch(e){throw new Error(`${e.message}\n${logs.slice(-1800)}`,{cause:e});}
finally{await browser?.close();server?.kill();}
