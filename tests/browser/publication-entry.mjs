// Synthetic-only checks: no real articles, memberships, preferences or read receipts.
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const issue = "aabbccdd-1111-4222-8333-444455556666", user = "11111111-1111-4111-8111-111111111111";
const title = "測試刊物・定位用", revision = "e".repeat(64);
const control = { currentUser: {id:user,displayName:"QA"}, profile:{active:true,workspace_role:"derek"},
  settings:{theme:"light"}, tasks:[], taskQueueCatalog:[], taskCatalog:[], taskTags:[], participants:[],
  taskFollowers:[], planning:[], assignments:[], shares:[], taskNoticeRecipients:[], taskDependencies:[], reminders:[], capacityCommitments:[] };
const detail = { id:issue, title, revision, series:"ngo", published:"2026-11-21", from:"2026-11-08", until:"2026-11-21", version:1, read:false, saved:true,
  blocks:["第一段","第二段","要返到呢一段"].map(text=>({text,heading:false,links:[]})) };
const renderFrames = page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));

async function fixture(browser, base, width, options={}) {
  const ctx = await browser.newContext({ viewport:{width,height:850}, serviceWorkers:"block" });
  const page = await ctx.newPage(); page.setDefaultTimeout(20000);
  const state = { signedIn:options.signedIn??true, journals:options.journals??true, denied:false,
    countStatus:503, count:0, counts:0, details:0, lists:0, reads:[], logins:[], errors:[] };
  page.on("pageerror",error=>state.errors.push(error.message));
  const local = options.localOAuth===true;
  if(local) assert.ok(["localhost","127.0.0.1"].includes(new URL(base).hostname));
  await page.route("**/api/**",async route=>{
    const req=route.request(), url=new URL(req.url()), path=url.pathname;
    if(url.origin!==new URL(base).origin)return route.abort();
    let json={}, status=200;
    if(path==="/api/auth/google"&&req.method()==="POST"){
      state.logins.push(req.postDataJSON());
      if(local)return route.continue();
      // Hosted smoke tests check the rendered app; never initiate a real OAuth session.
      state.signedIn=true; json={url:new URL(options.expected,base).href};
    } else if(path==="/api/auth"||path.startsWith("/api/auth/google/")){
      if(local)return route.continue();
      status=state.signedIn?200:401; json=state.signedIn?{user:{id:user}}:{error:"測試：未登入"};
    } else if(path==="/api/information")json={prefs:{journals:state.journals,news:false,traffic:false}};
    else if(path==="/api/control")json=url.searchParams.get("view")==="assignment_alerts"?{assignments:[],currentUserId:user}:control;
    else if(path==="/api/start-links")json={ownerId:user,links:[]};
    else if(path==="/api/calendar-brief")json={days:[],sources:[],warnings:[],text:"",generatedAt:new Date().toISOString()};
    else if(path==="/api/publications"){
      if(req.method()==="POST"){state.reads.push(req.postDataJSON());json={ok:true};}
      else if(url.searchParams.get("view")==="count"){state.counts++;status=state.countStatus;json={unread:state.count};}
      else if(url.searchParams.get("view")==="issue"){state.details++;status=state.denied?404:200;json=state.denied?{error:"未獲授權"}:{issue:detail};}
      else {state.lists++;json={items:[],more:false};}
    }
    await route.fulfill({status,json});
  });
  return {ctx,page,state};
}

export async function verifyPublicationReturn(browser,base,width,{localOAuth=false,denied=false}={}) {
  const path="/briefing/medical", expected=path+"?issue="+issue+"&mode=saved&at=p-2#p-2";
  const {ctx,page,state}=await fixture(browser,base,width,{localOAuth,signedIn:false,expected});
  try {
    state.denied=denied;
    await page.goto(base+path+"?q=private-search&issue="+issue+"&mode=saved&at=p-2&discard=private#p-2");
    const google=page.getByRole("button",{name:"使用 Google 登入",exact:true}); await google.waitFor();
    assert.equal(state.details,0); assert.deepEqual(state.reads,[]);
    assert.equal(await page.getByRole("link",{name:/AI Agent/}).isVisible(),false);
    await page.getByText("其他登入方法（後備）",{exact:true}).click();
    assert.equal(await page.getByRole("link",{name:/AI Agent/}).getAttribute("href"),"/agent");
    await page.getByText("其他登入方法（後備）",{exact:true}).click();
    await google.click();
    if(denied) {
      await page.getByRole("alert").filter({hasText:/未獲授權/}).waitFor();
      assert.deepEqual(state.reads,[]); assert.equal(await page.getByText(title).count(),0);
    } else {
      await page.locator("article small").filter({hasText:/^已讀$/}).waitFor();
      assert.equal(await page.locator("#p-2").innerText(),"要返到呢一段");
      assert.equal(await page.locator("#p-2").evaluate(el=>document.activeElement===el),true);
      assert.deepEqual(state.reads,[{id:issue,action:"read",seen:revision}]);
    }
    assert.deepEqual(state.logins,[{next:expected}]); assert.equal(page.url(),base+expected);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    assert.deepEqual(state.errors,[]);
    console.log("PASS publication entry:",width,"px,",denied?"unavailable: no content or read receipt":"original paragraph focused, only one receipt",localOAuth?"(real local callback)":"(hosted UI, simulated sign-in)");
  }finally{await ctx.close();}
}

export async function verifyUnreadHint(browser,base,width) {
  const {ctx,page,state}=await fixture(browser,base,width,{journals:false});
  try {
    const info=page.waitForResponse(r=>new URL(r.url()).pathname==="/api/information");
    await page.goto(base+"/");await info;await page.getByRole("heading",{name:/今日總覽/}).waitFor();await renderFrames(page);
    assert.equal(state.counts,0);assert.equal(await page.locator(".dl-pub-line").count(),0);
    state.journals=true;await page.reload();
    const retry=page.getByRole("button",{name:"刊物未能更新 · 重試",exact:true});
    await retry.waitFor();assert.equal(await page.locator(".dl-pub-line").count(),1);
    // A bad successful payload also must not disappear as if the count was zero.
    state.countStatus=200;state.count=-1;
    const bad=page.waitForResponse(r=>r.url().includes("view=count"));await retry.click();await bad;await renderFrames(page);await retry.waitFor();
    state.count=2;await retry.click();
    const link=page.getByRole("link",{name:"刊物 · 2 期未讀",exact:true});await link.waitFor();
    assert.equal(await link.getAttribute("href"),"/briefing/publications?mode=unread");
    assert.deepEqual(state.reads,[]);assert.equal(state.details,0);
    await ctx.setOffline(true);await page.getByRole("status").filter({hasText:"刊物 · 連線後會再更新"}).waitFor();
    state.count=0;const ok=page.waitForResponse(r=>r.url().includes("view=count")&&r.ok());
    await ctx.setOffline(false);await ok;await page.locator(".dl-pub-line").waitFor({state:"detached"});
    state.count=1;await page.evaluate(()=>window.dispatchEvent(new Event("focus")));
    await page.getByRole("link",{name:"刊物 · 1 期未讀",exact:true}).click();
    assert.equal(await page.getByLabel("閱讀狀態").inputValue(),"unread");
    assert.equal(state.details,0);assert.deepEqual(state.reads,[]);assert.deepEqual(state.errors,[]);
    console.log("PASS unread hint:",width,"px, opt-out no request; failure → invalid count → retry → positive; offline → reconnect to zero; list never marks read");
  }finally{await ctx.close();}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const base=process.env.VERIFY_URL;assert.ok(base,"Set VERIFY_URL");
  const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:"playwright");
  const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE||undefined});
  try{for(const w of [390,1280]){await verifyPublicationReturn(browser,base,w);await verifyUnreadHint(browser,base,w);}
    await verifyPublicationReturn(browser,base,390,{denied:true});}finally{await browser.close();}
}
