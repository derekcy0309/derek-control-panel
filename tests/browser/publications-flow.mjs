// In-process database and local browser only for real issued originals. Never upload these to a test service.
import assert from "node:assert/strict";
import {pathToFileURL} from "node:url";
export async function verifyJournalUI(db,A,B){
 const base=process.env.VERIFY_URL||"http://127.0.0.1:3193";
 if(!["127.0.0.1","localhost"].includes(new URL(base).hostname))throw Error("Use loopback for private sources.");
 const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:"playwright");
 const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE||undefined});
 let queue=Promise.resolve(),failDetail=false,readCalls=0;const errors=[];
 await db.exec("begin");
 async function context(actor,width){
 const ctx=await browser.newContext({viewport:{width,height:850},serviceWorkers:"block"});const page=await ctx.newPage();page.setDefaultTimeout(14000);page.on("pageerror",e=>errors.push(e.message));
 await page.route("**/*",async route=>{
  const url=new URL(route.request().url());if(url.origin!==new URL(base).origin)return route.abort();
  if(!url.pathname.startsWith("/api/"))return route.continue();
  const work=async()=>{
   await db.exec("reset role");await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);await db.exec("set role authenticated");
   const sql=async(q,args=[])=>(await db.query(q,args)).rows;
   const p=url.searchParams,req=route.request(),body=req.method()==="POST"?req.postDataJSON():null;
   let json={},status=200;
   if(url.pathname==="/api/auth")json={user:{id:actor}};
   else if(url.pathname==="/api/information"){if(body){await sql("select public.dayline_set_info($1,$2)",[body.choice,body.enabled]);json={ok:true};}else json={prefs:(await sql("select journals,news,traffic from public.dayline_info_choices where user_id=$1",[actor]))[0]??{journals:false,news:false,traffic:false}};}
   else if(url.pathname==="/api/publications/publisher")json={connections:[]};
   else if(url.pathname==="/api/publications"){if(body){if(body.action==="read")readCalls++;await sql("select public.dayline_issue_state($1,$2,$3,$4)",[body.id,body.action,body.wanted??null,body.seen??null]);json={ok:true};}
    else if(p.get("view")==="count")json={unread:(await sql("select public.dayline_unread() n"))[0].n};
    else if(p.get("view")==="issue"){if(failDetail){status=503;failDetail=false;}else {json={issue:(await sql("select public.dayline_issue($1) d",[p.get("id")]))[0].d};if(!json.issue)status=404;}}
    else json={items:(await sql("select v from public.dayline_issues($1,$2,$3,$4,$5) v",[p.get("category")||"all",p.get("month")||"",p.get("q")||"",p.get("mode")||"all",Number(p.get("offset")||0)])).map(x=>x.v),more:false};}
   else if(url.pathname==="/api/control"){const view=p.get("view");json=view==="assignment_alerts"?{assignments:[],currentUserId:actor}:{currentUser:{id:actor,displayName:"QA"},profile:{active:true,workspace_role:"derek"},settings:{theme:"light"},tasks:[],taskQueueCatalog:[],taskCatalog:[],taskTags:[],participants:[],taskFollowers:[],planning:[],assignments:[],shares:[],taskNoticeRecipients:[],taskDependencies:[],reminders:[],capacityCommitments:[]};}
   else if(url.pathname==="/api/calendar-brief")json={days:[],sources:[],warnings:[],text:"",generatedAt:new Date().toISOString()};
   else if(url.pathname==="/api/start-links")json={ownerId:actor,links:[]};
   return {json,status};
  };const result=queue.then(work);queue=result.then(()=>{},e=>{errors.push(e.message);});let data;try{data=await result;}catch{data={status:500,json:{error:"fixture error"}};}await route.fulfill(data).catch(()=>{});
 });return {ctx,page};
 }
 try{
  const {ctx,page}=await context(A,390);await page.goto(base+"/");await page.getByRole("heading",{name:/今日總覽/}).waitFor();assert.equal(await page.getByText(/刊物 · \d+ 期未讀/).count(),0);
  await page.goto(base+"/briefing/medical");await page.getByRole("checkbox",{name:/刊物/}).click();await page.getByLabel("閱讀狀態").waitFor();
  await page.goto(base+"/");await page.getByRole("link",{name:"刊物 · 5 期未讀"}).click();await page.getByLabel("閱讀狀態").waitFor();assert.equal(await page.getByLabel("閱讀狀態").inputValue(),"unread");
  await page.getByLabel("搜尋標題、全文").fill("BRCA");await page.getByRole("button",{name:"搜尋",exact:true}).click();
  const item=page.locator("article").filter({hasText:/NGO/}).first();await item.locator("blockquote").waitFor();assert.match(await item.locator("blockquote").innerText(),/brca/i);
  await item.getByRole("button",{name:/收藏/}).click();await item.getByRole("button",{name:/已收藏/}).waitFor();assert.equal(readCalls,0);
  const href=await item.getByRole("link").first().getAttribute("href");failDetail=true;await item.getByRole("link").first().click();await page.getByRole("alert").filter({hasText:"未能載入完整內文"}).waitFor();assert.equal(readCalls,0);
  await page.getByRole("button",{name:"重試",exact:true}).click();await page.locator("article small").filter({hasText:/^已讀$/}).waitFor();assert.equal(readCalls,1);
  const anchor=new URL(href,base).hash;assert.ok(anchor);assert.match(await page.locator(anchor).innerText(),/BRCA/i);assert.equal(await page.locator(anchor).evaluate(el=>document.activeElement===el),true);assert.equal(await page.locator("article a[href^='http']").count()>0,true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await ctx.close();const desktop=await context(A,1280);await desktop.page.goto(base+"/");await desktop.page.getByRole("link",{name:"刊物 · 4 期未讀"}).waitFor();
  await desktop.page.goto(base+"/briefing/publications?mode=saved");await desktop.page.locator("article").filter({hasText:/NGO/}).getByRole("button",{name:/已收藏/}).waitFor();assert.equal(await desktop.page.locator("article").count(),1);await desktop.ctx.close();
  const second=await context(B,360);await second.page.goto(base+"/briefing/medical");await second.page.getByRole("checkbox",{name:/刊物/}).click();await second.page.getByText("暫時冇已收錄嘅刊物符合條件。").waitFor();
  await second.page.goto(new URL(href,base).href);await second.page.getByRole("alert").filter({hasText:/未獲授權/}).waitFor();await second.ctx.close();
  assert.deepEqual(errors,[]);console.log("PASS local Chrome mobile 390/360 + desktop 1280: opt-in, homepage 5→4, failed open never marked read, list favourite, BRCA anchor, reopened favourite and separate account denied.");
 }finally{await browser.close();await queue;await db.exec("rollback;reset role");}
}
