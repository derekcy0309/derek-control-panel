// Frozen-clock UI fixtures only. No real account, income or expense is read/written.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const base=process.env.VERIFY_URL||'http://localhost:3148';
let logs='',browser;
const server=process.env.VERIFY_URL?null:spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--hostname','127.0.0.1','-p','3148'],{env:{...process.env,NEXT_PUBLIC_SUPABASE_URL:'https://example.supabase.co',NEXT_PUBLIC_SUPABASE_ANON_KEY:'fixture',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']});
server?.stdout.on('data',value=>{logs+=value;});server?.stderr.on('data',value=>{logs+=value;});
try{
 if(server)for(let i=0;i<100;i++){if(server.exitCode!==null)throw new Error(logs.slice(-1500));try{if((await fetch(base+'/api/auth')).status===401)break;}catch{}await new Promise(resolve=>setTimeout(resolve,400));}
 browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE||undefined});
 for(const width of [360,1280])for(const [clock,expected] of [
  ['2026-11-24T15:59:59.999Z','2026-11'],
  ['2026-11-24T16:00:00.000Z','2026-12'],
  ['2026-12-24T16:00:00.000Z','2027-01']
 ]){
  // Deliberately not Hong Kong: the cutoff must not depend on device timezone.
  const context=await browser.newContext({viewport:{width,height:920},timezoneId:'America/New_York',serviceWorkers:'block'}),page=await context.newPage();
  page.setDefaultTimeout(20000);await page.clock.setFixedTime(new Date(clock));
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const id='11111111-1111-4111-8111-111111111111';let mutations=0;
  await page.route('**/api/**',async route=>{
   const request=route.request(),url=new URL(request.url());if(request.method()!=='GET')mutations++;
   const body=url.pathname==='/api/auth'?{user:{id}}:url.searchParams.get('view')==='assignment_alerts'?{assignments:[],currentUserId:id,quietModeUntil:null}:{currentUser:{id,displayName:'Derek'},profile:{user_id:id,display_name:'Derek',workspace_role:'derek',active:true,is_admin:true},settings:{theme:'light'},tasks:[],transactions:[],recurringExpenseRules:[],recurringIncomeRules:[],meetings:[],balances:[],participants:[],assignments:[],shares:[],notificationPreferences:null};
   await route.fulfill({status:200,json:body});
  });
  await page.goto(base+'/cashflow',{waitUntil:'domcontentloaded'});
  const month=page.getByLabel('月份',{exact:true});await month.waitFor();assert.equal(await month.inputValue(),expected);
  await month.fill('2026-08');assert.equal(await month.inputValue(),'2026-08');
  await page.getByRole('heading',{name:'家庭現金流',exact:true}).waitFor();
  await page.getByRole('heading',{name:'工作現金流',exact:true}).waitFor();
  assert.equal(mutations,0,'Changing the viewed month must not write any financial data');assert.deepEqual(errors,[]);
  console.log(`PASS cashflow ${width}px ${clock}: default ${expected}, manual selection preserved, no data writes`);await context.close();
 }
}catch(error){throw new Error(`${error.message}\n${logs.slice(-1800)}`,{cause:error});}
finally{await browser?.close();server?.kill();}
