// Browser UI fixture; ALL API requests are intercepted. No live user data/writes.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const base=process.env.VERIFY_URL||'http://localhost:3143';
let logs='';
const server=process.env.VERIFY_URL?null:spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--hostname','127.0.0.1','-p','3143'],{env:{...process.env,NEXT_PUBLIC_SUPABASE_URL:'https://example.supabase.co',NEXT_PUBLIC_SUPABASE_ANON_KEY:'local-mock',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']});
server?.stdout.on('data',chunk=>{logs+=chunk;});server?.stderr.on('data',chunk=>{logs+=chunk;});
let browser;
try {
  if(server) for(let i=0;i<100;i++) {
    if(server.exitCode!==null) throw new Error(logs.slice(-2500));
    try {if((await fetch(`${base}/api/auth`)).status===401) break;}catch{}
    await new Promise(resolve=>setTimeout(resolve,400));
  }
  browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE||undefined});
  for(const [index,role] of ['Derek','Suki','Amigo'].entries()) for(const width of [360,1280]) {
    const context=await browser.newContext({viewport:{width,height:920},serviceWorkers:'block',acceptDownloads:true});
    const page=await context.newPage();page.setDefaultTimeout(18000);
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    const userId=`${index+1}1111111-1111-4111-8111-111111111111`;
    const tagId='99999999-9999-4999-8999-999999999999',taskId='88888888-8888-4888-8888-888888888888';
    const backup={format:'derek-control-panel-backup',version:1,ownerId:userId,exportedAt:'2026-11-14T00:00:00Z',app:{version:'fixture',environment:'test'},includes:['自己的 Tags'],excluded:['分享權限'],data:{tasks:[],personalTaskTags:[{id:tagId,user_id:userId,name:'學習',deleted_at:null}],taskTagAssignments:[{user_id:userId,task_id:taskId,tag_id:tagId}],taskTagPreferences:[{user_id:userId,initialized_at:'2026-11-14T00:00:00Z'}]}};
    let previewRequests=0,restoreRequests=0,bootstrapReads=0;
    await page.route('**/api/**',async route=>{
      const request=route.request(),url=new URL(request.url());let body={},status=200;
      if(url.pathname==='/api/auth') body={user:{id:userId}};
      else if(url.pathname==='/api/backup') {
        if(request.method()==='GET') return route.fulfill({status:200,headers:{'Content-Type':'application/json','Content-Disposition':'attachment; filename="fixture-backup.json"'},body:JSON.stringify(backup)});
        const input=request.postDataJSON();assert.deepEqual(input.backup,backup);
        if(input.action==='preview') {
          previewRequests++;
          body={version:1,ownerId:userId,exportedAt:backup.exportedAt,recordCounts:{personalTaskTags:1,taskTagAssignments:1,taskTagPreferences:1},conflicts:[{category:'personalTaskTags',count:1}],unsupported:[{category:'taskTagAssignments.unavailable',count:1,reason:'已無權讀取的任務不會重建分享權限。'}],canRestore:true};
        } else if(input.action==='restore') {
          assert.equal(input.confirmation,'RESTORE');assert.equal(input.acknowledged,true);restoreRequests++;
          if(restoreRequests===1){status=503;body={error:'驗證用連線中斷，未有資料改動；請重試。'};}
          else body={restored:{personalTaskTags:1,taskTagAssignments:1,taskTagPreferences:1}};
        } else throw new Error('Unexpected backup mutation');
      } else if(url.pathname==='/api/integrations/google-calendar') body={connections:[]};
      else if(url.pathname==='/api/control'&&url.searchParams.get('view')==='assignment_alerts') body={assignments:[],currentUserId:userId,quietModeUntil:null};
      else if(url.pathname==='/api/control'&&request.method()==='GET') {
        bootstrapReads++;
        body={currentUser:{id:userId,displayName:role},profile:{user_id:userId,display_name:role,workspace_role:role.toLowerCase(),active:true,is_admin:role==='Derek',timezone:'Asia/Hong_Kong'},settings:{theme:'sunrise'},tasks:[],transactions:[],meetings:[],balances:[],operatingItems:[],assignments:[],shares:[],handoffNotes:[],planning:[],participants:[],taskDependencies:[],projectMilestones:[],taskRecurrenceRules:[],capacity:null,notificationPreferences:null,notificationDeliveries:[],activePushSubscriptionCount:0,household:null,calendarConnections:[],taskNoticeRecipients:[],taskFollowers:[],showEncouragement:false};
      } else throw new Error(`Unexpected API request ${request.method()} ${url.pathname}`);
      await route.fulfill({status,json:body});
    });
    await page.goto(`${base}/settings`,{waitUntil:'domcontentloaded'});
    const panel=page.getByRole('region',{name:'你的資料備份及安全還原'});
    await panel.getByText('JSON 包括你自己的 Tags 同任務 Tags 連結',{exact:false}).waitFor();
    const downloadPromise=page.waitForEvent('download');await panel.getByRole('button',{name:'完整 JSON 備份',exact:true}).click();
    const download=await downloadPromise;const stream=await download.createReadStream();const chunks=[];for await(const chunk of stream)chunks.push(chunk);
    const downloaded=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    assert.deepEqual(downloaded.data,backup.data);assert.equal(downloaded.ownerId,userId);
    await panel.locator('input[type=file]').setInputFiles({name:'fixture-backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});
    await panel.getByText('任務 Tags 連結 1',{exact:true}).waitFor();assert.equal(previewRequests,1);assert.equal(restoreRequests,0);
    const restore=panel.getByRole('button',{name:'只新增，不覆蓋地還原',exact:true});
    assert.equal(await restore.isDisabled(),true);
    await panel.getByRole('checkbox').check();assert.equal(await restore.isDisabled(),true);
    await panel.getByRole('textbox',{name:'輸入 RESTORE 以啟用還原'}).fill('RESTORE');assert.equal(await restore.isEnabled(),true);
    if(process.env.SCREENSHOT_DIR){await mkdir(process.env.SCREENSHOT_DIR,{recursive:true});await panel.screenshot({path:`${process.env.SCREENSHOT_DIR}/backup-${role}-${width}.png`});}
    await restore.click();await panel.getByRole('status').filter({hasText:'驗證用連線中斷'}).waitFor();assert.equal(await restore.isEnabled(),true);
    const readsBefore=bootstrapReads;await restore.click();await panel.getByRole('status').filter({hasText:'已安全新增 3 項資料'}).waitFor();
    assert.equal(restoreRequests,2);assert.ok(bootstrapReads>readsBefore);assert.equal(await restore.count(),0);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
    console.log(`PASS backup-tags ${role} ${width}px: JSON tags, preview, two-step confirmation, failed restore retry and successful refresh`);
    await context.close();
  }
} finally {await browser?.close();server?.kill();}
