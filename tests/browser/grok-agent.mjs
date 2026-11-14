// Real frontend + isolated API fixtures. No real credentials or production writes.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const base=process.env.VERIFY_URL||'http://localhost:3145';let logs='';
const server=process.env.VERIFY_URL?null:spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--hostname','127.0.0.1','-p','3145'],{env:{...process.env,NEXT_PUBLIC_SUPABASE_URL:'https://example.supabase.co',NEXT_PUBLIC_SUPABASE_ANON_KEY:'fixture',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']});
server?.stdout.on('data',v=>{logs+=v;});server?.stderr.on('data',v=>{logs+=v;});let browser;
const key='dcp_grok_'+'x'.repeat(43),id='11111111-1111-4111-8111-111111111111',tag='22222222-2222-4222-8222-222222222222';
try{
  if(server)for(let i=0;i<100;i++){if(server.exitCode!==null)throw new Error(logs.slice(-1800));try{if((await fetch(base+'/api/agent')).status===401)break;}catch{}await new Promise(r=>setTimeout(r,400));}
  browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE});
  for(const width of [360,1280]){
    const context=await browser.newContext({viewport:{width,height:920},serviceWorkers:'block'}),page=await context.newPage();page.setDefaultTimeout(18000);
    const errors=[];page.on('pageerror',e=>errors.push(e.message));let logged=false,failOnce=true,requests=[];
    const session={id,label:'Grok Bot',expiresAt:new Date(Date.now()+30*86400000).toISOString(),tags:[{id:tag,name:'個人'}],permissions:{read:true,create:true,update:false,delete:false}};
    const items=[{id:'33333333-3333-4333-8333-333333333333',kind:'task',title:'已開放的工作',description:'只供讀取的內容',status:'not_started'}];
    await page.route('**/api/**',async route=>{
      const request=route.request(),url=new URL(request.url());let body={},status=200;
      if(url.pathname==='/api/agent/session'){
        if(request.method()==='DELETE'){logged=false;body={ok:true};}
        else{assert.equal(request.postDataJSON().key,key);logged=true;body=session;}
      }else if(url.pathname==='/api/agent'){
        if(!logged){status=401;body={error:'請登入'};}
        else if(request.method()==='GET'){
          const view=url.searchParams.get('view');body=view==='status'?session:view==='detail'?{item:items.find(v=>v.id===url.searchParams.get('id'))}:{items:items.filter(v=>v.kind===url.searchParams.get('kind')),nextOffset:null};
        }else{
          const input=request.postDataJSON();requests.push(input);
          if(failOnce){failOnce=false;status=503;body={error:'驗證用連線失敗；請重試，草稿保留。'};}
          else{const item={id:crypto.randomUUID(),kind:input.kind,title:input.title,description:input.description,category:input.category};items.push(item);body={id:item.id,kind:item.kind,duplicate:false};status=201;}
        }
      }else throw new Error(`Agent unexpectedly requested ${url.pathname}`);
      await route.fulfill({status,json:body});
    });
    await page.goto(base+'/agent',{waitUntil:'domcontentloaded'});await page.getByRole('heading',{name:'Grok Agent 登入',exact:true}).waitFor();
    await page.getByLabel('Access Code',{exact:true}).fill(key);await page.getByRole('button',{name:'登入 Agent 工作區',exact:true}).click();
    await page.getByRole('heading',{name:'Grok Bot',exact:true}).waitFor();
    assert.notEqual(await page.getByRole('button',{name:'新增 Task',exact:true}).evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)');
    await page.getByRole('button',{name:'已開放的工作',exact:true}).click();await page.getByText('只供讀取的內容',{exact:true}).waitFor();
    await page.getByRole('button',{name:'新增 Task',exact:true}).click();const form=page.getByRole('form',{name:'新增 Task',exact:true});
    await form.getByLabel('任務名稱',{exact:true}).fill('Agent 新增工作');await form.getByLabel('內容（可留空）',{exact:true}).fill('草稿不會丟失');
    await form.getByRole('button',{name:'確認新增',exact:true}).click();await form.getByRole('alert').waitFor();
    await form.getByRole('button',{name:'稍後再填',exact:true}).click();await page.getByRole('button',{name:'新增 Task',exact:true}).click();
    assert.equal(await form.getByLabel('任務名稱',{exact:true}).inputValue(),'Agent 新增工作');
    await form.getByRole('button',{name:'確認新增',exact:true}).click();await page.getByRole('heading',{name:'Agent 新增工作',exact:true}).waitFor();
    assert.equal(requests[0].requestId,requests[1].requestId);
    await page.getByRole('button',{name:'Notes',exact:true}).click();await page.getByRole('button',{name:'新增 Notes',exact:true}).click();
    const noteForm=page.getByRole('form',{name:'新增 Notes',exact:true});await noteForm.getByLabel('筆記標題',{exact:true}).fill('Agent 記事');await noteForm.getByLabel('分類（可留空）',{exact:true}).fill('學習');
    assert.equal(await noteForm.locator('input[type=date]').count(),0);await noteForm.getByRole('button',{name:'確認新增',exact:true}).click();await page.getByRole('heading',{name:'Agent 記事',exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    assert.equal(await page.evaluate(secret=>JSON.stringify({...localStorage,...sessionStorage}).includes(secret),key),false);
    if(process.env.SCREENSHOT_DIR){await mkdir(process.env.SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:`${process.env.SCREENSHOT_DIR}/grok-${width}.png`,fullPage:true});}
    await page.getByRole('button',{name:'登出 Agent',exact:true}).click();await page.getByRole('heading',{name:'Grok Agent 登入',exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>Object.keys(sessionStorage).filter(k=>k.startsWith('dcp:agent-draft:')).length),0);assert.deepEqual(errors,[]);
    console.log(`PASS Grok browser ${width}px: limited login/read, task/note create, draft/retry idempotency, logout and responsive layout`);await context.close();
  }
  const context=await browser.newContext({viewport:{width:1280,height:920},serviceWorkers:'block'}),page=await context.newPage();page.setDefaultTimeout(18000);
  let grant=null,created=0,revoked=0;
  await page.route('**/api/**',async route=>{
    const request=route.request(),url=new URL(request.url());let body={};
    if(url.pathname==='/api/agent-access'){
      if(request.method()==='POST'){
        const value=request.postDataJSON();
        if(value.action==='create'){created++;assert.equal(value.acknowledged,true);assert.deepEqual(value.tagIds,[tag]);grant={id,label:'Grok Bot',key_fingerprint:'fixture',created_at:new Date().toISOString(),expires_at:new Date(Date.now()+30*86400000).toISOString(),last_used_at:null,revoked_at:null};body={grant,accessCode:key,loginPath:'/agent'};}
        else{revoked++;grant.revoked_at=new Date().toISOString();body={ok:true};}
      }else body={grants:grant?[grant]:[],events:[],tasks:[{id:'33333333-3333-4333-8333-333333333333',title:'本人工作（fixture）'}],notes:[],tags:[{id:tag,name:'個人'}]};
    }else if(url.pathname==='/api/auth')body={user:{id}};
    else if(url.pathname==='/api/integrations/google-calendar')body={connections:[]};
    else if(url.searchParams.get('view')==='assignment_alerts')body={assignments:[],currentUserId:id,quietModeUntil:null};
    else body={currentUser:{id,displayName:'Derek'},profile:{user_id:id,display_name:'Derek',active:true,is_admin:true,timezone:'Asia/Hong_Kong'},settings:{theme:'sunrise'},tasks:[],transactions:[],meetings:[],balances:[],operatingItems:[],assignments:[],shares:[],handoffNotes:[],planning:[],participants:[],taskDependencies:[],projectMilestones:[],taskRecurrenceRules:[],capacity:null,notificationPreferences:null,notificationDeliveries:[],activePushSubscriptionCount:0,household:null,calendarConnections:[],taskNoticeRecipients:[],taskFollowers:[],showEncouragement:false};
    await route.fulfill({status:200,json:body});
  });
  await page.goto(base+'/settings',{waitUntil:'domcontentloaded'});const manager=page.getByRole('region',{name:'Grok 專用登入',exact:true});
  await manager.getByText('管理 Grok Login／Access Code',{exact:true}).click();await manager.getByRole('button',{name:'個人',exact:true}).click();
  await manager.getByRole('checkbox',{name:/我同意 Grok 讀取/}).check();await manager.getByRole('button',{name:'建立 Grok Login',exact:true}).click();
  await manager.getByLabel('Grok Access Code',{exact:true}).waitFor();assert.equal(await manager.getByLabel('Grok Access Code',{exact:true}).getAttribute('type'),'password');assert.equal(created,1);
  await manager.getByRole('button',{name:'停用存取',exact:true}).click();await manager.getByRole('button',{name:'確認停用這個 Access Code',exact:true}).click();
  await manager.getByRole('status').filter({hasText:'已停用；'}).waitFor();assert.equal(revoked,1);assert.equal(await manager.getByLabel('Grok Access Code',{exact:true}).count(),0);
  console.log('PASS Grok admin UI: explicit scope/consent, create-once masked code and revoke');await context.close();
}finally{await browser?.close();server?.kill();}
