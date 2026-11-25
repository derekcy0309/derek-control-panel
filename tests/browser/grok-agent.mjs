// Real frontend + isolated API fixtures. No real credentials or production writes.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {schoolReviewFixture,testSchoolReview} from './school-bot-scenarios.mjs';
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
    const errors=[];page.on('pageerror',e=>errors.push(e.message));let logged=false,failOnce=true,requests=[],schoolOnly=false,ownerScope=false,proposed=0,archiveQueued=0,editCalls=0;
    const session={id,label:'Grok Bot',expiresAt:new Date(Date.now()+30*86400000).toISOString(),tags:[{id:tag,name:'個人'}],permissions:{read:true,create:true,update:false,delete:false}};
    const items=[{id:'33333333-3333-4333-8333-333333333333',kind:'task',title:'已開放的工作',description:'只供讀取的內容',status:'not_started'}];
    await page.route('**/api/**',async route=>{
      const request=route.request(),url=new URL(request.url());let body={},status=200;
      if(url.pathname==='/api/agent/session'){
        if(request.method()==='DELETE'){logged=false;body={ok:true};}
        else{assert.equal(request.postDataJSON().key,key);logged=true;body=session;}
      }else if(url.pathname==='/api/agent/school'){
        if(request.method()==='POST'){assert.equal(request.postDataJSON().operation,'create');proposed++;body={proposalId:id,status:'pending',duplicate:false};status=202;}
        else body={enabled:true,items:[{id,title:'學校事項',date:'2026-11-19',version:'2026-11-19T00:00:00Z'}],more:false};
      }else if(url.pathname==='/api/agent/brief'){
        body={days:[],sources:[],text:'今日 2026-11-14\n09:00–10:00 Apple 私人行程\nDeadline 本人工作'};
      }else if(url.pathname==='/api/agent'){
        if(!logged){status=401;body={error:'請登入'};}
        else if(request.method()==='GET'){
          const view=url.searchParams.get('view');if(schoolOnly&&view!=='status')throw new Error('School-only must not load Task/Notes');
          body=view==='status'?(schoolOnly?{...session,scope:'school_only',tags:[]}:ownerScope?{...session,scope:'owner_workspace',tags:[],permissions:{...session.permissions,update:true,requestArchive:true}}:session):view==='detail'?{item:items.find(v=>v.id===url.searchParams.get('id'))}:{items:items.filter(v=>v.kind===url.searchParams.get('kind')),nextOffset:null};
        }else{
          const input=request.postDataJSON();requests.push(input);
          if(request.method()==='PATCH'){
            assert.equal(ownerScope,true);assert.deepEqual(input.changes,{title:'已修改本人工作'});assert.match(input.requestId,/^[a-f0-9-]{36}$/);
            const item=items.find(v=>v.id===input.id);assert.equal(item.kind,input.kind);Object.assign(item,input.changes);
            editCalls++;body={id:item.id,kind:item.kind};
          }else if(input.action==='request_archive'){
            assert.equal(ownerScope,true);assert.deepEqual(input,{action:'request_archive',kind:'task',id:items[0].id});
            archiveQueued++;status=202;body={status:'pending',requestId:id};
          }else if(failOnce){failOnce=false;status=503;body={error:'驗證用連線失敗；請重試，草稿保留。'};}
          else{const item={id:crypto.randomUUID(),kind:input.kind,title:input.title,description:input.description,category:input.category};items.push(item);body={id:item.id,kind:item.kind,duplicate:false};status=201;}
        }
      }else throw new Error(`Agent unexpectedly requested ${url.pathname}`);
      await route.fulfill({status,json:body});
    });
    await page.goto(base+'/agent',{waitUntil:'domcontentloaded'});await page.getByRole('heading',{name:'AI Bot 登入',exact:true}).waitFor();
    await page.getByLabel('Access Code',{exact:true}).fill(key);await page.getByRole('button',{name:'登入 Agent 工作區',exact:true}).click();
    await page.getByRole('heading',{name:'Grok Bot',exact:true}).waitFor();
    await page.goto(base+'/agent/brief');await page.getByRole('region',{name:'Grok 三日精簡摘要',exact:true}).getByText(/Apple 私人行程/).waitFor();assert.equal(await page.getByRole('button',{name:'新增 Task',exact:true}).count(),0);await page.goto(base+'/agent');await page.getByRole('heading',{name:'Grok Bot',exact:true}).waitFor();
    assert.notEqual(await page.getByRole('button',{name:'新增 Task',exact:true}).evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)');
    await page.getByRole('button',{name:'已開放的工作',exact:true}).click();await page.getByText('只供讀取的內容',{exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'修改 Task',exact:true}).count(),0);
    assert.equal(await page.getByRole('button',{name:'提出封存建議',exact:true}).count(),0);
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
    ownerScope=true;await page.goto(base+'/agent');await page.getByRole('button',{name:'已開放的工作',exact:true}).click();
    await page.getByRole('button',{name:'修改 Task',exact:true}).click();await page.getByLabel('名稱',{exact:true}).fill('已修改本人工作');
    await page.getByRole('button',{name:'儲存修改',exact:true}).click();await page.getByRole('heading',{name:'已修改本人工作',exact:true}).waitFor();
    assert.equal(editCalls,1);
    await page.getByRole('button',{name:'提出封存建議',exact:true}).click();assert.equal(archiveQueued,0);
    await page.getByRole('button',{name:'提交封存建議',exact:true}).click();await page.getByText(/項目未封存/).waitFor();
    assert.equal(archiveQueued,1);assert.equal(await page.getByRole('heading',{name:'已修改本人工作',exact:true}).count(),1);
    assert.equal(await page.getByRole('link',{name:/設定/}).count(),0);
    await page.getByRole('button',{name:'新增 Task',exact:true}).click();
    const ownerCreate=page.getByRole('form',{name:'新增 Task',exact:true});
    await ownerCreate.getByLabel('任務名稱',{exact:true}).fill('唔使 Tag 嘅本人工作');
    await ownerCreate.getByRole('button',{name:'確認新增',exact:true}).click();
    await page.getByRole('heading',{name:'唔使 Tag 嘅本人工作',exact:true}).waitFor();
    assert.deepEqual(requests.at(-1).tagIds,[]);
    schoolOnly=true;await page.goto(base+'/agent');await page.getByRole('button',{name:'建議新增學校事項'}).click();
    await page.getByLabel('事項名稱',{exact:true}).fill('Synthetic school proposal');await page.getByRole('button',{name:'提交建議，等本人確認'}).click();
    await page.getByText(/建議已送出，等本人登入確認/).waitFor();assert.equal(proposed,1);
    assert.equal(await page.getByRole('button',{name:'新增 Task',exact:true}).count(),0);
    assert.equal(await page.getByRole('button',{name:/本人確認刪除/}).count(),0);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.getByRole('button',{name:'登出 Agent',exact:true}).click();await page.getByRole('heading',{name:'AI Bot 登入',exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>Object.keys(sessionStorage).filter(k=>k.startsWith('dcp:agent-draft:')).length),0);assert.deepEqual(errors,[]);
    console.log(`PASS Grok browser ${width}px: limited and owner login, task/note create, draft/retry, owner edit and request-only archive, logout and responsive layout`);await context.close();
  }
  const context=await browser.newContext({viewport:{width:1280,height:920},serviceWorkers:'block'}),page=await context.newPage();page.setDefaultTimeout(18000);
  let grant=null,created=0,revoked=0,apple=null,appleSelected=[],reauth=true,decisions=[];
  const reviewId='44444444-4444-4444-8444-444444444444';
  let reviews=[{id:reviewId,kind:'task',label:'我指示封存嘅工作',createdAt:'2026-11-25T00:00:00Z',grantLabel:'Grok Bot'}];
  const school=schoolReviewFixture();
  await page.route('**/api/**',async route=>{
    const request=route.request(),url=new URL(request.url());let body={},status=200;
    if(url.pathname==='/api/school-bot-review')return school.respond(route);
    if(url.pathname==='/api/agent-access/archive-requests'){
      if(request.method()==='POST'){
        const value=request.postDataJSON();decisions.push(value);
        assert.deepEqual(value,{id:reviewId,decision:'confirm',ownerOrdered:true,confirmation:'archive'});
        if(reauth){status=401;body={reauth:true,error:'請先重新登入再核對。'};}
        else{reviews=[];body={status:'archived'};}
      }else body={requests:reviews};
    }else if(url.pathname==='/api/agent-access'){
      if(request.method()==='POST'){
        const value=request.postDataJSON();
        if(value.action==='create'){
          created++;assert.equal(value.acknowledged,true);
          if(created===1)assert.deepEqual(value,{action:'create',label:'Grok Bot',days:30,scope:'owner_workspace',acknowledged:true});
          else{assert.equal(value.scope,'selected');assert.deepEqual(value.tagIds,[tag]);}
          grant={id,label:'Grok Bot',key_fingerprint:'fixture',created_at:new Date().toISOString(),expires_at:new Date(Date.now()+30*86400000).toISOString(),last_used_at:null,revoked_at:null,owner_workspace:created===1};body={grant,accessCode:key,loginPath:'/agent'};
        }
        else{revoked++;grant.revoked_at=new Date().toISOString();body={ok:true};}
      }else body={grants:grant?[grant]:[],events:[],tasks:[{id:'33333333-3333-4333-8333-333333333333',title:'本人工作（fixture）'}],notes:[],tags:[{id:tag,name:'個人'}]};
    }else if(url.pathname==='/api/integrations/apple-calendar'){
      if(request.method()==='POST'){const value=request.postDataJSON();if(value.action==='connect'){assert.equal(value.acknowledged,true);apple={id,account_email:'fixture@example.test',status:'select_calendars',calendars:[{id:'private',name:'私人行程'},{id:'not-selected',name:'不要讀取此 Calendar'}],selected_ids:[]};}else if(value.action==='select'){assert.deepEqual(value.calendarIds,['private']);appleSelected=value.calendarIds;apple.selected_ids=value.calendarIds;apple.status='connected';}body={apple,sync:{state:'fresh'}};}
      else body={apple,grants:[],permissions:[]};
    }else if(url.pathname==='/api/auth')body={user:{id}};
    else if(url.pathname==='/api/integrations/google-calendar')body={connections:[]};
    else if(url.searchParams.get('view')==='assignment_alerts')body={assignments:[],currentUserId:id,quietModeUntil:null};
    else body={currentUser:{id,displayName:'Derek',email:'owner@example.test'},profile:{user_id:id,display_name:'Derek',active:true,is_admin:true,timezone:'Asia/Hong_Kong'},settings:{theme:'sunrise'},tasks:[],transactions:[],meetings:[],balances:[],operatingItems:[],assignments:[],shares:[],handoffNotes:[],planning:[],participants:[],taskDependencies:[],projectMilestones:[],taskRecurrenceRules:[],capacity:null,notificationPreferences:null,notificationDeliveries:[],activePushSubscriptionCount:0,household:null,calendarConnections:[],taskNoticeRecipients:[],taskFollowers:[],showEncouragement:false};
    await route.fulfill({status,json:body});
  });
  await page.goto(base+'/settings',{waitUntil:'domcontentloaded'});const manager=page.getByRole('region',{name:'AI Bot 登入',exact:true});
  await manager.getByText('管理 Bot Login／Access Code',{exact:true}).click();
  assert.equal(await manager.getByLabel('存取範圍',{exact:true}).inputValue(),'owner_workspace');
  assert.equal(await manager.getByRole('button',{name:'建立一般 Bot Login',exact:true}).isDisabled(),true);
  await manager.getByRole('checkbox',{name:/我同意呢個 Agent 讀取/}).check();await manager.getByRole('button',{name:'建立一般 Bot Login',exact:true}).click();
  await manager.getByLabel('Bot Access Code',{exact:true}).waitFor();assert.equal(await manager.getByLabel('Bot Access Code',{exact:true}).getAttribute('type'),'password');assert.equal(created,1);
  await manager.getByRole('button',{name:'停用存取',exact:true}).click();await manager.getByRole('button',{name:'確認停用這個 Access Code',exact:true}).click();
  await manager.getByRole('status').filter({hasText:'已停用；'}).waitFor();assert.equal(revoked,1);assert.equal(await manager.getByLabel('Bot Access Code',{exact:true}).count(),0);
  await manager.getByLabel('存取範圍',{exact:true}).selectOption('selected');
  await manager.getByRole('button',{name:'個人',exact:true}).click();
  await manager.getByRole('checkbox',{name:/我同意呢個 Agent 讀取上述/}).check();await manager.getByRole('button',{name:'建立一般 Bot Login',exact:true}).click();
  await manager.getByLabel('Bot Access Code',{exact:true}).waitFor();assert.equal(created,2);
  await manager.getByText('封存建議 · 由我確認',{exact:true}).click();
  await manager.getByText('我指示封存嘅工作',{exact:true}).waitFor();
  await manager.getByRole('button',{name:'核對封存建議',exact:true}).click();
  assert.equal(await manager.getByRole('button',{name:'確認封存',exact:true}).isDisabled(),true);
  await manager.getByRole('checkbox',{name:'呢一項係我本人要求封存。',exact:true}).check();
  await manager.getByRole('button',{name:'確認封存',exact:true}).click();
  await manager.getByRole('button',{name:'用 Google 重新登入',exact:true}).waitFor();
  assert.equal(decisions.length,1);
  reauth=false;await manager.getByRole('button',{name:'重新載入建議',exact:true}).click();
  await manager.getByRole('button',{name:'核對封存建議',exact:true}).click();
  assert.equal(await manager.getByRole('button',{name:'確認封存',exact:true}).isDisabled(),true);
  assert.equal(decisions.length,1);
  await manager.getByRole('checkbox',{name:'呢一項係我本人要求封存。',exact:true}).check();
  await manager.getByRole('button',{name:'確認封存',exact:true}).click();
  await manager.getByRole('status').filter({hasText:'已按你確認封存'}).waitFor();assert.equal(decisions.length,2);
  console.log('PASS Agent admin UI: default owner/legacy switch, explicit consent, masked one-time code/revoke and human-only archive with explicit re-confirmation after reauth');
  const settings=page.getByRole('region',{name:'私人 Calendar 及 Grok 日報',exact:true});await settings.getByText('連接 Apple／設定三日日報',{exact:true}).click();
  await settings.getByLabel('Apple Account 電郵',{exact:true}).fill('fixture@example.test');await settings.getByLabel('App 專用密碼（不是主密碼）',{exact:true}).fill('xxxx-yyyy-zzzz-wwww');
  await settings.getByRole('checkbox',{name:/同意 Panel 安全保存/}).check();await settings.getByRole('button',{name:'連接／重新連接 Apple',exact:true}).click();await settings.getByText('私人行程',{exact:true}).waitFor();
  assert.equal(await settings.getByLabel('App 專用密碼（不是主密碼）',{exact:true}).inputValue(),'');assert.equal(await settings.getByRole('checkbox',{name:'私人行程',exact:true}).isChecked(),false);
  await settings.getByRole('checkbox',{name:'私人行程',exact:true}).check();await settings.getByRole('button',{name:'儲存 Calendar 選擇',exact:true}).click();await settings.getByRole('status').filter({hasText:'私人行程設定已更新'}).waitFor();assert.deepEqual(appleSelected,['private']);
  assert.equal(await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}).includes('xxxx-yyyy-zzzz-wwww')),false);console.log('PASS private Calendar setup: explicit consent/selection, no password draft, no automatic all-calendar share');
  for(const width of [360,1280]){school.reset();await page.setViewportSize({width,height:920});await testSchoolReview(page,base,school);}
  await context.close();
}finally{await browser?.close();server?.kill();}
