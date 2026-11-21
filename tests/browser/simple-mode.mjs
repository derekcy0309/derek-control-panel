// End-to-end UI fixture; every account/data request is intercepted. No live writes.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const base = process.env.VERIFY_URL || 'http://localhost:3142';
// A button can accept clicks in Playwright even when its white label is invisible.
// Inspect the actual rendered button in each weekly palette, including dark mode.
async function assertSaveButtonReadable(button) {
  const results = await button.evaluate(el => {
    const shell=el.closest('.dl-shell'),root=document.documentElement;
    const originalPalette=shell.getAttribute('data-palette'),originalTheme=root.getAttribute('data-theme'),transition=el.style.transition;
    const ctx=document.createElement('canvas').getContext('2d',{willReadFrequently:true});
    const colour=value=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=value;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data];};
    const lum=rgb=>rgb.slice(0,3).map(v=>{const n=v/255;return n<=0.04045?n/12.92:((n+0.055)/1.055)**2.4;}).reduce((sum,v,i)=>sum+v*[0.2126,0.7152,0.0722][i],0);
    const restore=(node,key,value)=>value===null?node.removeAttribute(key):node.setAttribute(key,value);
    try {
      el.style.transition='none';const samples=[];
      for(const theme of ['light','dark']) for(const palette of ['mist','mint','mauve','almond']) {
        root.setAttribute('data-theme',theme);shell.setAttribute('data-palette',palette);
        const css=getComputedStyle(el),fg=colour(css.color),bg=colour(css.backgroundColor),a=lum(fg),b=lum(bg),box=el.getBoundingClientRect();
        samples.push({theme,palette,alpha:[fg[3],bg[3]],contrast:(Math.max(a,b)+.05)/(Math.min(a,b)+.05),target:box.width>=44&&box.height>=44&&box.left>=0&&box.right<=innerWidth});
      }return samples;
    }finally{restore(root,'data-theme',originalTheme);restore(shell,'data-palette',originalPalette);getComputedStyle(el).getPropertyValue('background-color');el.style.transition=transition;}
  });
  for(const item of results){assert.deepEqual(item.alpha,[255,255],item.theme+' '+item.palette+' needs a solid surface');assert.ok(item.contrast>=4.5,JSON.stringify(item));assert.ok(item.target,'save button should be on-screen and at least 44px');}
}
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
    const userId='11111111-1111-4111-8111-11111111111'+({Derek:'1',Suki:'2',Amigo:'3'}[role]);
    const fixtureNow=new Date(today+'T14:52:00+08:00'),pickup={id:'pickup',uid:'pickup',title:role+' 固定行程',start:today+'T15:30:00+08:00',end:today+'T16:00:00+08:00',source:'Panel',allDay:false};
    await page.clock.setFixedTime(fixtureNow);
    await context.addInitScript(()=>localStorage.setItem('dcp:work-stop:v1:different-user','99'));
    const names=role==='Derek'?['個人','Wecare','家庭','SEC']:['個人','Wecare'];
    let tags=names.map((name,i)=>({id:`99999999-9999-4999-8999-${String(i+1).padStart(12,'0')}`,name,legacy_key:null}));
    const makeTask=(id,title,values={})=>({id,user_id:userId,owner_id:userId,title,scope:'home',area:'personal',source_type:'follow_up',status:'not_started',due_date:null,follow_up_date:null,next_action:null,risk:'low',notes:null,completed_at:null,deleted_at:null,archived_at:null,created_at:`${today}T00:00:00Z`,updated_at:`${today}T00:00:00Z`,requested_priority:3,personal_tag_ids:[tags[0].id],...values});
    const tasks=[makeTask('22222222-2222-4222-8222-222222222221','我排第一件',{requested_priority:5}),makeTask('22222222-2222-4222-8222-222222222222','我排第二件',{requested_priority:1}),makeTask('22222222-2222-4222-8222-222222222223','未安排的高 Priority',{requested_priority:1}),makeTask('22222222-2222-4222-8222-222222222224','等文件回覆',{status:'waiting',waiting_for:'朋友'}),makeTask('22222222-2222-4222-8222-222222222225','依賴未完成',{requested_priority:1})];
    let planning=tasks.slice(0,2).map((task,i)=>({user_id:userId,resource_type:'task',resource_id:task.id,planned_date:today,plan_role:i?'later':'now',plan_source:'manual',plan_position:i+1}));
    let preferences=null;let createFailures=0;let creates=[];let navigations=0;let todayReads=0;const guideRecords=new Map();let guideWrites=0;
    const snapshot=()=>({currentUser:{id:userId,email:role==='Derek'?'derekcy0309@gmail.com':`${role.toLowerCase()}@example.test`,displayName:role},profile:{user_id:userId,display_name:role,workspace_role:role.toLowerCase(),active:true,is_admin:role==='Derek'},settings:{theme:'light',focus_minutes:25,gentle_mode:role==='Suki'},tasks,taskCatalog:tasks.filter(t=>t.status!=='done'),taskQueueCatalog:tasks,taskTags:tags,taskNoticeRecipients:[],taskFollowers:[],planning,assignments:[],shares:[],participants:[{user_id:userId,display_name:role},{user_id:'44444444-4444-4444-8444-444444444444',display_name:'現有用戶'}],taskDependencies:[{task_id:tasks[4].id,depends_on_task_id:'missing'}],capacity:null,capacityCommitments:[],weeklyAvailableMinutes:null,reminders:[],notificationPreferences:preferences,cashflowHint:null});
    await page.route('**/api/**',async route=>{
      const request=route.request();const url=new URL(request.url());let body={};let status=200;
      if(url.pathname==='/api/auth') body={user:{id:userId}};
      else if(url.pathname==='/api/weather/hong-kong') body={observed:{temperature:24,icon:51,at:fixtureNow.toISOString()},forecast:[{date:today,low:21,high:25,icon:50,description:'測試天晴'}],warnings:['測試警告'],checkedAt:fixtureNow.toISOString()};
      else if(url.pathname==='/api/calendar-brief') body={generatedAt:new Date().toISOString(),from:today,untilExclusive:today,days:[{date:today,events:[{id:"long-calendar-fixture",uid:"long-calendar-fixture",title:`${role} 跨日行程`,start:"2026-07-18",end:"2036-07-19",allDay:true,source:"Apple"}],deadlines:[{id:tasks[0].id,title:`${role} 私人 Deadline`,due:today,priority:1,status:'not_started'}]}],sources:[{label:'Panel',state:'fresh',lastSync:new Date().toISOString()},{label:'Apple Calendar',state:'not_connected',lastSync:null}],truncated:false,warnings:['請檢查來源 Calendar 結束日期（測試）'],text:'Fixture brief'};
      else if(request.method()==='GET') {
        const view=url.searchParams.get('view');
        if(view==='task_tags') body={tags,taskTagIds:tasks.find(t=>t.id===url.searchParams.get('taskId'))?.personal_tag_ids||[]};
        else if(view==='work_guide') body={steps:[],openChildren:false,checkpoint:guideRecords.get(url.searchParams.get('taskId'))??null};
        else if(view==='assignment_alerts') body={assignments:[],currentUserId:userId,quietModeUntil:null};
        else {if(view==='today')todayReads++;body=snapshot();}
      } else {
        const input=request.postDataJSON();
        if(input.action==='create_task') {
          creates.push(input);
          if(createFailures-->0) {status=503;body={error:'驗證用網絡失敗；請重試，草稿仍保留。'};}
          else {
            const task=makeTask(crypto.randomUUID(),input.title,{due_date:input.dueDate,requested_priority:input.requestedPriority,personal_tag_ids:input.tagIds??[],work_dates:input.workDates,work_start_date:input.workStartDate});tasks.push(task);body={task};
            if(input.addToToday) planning.push({user_id:userId,resource_type:'task',resource_id:task.id,planned_date:today,plan_role:'later',plan_source:'manual',plan_position:null});
          }
        } else if(input.action==='record_guide_step'){guideWrites++;const checkpoint={current_position:input.next?'開工導航：下次由呢一步接住':'開工導航：呢一步已做完，等你決定是否結案',next_minimum_step:input.next||null,completed_summary:input.completed};guideRecords.set(input.taskId,checkpoint);body={checkpoint};}
        else if(input.action==='update_task') {const task=tasks.find(t=>t.id===input.id);Object.assign(task,input.changes);body={task};}
        else if(input.action==='set_quiet_mode') {preferences={quiet_mode_until:input.until};body={ok:true};}
        else if(input.action==='manage_task_tag') {
          let tag=tags.find(t=>t.id===input.tagId);
          if(input.operation==='create'){tag={id:'88888888-8888-4888-8888-888888888888',name:input.name,legacy_key:null};tags.push(tag);}
          if(input.operation==='rename')tag.name=input.name;
          if(input.operation==='delete'){tags=tags.filter(t=>t.id!==input.tagId);for(const task of tasks)task.personal_tag_ids=task.personal_tag_ids.filter(id=>id!==input.tagId);}
          body={tag};
        } else throw new Error(`Unexpected write: ${input.action}`);
      }
      if(url.pathname==='/api/calendar-brief'){
        assert.equal(request.method(),'GET');
        if(url.searchParams.get('view')==='work-stop')body={generatedAt:fixtureNow.toISOString(),events:[{title:pickup.title,start:pickup.start,end:pickup.end}],incomplete:false,panelOnly:true};
        else{body.generatedAt=fixtureNow.toISOString();body.nextSchoolDate={id:'next-school',date:new Date(fixtureNow.getTime()+6*86400000).toISOString().slice(0,10),kind:'school',title:role+' 遠期限期'};body.days[0].events.push(pickup);body.familyDates=[{id:'fixture-school',kind:'school',date:today,title:role+' 學校回條'},{id:'fixture-family',kind:'family',date:today,title:role+' 家庭限期'}];}
      }
      await route.fulfill({status,json:body});
    });
    await page.goto(base,{waitUntil:'domcontentloaded'});
    await page.getByRole('heading',{name:'今日總覽',exact:true}).waitFor();
    await page.getByRole('heading',{name:'行程同限期',exact:true}).waitFor();
    await page.locator('.dl-event').filter({hasText:role+' 固定行程'}).waitFor();
    const firstEvent=await page.locator('.dl-event').first().boundingBox(),firstTask=await page.locator('.dl-focus').boundingBox();
    assert.ok(firstEvent && firstTask && firstEvent.y+firstEvent.height<=920);if(width<600)assert.ok(firstEvent.y>firstTask.y);else assert.ok(firstEvent.x>firstTask.x);
    assert.ok(await page.locator('.dl-calendarline').innerText().then(t=>t.includes('星期')));
    assert.equal(await page.getByRole('form',{name:'新增 Task'}).count(),0);
    await page.getByText('生效警告：測試警告',{exact:true}).waitFor();
    await page.getByRole('link',{name:new RegExp(role+' 遠期限期')}).waitFor();
    if(width<600){await page.getByRole('button',{name:'三日預報'}).click();await page.locator('.dl-forecast').waitFor();await page.getByRole('button',{name:'三日預報'}).click();}
    if(process.env.SCREENSHOT_DIR){await mkdir(process.env.SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:process.env.SCREENSHOT_DIR+'/dashboard-'+role+'-'+width+'.png',fullPage:false});}
    await page.getByText('幾點要收手／預留出門時間',{exact:true}).click();
    const stopHint=page.getByRole('region',{name:'幾點要收手',exact:true});await stopHint.getByText('15:10 收手 · 仲有 18 分鐘',{exact:true}).waitFor();
    await stopHint.getByText('預留時間：20 分鐘',{exact:true}).click();await stopHint.getByLabel('出門／準備要幾多分鐘？').fill('30');
    await stopHint.getByText('15:00 收手 · 仲有 8 分鐘',{exact:true}).waitFor();
    assert.equal(await page.evaluate(key=>localStorage.getItem(key),'dcp:work-stop:v1:'+userId),'30');

    await page.locator('.dl-more-rows > summary').first().click();
    await page.getByText(`${role} 私人 Deadline`,{exact:true}).waitFor();assert.equal(await page.getByRole('heading',{name:'行程同限期',exact:true}).count(),1);
    await page.getByText(/全日 · 2026年7月18日.*2036年7月18日/).waitFor();
    await page.getByRole('status').filter({hasText:'請檢查來源 Calendar 結束日期（測試）'}).waitFor();
    page.on('request',request=>{if(request.isNavigationRequest()&&request.frame()===page.mainFrame())navigations++;});
    assert.equal(await page.locator('.dl-focus, .dl-queue-list details').count(),2);
    assert.match(await page.locator('.dl-focus').innerText(),/我排第一件/);
    assert.equal(await page.getByText('能量',{exact:true}).count(),0);
    assert.equal(await page.getByText('依賴未完成',{exact:true}).count(),0);
    assert.equal(await page.locator('.dl-agenda a').filter({hasText:role+' 學校回條'}).getAttribute('href'),'/workspace/school#item-fixture-school');
    await page.locator('.dl-agenda a').filter({hasText:role+' 家庭限期'}).waitFor();
    assert.deepEqual(await page.locator('[aria-label="Dashboard Tags"] .simple-tag-filter').allTextContents(),['全部',...names]);
    if(process.env.SCREENSHOT_DIR){await mkdir(process.env.SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:`${process.env.SCREENSHOT_DIR}/${role}-${width}.png`,fullPage:true});}
    await page.getByRole('link',{name:'開始呢件事',exact:true}).click();
    const guide=page.locator('.work-guide');await guide.getByRole('heading',{name:'我排第一件',exact:true}).waitFor();
    await stopHint.getByText('15:00 收手 · 仲有 8 分鐘',{exact:true}).waitFor();
    await guide.getByRole('button',{name:'再細一步'}).click();await guide.getByRole('button',{name:'起咗步，接住做'}).click();assert.equal(guideWrites,0);
    await guide.getByRole('button',{name:'記低下次點接'}).click();await guide.getByLabel('下次返嚟做乜？').fill('只係本分頁嘅草稿');
    await guide.getByRole('link',{name:/返 Dashboard/}).click();await page.getByRole('link',{name:'開始呢件事',exact:true}).click();
    assert.equal(await guide.getByLabel('下次返嚟做乜？').inputValue(),'只係本分頁嘅草稿');await guide.getByRole('button',{name:'取消',exact:true}).click();
    assert.equal(guideWrites,0);
    await guide.getByRole('button',{name:'呢步搞掂'}).click();await guide.getByRole('status').filter({hasText:'成件 Task 未結案'}).waitFor();
    assert.equal(tasks[0].status,'not_started');assert.equal(guideWrites,1);
    await guide.getByRole('link',{name:/返 Dashboard/}).click();await page.getByRole('link',{name:'開始呢件事',exact:true}).click();
    await guide.getByText(guideRecords.get(tasks[0].id).next_minimum_step,{exact:true}).waitFor();
    await guide.getByRole('button',{name:'呢步搞掂'}).click();await guide.getByRole('button',{name:'確認整件完成'}).waitFor();assert.equal(tasks[0].status,'not_started');
    await guide.getByRole('button',{name:'確認整件完成'}).click();await guide.getByRole('heading',{name:'我排第二件',exact:true}).waitFor();
    await guide.getByRole('link',{name:/返 Dashboard/}).click();await page.locator('.dl-focus').waitFor();
    assert.equal(await page.locator('.dl-focus, .dl-queue-list details').count(),1);
    assert.match(await page.locator('.dl-focus').innerText(),/我排第二件/);
    await page.getByText('任務工具、提醒同篩選',{exact:true}).click();
    await page.getByRole('button',{name:'安靜模式',exact:true}).click();await page.getByRole('button',{name:'安靜中',exact:true}).waitFor();
    assert.ok(preferences.quiet_mode_until); // Per-account API; no other profile changes.
    await page.getByRole('button',{name:'加 Task',exact:true}).click();
    const dialog=page.getByRole('form',{name:'新增 Task',exact:true});
    assert.equal(await dialog.locator('input:visible,select:visible,textarea:visible').count(),1);
    const saveButton=dialog.getByRole('button',{name:'儲存任務',exact:true}),newTitle='簡易模式新增驗證';
    await dialog.getByLabel('任務名稱',{exact:true}).fill(newTitle);
    await dialog.locator('button[type="submit"]:enabled').waitFor();
    await assertSaveButtonReadable(saveButton);
    if(process.env.SCREENSHOT_DIR){await mkdir(process.env.SCREENSHOT_DIR,{recursive:true});await saveButton.scrollIntoViewIfNeeded();await page.screenshot({path:process.env.SCREENSHOT_DIR+'/save-'+role+'-'+width+'.png',animations:'disabled',style:'nextjs-portal{display:none!important}'});}
    await saveButton.click();
    await page.getByRole('status').filter({hasText:'Task 已儲存'}).waitFor();assert.equal(creates.length,1);assert.deepEqual(creates[0].tagIds,[tags[0].id]);assert.equal(creates[0].dueDate,null);assert.equal(creates[0].requestedPriority,3);
    const readsAfterSave=todayReads;
    await page.getByRole('tab',{name:/任務總表/}).click();
    await page.getByRole('searchbox',{name:'搜尋 Task'}).fill(newTitle);
    const queue=page.locator('#task-action-list');
    await queue.getByRole('button',{name:/^P2 一般 Normal/}).click();
    const newTask=queue.getByRole('link',{name:newTitle,exact:true});await newTask.waitFor();
    assert.equal(await newTask.count(),1);assert.equal(todayReads,readsAfterSave,'saved Task must appear in the list without another Today read');assert.equal(navigations,0);
    await page.getByRole('tab',{name:/今日重點/}).click();
    await dialog.getByRole('button',{name:/更改設定/}).click();assert.equal(await dialog.getByRole('button',{name:'個人',exact:true}).getAttribute('aria-pressed'),'true');
    await dialog.getByText('P3 低 Low',{exact:true}).click();
    await dialog.getByText('日期／邊個跟',{exact:false}).click();
    await dialog.getByRole('button',{name:'今日',exact:true}).click();
    assert.equal(await dialog.getByRole('radio',{name:'P3 低 Low',exact:true}).isChecked(),true);
    const readsBeforeTyping=todayReads;
    await dialog.getByLabel('任務名稱',{exact:true}).fill('草稿保留測試');
    assert.equal(todayReads,readsBeforeTyping);
    const draftAfterClose=await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)||'null'),`dcp:task-form-draft:v1:${userId}:new`);
    assert.equal(draftAfterClose?.title,'草稿保留測試','closing the form must retain the entered draft');
    await page.getByRole('link',{name:'開始呢件事',exact:true}).click();await guide.getByRole('link',{name:/返 Dashboard/}).click();
    await page.getByRole('button',{name:'加 Task',exact:true}).click();
    await dialog.getByRole('status').filter({hasText:'已恢復上次未送出的任務草稿'}).waitFor({state:'visible'});
    assert.equal(await dialog.getByLabel('任務名稱',{exact:true}).inputValue(),'草稿保留測試');
    await dialog.getByRole('button',{name:/更改設定/}).click();assert.equal(await dialog.getByRole('button',{name:'個人',exact:true}).getAttribute('aria-pressed'),'true');
    await dialog.getByText('更多設定',{exact:false}).click();
    await dialog.getByText('自訂哪幾日做／提醒',{exact:false}).click();
    await dialog.getByLabel('加入要做的日子').fill(today);await dialog.getByRole('button',{name:'加入',exact:true}).click();
    await dialog.getByRole('button',{name:`移除 ${today}`,exact:true}).waitFor();
    createFailures=1;await saveButton.click();
    await dialog.getByRole('alert').filter({hasText:'驗證用網絡失敗'}).waitFor();
    assert.equal(await dialog.getByLabel('任務名稱',{exact:true}).inputValue(),'草稿保留測試');
    await dialog.getByLabel('任務名稱',{exact:true}).press('Enter');await dialog.getByRole('button',{name:/更改設定/}).waitFor();assert.equal(creates.length,3);
    assert.equal(creates[1].clientRequestId,creates[2].clientRequestId);
    assert.equal(creates[2].requestedPriority,5);assert.equal(creates[2].energyLevel,undefined);assert.equal(creates[2].estimatedMinutes,undefined);
    assert.deepEqual(creates[2].workDates,[today]);assert.equal(creates[2].tagIds.length,1);
    await dialog.getByRole('button',{name:/更改設定/}).click();await dialog.getByText('管理我的 Tags',{exact:true}).click();
    const manager=dialog.locator('fieldset').filter({has:page.getByText('管理我的 Tags',{exact:true})}).locator('details');
    await manager.getByRole('button',{name:'改名',exact:true}).first().click();
    await manager.getByLabel('修改 個人',{exact:true}).fill('My Tag');await manager.getByRole('button',{name:'儲存',exact:true}).click();
    await dialog.getByRole('button',{name:'My Tag',exact:true}).waitFor();assert.ok(tasks[0].personal_tag_ids.includes(tags[0].id));
    const taskCount=tasks.length;
    await manager.getByRole('button',{name:'移除',exact:true}).first().click();await manager.getByRole('button',{name:'確認移除',exact:true}).click();
    await dialog.getByRole('button',{name:'My Tag',exact:true}).waitFor({state:'hidden'});assert.equal(tasks.length,taskCount);
    await manager.getByLabel('新 Tag 名稱').fill('學習');await manager.getByLabel('新 Tag 名稱').press('Enter');
    await dialog.getByRole('button',{name:'學習',exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await dialog.getByRole('button',{name:/收起設定/}).click();
    await page.getByRole('tab',{name:/任務總表/}).click();
    await page.getByRole('button',{name:/P1 高 High/}).waitFor();
    assert.equal(await page.locator('.task-queue-row').count(),0,'queue starts collapsed');
    await page.getByRole('button',{name:/P1 高 High/}).click();
    await page.getByRole('link',{name:'未安排的高 Priority',exact:true}).waitFor();
    assert.equal(navigations,0,'typing, saving and switching tabs never reload the document');assert.deepEqual(errors,[]);
    console.log(`PASS simple-mode ${role} ${width}px: visible save (8 palettes), click creates once and appears in task list without refresh, manual order, quiet, draft, keyboard retry`);
    await context.close();
  }
} finally {await browser?.close();server?.kill();}
