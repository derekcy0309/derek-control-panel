// Local browser fixture: account, Apple and Google data stay synthetic; no real writes.
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';

const origin=new URL(process.env.VERIFY_URL||'http://127.0.0.1:3218').origin;
assert.equal(new URL(origin).hostname,'127.0.0.1','Use a loopback Next server, never a deployed app.');
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE||undefined});

const userId='62111111-1111-4111-8111-111111111111', today='2026-11-24', now='2026-11-24T02:15:00Z';
const workSource='工作 · Google';
const googleEvent={id:'test-google-event',uid:'test-google-event',title:'工作 Google 測試行程',start:today+'T13:15:00+08:00',end:today+'T14:00:00+08:00',allDay:false,source:workSource};
const appleEvent={id:'test-apple-event',uid:'test-apple-event',title:'iPhone 測試行程',start:today+'T15:15:00+08:00',end:today+'T16:00:00+08:00',allDay:false,source:'Apple'};
const deadline={id:'42111111-1111-4111-8111-111111111111',title:'日序 Deadline 測試',due:today,priority:2,status:'not_started'};
const connection={id:'32111111-1111-4111-8111-111111111111',user_id:userId,target:'work',account_email:'work@example.test',calendar_id:'synthetic-work-calendar',calendar_name:'工作 Calendar 測試',status:'connected',last_error:null,last_synced_at:null,access_expires_at:null};
const snapshot={currentUser:{id:userId,email:'user@example.test',displayName:'Fixture'},profile:{user_id:userId,display_name:'Fixture',workspace_role:'general',active:true,is_admin:false,timezone:'Asia/Hong_Kong'},settings:{theme:'light'},tasks:[],taskCatalog:[],taskQueueCatalog:[],taskTags:[],taskNoticeRecipients:[],taskFollowers:[],planning:[],assignments:[],shares:[],participants:[],taskDependencies:[],capacity:null,capacityCommitments:[],weeklyAvailableMinutes:null,reminders:[],notificationPreferences:null,notificationDeliveries:[],calendarConnections:[connection],cashflowHint:null,showEncouragement:false};

try{
  for(const width of [360,1280]){
    const context=await browser.newContext({viewport:{width,height:920},serviceWorkers:'block',timezoneId:'Asia/Hong_Kong',locale:'zh-HK'});
    try{
      const page=await context.newPage(),errors=[],writes=[],unexpected=[];
      let enabled=false,mode='fresh',failNextWrite=false;
      page.setDefaultTimeout(20000);
      page.on('pageerror',error=>errors.push(error.message));
      await page.clock.setFixedTime(new Date(now));
      await page.route('**/*',async route=>{
        const request=route.request(),url=new URL(request.url()),p=url.pathname,method=request.method();
        if(url.origin!==origin||p.startsWith('/__nextjs'))return route.abort();
        if(!p.startsWith('/api/'))return route.continue();
        let status=200,json={};
        if(p==='/api/integrations/google-calendar'&&method==='POST'){
          const body=request.postDataJSON();writes.push(body);
          assert.deepEqual(body,{action:'set_work_agenda',target:'work',enabled:body.enabled,calendarId:connection.calendar_id,accountEmail:connection.account_email});
          assert.equal(typeof body.enabled,'boolean');
          if(failNextWrite){failNextWrite=false;status=503;json={error:'測試：暫時未能儲存設定。'};}
          else{enabled=body.enabled;json={connection:{...connection,show_work_in_agenda:enabled}};}
        }else if(p==='/api/integrations/apple-calendar'&&method==='POST'){
          assert.deepEqual(request.postDataJSON(),{action:'refresh'});
          json={sync:{state:'fresh'}};
        }else if(!['GET','HEAD'].includes(method)){
          unexpected.push(`${method} ${p}`);
          return route.abort();
        }else if(p==='/api/auth')json={user:{id:userId}};
        else if(p==='/api/control')json=url.searchParams.get('view')==='assignment_alerts'?{assignments:[],currentUserId:userId,quietModeUntil:null}:snapshot;
        else if(p==='/api/integrations/google-calendar')json={connections:[{...connection,show_work_in_agenda:enabled}]};
        else if(p==='/api/integrations/apple-calendar')json={connection:null};
        else if(p==='/api/calendar-brief'){
          assert.equal(url.searchParams.has('owner'),false,'Client cannot supply an owner for private calendar data.');
          if(url.searchParams.get('view')==='work-stop')json={generatedAt:now,events:[],incomplete:false,panelOnly:false};
          else{
            const sources=[{label:'Panel',state:'fresh',lastSync:now},{label:'Apple Calendar',state:'fresh',lastSync:now}];
            if(enabled)sources.push(mode==='stale'||mode==='reconnect'?{label:workSource,state:'stale',lastSync:null,errorCode:mode==='reconnect'?'GOOGLE_RECONNECT':'GOOGLE_UNAVAILABLE'}:{label:workSource,state:'fresh',lastSync:now});
            json={generatedAt:now,from:today,untilExclusive:'2026-11-27',days:[{date:today,events:enabled&&mode==='fresh'?[googleEvent,appleEvent]:[appleEvent],deadlines:[deadline]}],sources,truncated:false,text:'Synthetic private agenda'};
          }
        }else if(p==='/api/information')json={prefs:{journals:false,news:false,traffic:false},routes:[]};
        else if(p==='/api/start-links')json={links:[],shortcuts:[],ownerId:userId};
        else if(p==='/api/weather/hong-kong')json={observed:null,forecast:[],warnings:[],checkedAt:now};
        await route.fulfill({status,json});
      });
      const agenda=page.getByRole('region',{name:'行程同限期',exact:true});
      const refresh=agenda.getByRole('button',{name:'更新行程同限期',exact:true});
      const sourceDetails=agenda.getByText('日曆來源同設定',{exact:true});
      const toggle=page.locator('#google-calendar').getByRole('switch',{name:'在「行程同限期」顯示工作 Calendar',exact:true});
      const goHome=async()=>{
        await page.goto(origin+'/');
        await agenda.getByText(appleEvent.title,{exact:true}).waitFor();
        await agenda.getByText(deadline.title,{exact:true}).waitFor();
      };
      const assertFit=async()=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);

      await goHome();
      assert.equal(await agenda.getByText(googleEvent.title,{exact:true}).count(),0);
      await sourceDetails.click();
      assert.equal(await agenda.getByText(/^工作 · Google：/).count(),0);
      await agenda.getByRole('link',{name:'工作 Google Calendar 設定',exact:true}).click();
      await page.waitForURL('**/settings#google-calendar');
      await toggle.waitFor();
      assert.equal(await toggle.isChecked(),false);
      failNextWrite=true;
      await toggle.click();
      await page.getByRole('status').filter({hasText:'測試：暫時未能儲存設定。'}).waitFor();
      assert.equal(await toggle.isChecked(),false,'Rejected mutation must never leave a false success/checked state.');
      await toggle.click();
      await page.getByRole('status').filter({hasText:'已開啟。工作行程'}).waitFor();
      assert.equal(await toggle.isChecked(),true);
      await assertFit();

      await goHome();
      const googleRow=agenda.locator('.dl-event').filter({hasText:googleEvent.title});
      await googleRow.getByText(googleEvent.title,{exact:true}).waitFor();
      assert.match(await googleRow.innerText(),/工作 · Google.*唯讀/s);
      assert.equal(await googleRow.getByRole('link').count(),0,'Google-only events do not link to a writable Dayline event.');
      await assertFit();

      mode='stale';await refresh.click();
      await agenda.getByRole('alert').filter({hasText:'工作 · Google：暫時未能讀取'}).waitFor();
      assert.equal(await agenda.getByText(googleEvent.title,{exact:true}).count(),0);
      assert.equal(await agenda.getByText(appleEvent.title,{exact:true}).count(),1);
      assert.equal(await agenda.getByText(deadline.title,{exact:true}).count(),1);
      mode='empty';await refresh.click();await sourceDetails.click();
      await agenda.getByText(/^工作 · Google：已更新，呢三日冇可顯示嘅工作行程/).waitFor();
      assert.equal(await agenda.getByRole('alert').filter({hasText:workSource}).count(),0);

      mode='reconnect';await refresh.click();
      const expired=agenda.getByRole('alert').filter({hasText:'授權已失效，請重新連接'});
      await expired.getByRole('link',{name:'Google Calendar 設定',exact:true}).click();
      await toggle.waitFor();
      assert.equal(await toggle.isChecked(),true,'Saved opt-in persists when navigating back to Settings.');
      await toggle.click();
      await page.getByRole('status').filter({hasText:'已關閉工作行程顯示。'}).waitFor();
      assert.equal(await toggle.isChecked(),false);
      await goHome();
      await sourceDetails.click();
      assert.equal(await agenda.getByText(/^工作 · Google：/).count(),0);
      assert.equal(await agenda.getByText(googleEvent.title,{exact:true}).count(),0);
      assert.deepEqual(writes.map(write=>write.enabled),[true,true,false]);
      assert.deepEqual(unexpected,[]);
      assert.deepEqual(errors,[]);
      await assertFit();
      console.log(`PASS ${width}px: Google opt-in persistence, failed setting write, read-only row, provider failure vs empty, unaffected deadlines/iCloud and opt-out.`);
    }finally{await context.close();}
  }
}finally{await browser.close();}
