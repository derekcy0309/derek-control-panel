// End-to-end UI fixture; every account/data request is intercepted. No live writes.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const base = process.env.VERIFY_URL || 'http://localhost:3142';
let logs='';
const server = process.env.VERIFY_URL ? null : spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--hostname','127.0.0.1','-p','3142'],{env:{...process.env,NEXT_PUBLIC_SUPABASE_URL:'https://example.supabase.co',NEXT_PUBLIC_SUPABASE_ANON_KEY:'local-mock',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']});
server?.stdout.on('data',chunk=>{logs+=chunk;}); server?.stderr.on('data',chunk=>{logs+=chunk;});
let browser;
try {
  if(server) for(let i=0;i<100;i++) {
    if(server.exitCode!==null) throw new Error(logs.slice(-2500));
    try {if((await fetch(`${base}/api/auth`)).status===401) break;}catch{}
    await new Promise(resolve=>setTimeout(resolve,400));
  }
  browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE||undefined});
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Hong_Kong',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  for(const role of ['Derek','Suki','Amigo']) for(const width of [360,1280]) {
    const context=await browser.newContext({viewport:{width,height:920},serviceWorkers:'block'});
    const page=await context.newPage(); page.setDefaultTimeout(18000);
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    const userId='11111111-1111-4111-8111-111111111111';
    const names=role==='Derek'?['個人','Wecare','家庭','SEC']:['個人','Wecare'];
    let tags=names.map((name,i)=>({id:`99999999-9999-4999-8999-${String(i+1).padStart(12,'0')}`,name,legacy_key:null}));
    const makeTask=(id,title,values={})=>({id,user_id:userId,owner_id:userId,title,scope:'home',area:'personal',source_type:'follow_up',status:'not_started',due_date:null,follow_up_date:null,next_action:null,risk:'low',notes:null,completed_at:null,deleted_at:null,archived_at:null,created_at:`${today}T00:00:00Z`,updated_at:`${today}T00:00:00Z`,requested_priority:3,personal_tag_ids:[tags[0].id],...values});
    const tasks=[makeTask('22222222-2222-4222-8222-222222222221','我排第一件',{requested_priority:5}),makeTask('22222222-2222-4222-8222-222222222222','我排第二件',{requested_priority:1}),makeTask('22222222-2222-4222-8222-222222222223','未安排的高 Priority',{requested_priority:1}),makeTask('22222222-2222-4222-8222-222222222224','等文件回覆',{status:'waiting',waiting_for:'朋友'}),makeTask('22222222-2222-4222-8222-222222222225','依賴未完成',{requested_priority:1})];
    let planning=tasks.slice(0,2).map((task,i)=>({user_id:userId,resource_type:'task',resource_id:task.id,planned_date:today,plan_role:i?'later':'now',plan_source:'manual',plan_position:i+1}));
    let preferences=null;let createFailures=1;let creates=[];let navigations=0;let todayReads=0;
    const snapshot=()=>({currentUser:{id:userId,email:role==='Derek'?'derekcy0309@gmail.com':`${role.toLowerCase()}@example.test`,displayName:role},profile:{user_id:userId,display_name:role,workspace_role:role.toLowerCase(),active:true,is_admin:role==='Derek'},settings:{theme:'light',focus_minutes:25,gentle_mode:role==='Suki'},tasks,taskCatalog:tasks.filter(t=>t.status!=='done'),taskQueueCatalog:tasks,taskTags:tags,taskNoticeRecipients:[],taskFollowers:[],planning,assignments:[],shares:[],participants:[{user_id:userId,display_name:role},{user_id:'44444444-4444-4444-8444-444444444444',display_name:'現有用戶'}],taskDependencies:[{task_id:tasks[4].id,depends_on_task_id:'missing'}],capacity:null,capacityCommitments:[],weeklyAvailableMinutes:null,reminders:[],notificationPreferences:preferences,cashflowHint:null});
    await page.route('**/api/**',async route=>{
      const request=route.request();const url=new URL(request.url());let body={};let status=200;
      if(url.pathname==='/api/auth') body={user:{id:userId}};
      else if(request.method()==='GET') {
        const view=url.searchParams.get('view');
        if(view==='task_tags') body={tags,taskTagIds:tasks.find(t=>t.id===url.searchParams.get('taskId'))?.personal_tag_ids||[]};
        else if(view==='assignment_alerts') body={assignments:[],currentUserId:userId,quietModeUntil:null};
        else {if(view==='today')todayReads++;body=snapshot();}
      } else {
        const input=request.postDataJSON();
        if(input.action==='create_task') {
          creates.push(input);
          if(createFailures-->0) {status=503;body={error:'驗證用網絡失敗；請重試，草稿仍保留。'};}
          else {
            const task=makeTask('55555555-5555-4555-8555-555555555555',input.title,{due_date:input.dueDate,requested_priority:input.requestedPriority,personal_tag_ids:input.tagIds,work_dates:input.workDates,work_start_date:input.workStartDate});tasks.push(task);body={task};
            if(input.addToToday) planning.push({user_id:userId,resource_type:'task',resource_id:task.id,planned_date:today,plan_role:'later',plan_source:'manual',plan_position:null});
          }
        } else if(input.action==='update_task') {const task=tasks.find(t=>t.id===input.id);Object.assign(task,input.changes);body={task};}
        else if(input.action==='set_quiet_mode') {preferences={quiet_mode_until:input.until};body={ok:true};}
        else if(input.action==='manage_task_tag') {
          let tag=tags.find(t=>t.id===input.tagId);
          if(input.operation==='create'){tag={id:'88888888-8888-4888-8888-888888888888',name:input.name,legacy_key:null};tags.push(tag);}
          if(input.operation==='rename')tag.name=input.name;
          if(input.operation==='delete'){tags=tags.filter(t=>t.id!==input.tagId);for(const task of tasks)task.personal_tag_ids=task.personal_tag_ids.filter(id=>id!==input.tagId);}
          body={tag};
        } else throw new Error(`Unexpected write: ${input.action}`);
      }
      await route.fulfill({status,json:body});
    });
    await page.goto(base,{waitUntil:'domcontentloaded'});
    await page.getByRole('heading',{name:'今日做乜？'}).waitFor();
    page.on('request',request=>{if(request.isNavigationRequest()&&request.frame()===page.mainFrame())navigations++;});
    assert.equal(await page.locator('.simple-focus-card').count(),2);
    assert.match(await page.locator('.simple-focus-card').first().innerText(),/我排第一件/);
    assert.equal(await page.getByText('能量',{exact:true}).count(),0);
    assert.equal(await page.getByText('依賴未完成',{exact:true}).count(),0);
    assert.deepEqual(await page.locator('[aria-label="Dashboard Tags"] .simple-tag-filter').allTextContents(),['全部',...names]);
    if(process.env.SCREENSHOT_DIR){await mkdir(process.env.SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:`${process.env.SCREENSHOT_DIR}/${role}-${width}.png`,fullPage:true});}
    await page.locator('.simple-focus-card').first().getByRole('button',{name:'做完 Done'}).click();
    await page.getByRole('status').filter({hasText:'下一件：我排第二件'}).waitFor();
    assert.equal(await page.locator('.simple-focus-card').count(),1);
    assert.match(await page.locator('.simple-focus-card').first().innerText(),/我排第二件/);
    await page.getByRole('button',{name:'安靜模式',exact:true}).click();await page.getByRole('button',{name:'安靜中',exact:true}).waitFor();
    assert.ok(preferences.quiet_mode_until); // Per-account API; no other profile changes.
    await page.locator('.simple-add-task').click();const dialog=page.getByRole('dialog',{name:'加 Task'});
    await dialog.getByLabel('任務名稱',{exact:true}).fill('簡易模式新增驗證');
    await dialog.getByRole('button',{name:'個人',exact:true}).waitFor();
    await dialog.getByRole('button',{name:'加 Task',exact:true}).click();
    await dialog.getByRole('alert').filter({hasText:'請揀最少一個 Tag'}).waitFor();assert.equal(creates.length,0);
    await dialog.getByRole('button',{name:'個人',exact:true}).click();
    await dialog.getByText('P3 低 Low',{exact:true}).click();
    await dialog.getByText('日期／邊個跟',{exact:false}).click();
    await dialog.getByRole('button',{name:'今日',exact:true}).click();
    assert.equal(await dialog.getByRole('radio',{name:'P3 低 Low',exact:true}).isChecked(),true);
    const readsBeforeTyping=todayReads;
    await dialog.getByLabel('任務名稱',{exact:true}).fill('草稿保留測試');
    assert.equal(todayReads,readsBeforeTyping);
    await dialog.getByRole('button',{name:'關閉',exact:true}).click();
    const draftAfterClose=await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)||'null'),`dcp:task-form-draft:v1:${userId}:new`);
    assert.equal(draftAfterClose?.title,'草稿保留測試','closing the form must retain the entered draft');
    await page.locator('.simple-add-task').click();
    await dialog.getByRole('status').filter({hasText:'已恢復上次未送出的任務草稿'}).waitFor({state:'visible'});
    assert.equal(await dialog.getByLabel('任務名稱',{exact:true}).inputValue(),'草稿保留測試');
    assert.equal(await dialog.getByRole('button',{name:'個人',exact:true}).getAttribute('aria-pressed'),'true');
    await dialog.getByText('更多設定',{exact:false}).click();
    await dialog.getByText('自訂哪幾日做／提醒',{exact:false}).click();
    await dialog.getByLabel('加入要做的日子').fill(today);await dialog.getByRole('button',{name:'加入',exact:true}).click();
    await dialog.getByRole('button',{name:`移除 ${today}`,exact:true}).waitFor();
    await dialog.getByRole('button',{name:'加 Task',exact:true}).click();
    await dialog.getByRole('alert').filter({hasText:'驗證用網絡失敗'}).waitFor();
    assert.equal(await dialog.getByLabel('任務名稱',{exact:true}).inputValue(),'草稿保留測試');
    await dialog.getByRole('button',{name:'加 Task',exact:true}).click();
    await dialog.waitFor({state:'hidden'});assert.equal(creates.length,2);
    assert.equal(creates[0].clientRequestId,creates[1].clientRequestId);
    assert.equal(creates[1].requestedPriority,5);assert.equal(creates[1].energyLevel,undefined);assert.equal(creates[1].estimatedMinutes,undefined);
    assert.deepEqual(creates[1].workDates,[today]);assert.equal(creates[1].tagIds.length,1);
    await page.locator('.simple-add-task').click();await dialog.getByText('管理我的 Tags',{exact:true}).click();
    const manager=dialog.locator('details').filter({has:page.getByText('管理我的 Tags',{exact:true})});
    await manager.getByRole('button',{name:'改名',exact:true}).first().click();
    await manager.getByLabel('修改 個人',{exact:true}).fill('My Tag');await manager.getByRole('button',{name:'儲存',exact:true}).click();
    await dialog.getByRole('button',{name:'My Tag',exact:true}).waitFor();assert.ok(tasks[0].personal_tag_ids.includes(tags[0].id));
    const taskCount=tasks.length;
    await manager.getByRole('button',{name:'移除',exact:true}).first().click();await manager.getByRole('button',{name:'確認移除',exact:true}).click();
    await dialog.getByRole('button',{name:'My Tag',exact:true}).waitFor({state:'hidden'});assert.equal(tasks.length,taskCount);
    await manager.getByLabel('新 Tag 名稱').fill('學習');await manager.getByLabel('新 Tag 名稱').press('Enter');
    await dialog.getByRole('button',{name:'學習',exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await dialog.getByRole('button',{name:'關閉',exact:true}).click();
    await page.getByRole('tab',{name:/任務總表/}).click();
    await page.getByRole('button',{name:/P1 高 High/}).waitFor();
    assert.equal(await page.locator('.task-queue-row').count(),0,'queue starts collapsed');
    await page.getByRole('button',{name:/P1 高 High/}).click();
    await page.getByRole('link',{name:'未安排的高 Priority',exact:true}).waitFor();
    assert.equal(navigations,0,'typing, saving and switching tabs never reload the document');assert.deepEqual(errors,[]);
    console.log(`PASS simple-mode ${role} ${width}px: manual order, next task, max three, quiet, tags CRUD, draft/failure/retry, work dates, no reload`);
    await context.close();
  }
} finally {await browser?.close();server?.kill();}
