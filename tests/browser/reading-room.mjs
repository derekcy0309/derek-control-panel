// Remote build or local build; every application/account write is intercepted in this isolated context.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const base=process.env.VERIFY_URL||'http://localhost:3192';
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE||undefined});
const samples={local:'香港新聞 · 交通安排',markets:'Stock market today · 市場回顧',gadgets:'手機及平板新品',care:'社區照顧安排更新'};
const labels={local:'本地要聞',markets:'美股市場',gadgets:'手機及平板',care:'政策及服務'};
try{
 for(const [who,width] of [['Derek',390],['Suki',1280],['Amigo',360]]){
  const ctx=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'});const page=await ctx.newPage();page.setDefaultTimeout(15000);
  const id=who+'-fixture',links=[],shortcuts=['香港出行易','即時隧道費','香港天文台','Google Calendar','社署 CCSV 照顧券'].map((title,i)=>({title,id:who+'-preset-'+i,url:'https://example.test/preset/'+i,shelf:'site'})),errors=[],prefs={journals:false,news:false,traffic:false};let routes=['r3','cht','tm-in','tm-out','airport'],chartRequests=0,external=0,attempts=0;
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('tradingview')&&!r.url().startsWith(base))external++;});
  await page.route('**/api/**',async route=>{const req=route.request(),u=new URL(req.url()),method=req.method();let json={};
    if(u.pathname==='/api/market-chart'){chartRequests++;return route.continue();}
    if(u.pathname==='/api/auth')json={user:{id}};
    else if(u.pathname==='/api/information'){if(method==='POST'){const b=req.postDataJSON();if(Array.isArray(b.routes))routes=b.routes;else prefs[b.choice]=b.enabled;json={ok:true};}else json={prefs,routes};}
    else if(u.pathname==='/api/control')json=u.searchParams.get('view')==='assignment_alerts'?{assignments:[],currentUserId:id}:{currentUser:{id,displayName:who},profile:{active:true,workspace_role:who.toLowerCase()},settings:{theme:'light'},tasks:[],taskQueueCatalog:[],taskCatalog:[],taskTags:[],participants:[],taskFollowers:[],planning:[],assignments:[],shares:[],taskNoticeRecipients:[],taskDependencies:[],reminders:[],capacityCommitments:[]};
    else if(u.pathname==='/api/calendar-brief')json={days:[],sources:[],warnings:[],text:'',generatedAt:new Date().toISOString()};
    else if(u.pathname==='/api/start-links'&&method==='GET')json={links,shortcuts,ownerId:id};
    else if(u.pathname==='/api/start-links'&&method==='POST'){
     const b=req.postDataJSON();if(b.action==='remove'){for(const list of [links,shortcuts]){const i=list.findIndex(x=>x.id===b.id);if(i>=0)list.splice(i,1);}json={ok:true};}
     else{attempts++;if(attempts===1)return route.fulfill({status:503,json:{error:'測試連線失敗，請重試。'}});const s={id:who+':'+b.url,title:b.title,url:new URL(b.url.includes('://')?b.url:'https://'+b.url).href,shelf:b.shelf};if(!links.some(x=>x.id===s.id))links.unshift(s);json={link:s};}
    }else if(u.pathname==='/api/hk-traffic'){const at=new Date().toISOString(),vehicle=u.searchParams.get('vehicle');json={at,vehicle,period:'weekday',variableOK:true,fixedOK:true,roads:[{key:'SJ5:TWTM',origin:'SJ5',start:'屯門公路南行（井財街）',dest:'荃灣西',area:'新界',status:'slow',minutes:19,at}],spots:[{id:'TDS90020',label:'汀九・西行入屯門',kph:65,at}],notices:[],tolls:['海底隧道','東區海底隧道','西區海底隧道','大欖隧道'].map((name,i)=>({name,fee:vehicle==='MC'?12+i:30+i,variable:true,until:new Date(Date.now()+3600000).toISOString(),revised:'2026-01-01'}))};}
    else if(u.pathname==='/api/briefing'){const section=u.searchParams.get('section');const now=new Date().toISOString();json={section,checkedAt:now,groups:[{label:labels[section],source:'測試來源',sourceUrl:'https://example.test/',state:'ok',stories:[{title:samples[section],source:'測試來源',url:'https://example.test/'+section,date:now}]}],...(who==='Derek'&&['markets','care'].includes(section)?{original:{label:section==='markets'?'我嘅美股晚報':'我嘅居家護理市場報告',conversation:'測試對話名稱',topic:section}}:{})};}
    else if(!['GET','HEAD'].includes(method))throw Error('Unexpected mutation');return route.fulfill({json});});
  await page.goto(base+'/briefing/library');const useful=page.getByLabel('Useful Links 常用捷徑');await useful.getByRole('link',{name:'即時隧道費',exact:true}).waitFor();assert.equal(await useful.locator('a').count(),5);await page.getByRole('button',{name:'加網址',exact:true}).click();
  await page.getByRole('textbox',{name:'網址',exact:true}).fill('example.com');await page.getByRole('textbox',{name:'名稱（可留空）'}).fill(who+' 常用網站');
  await page.getByRole('button',{name:'儲存收藏'}).click();await page.getByRole('alert').filter({hasText:'測試連線失敗'}).waitFor();assert.equal(await page.getByRole('textbox',{name:'網址',exact:true}).inputValue(),'example.com');await page.getByRole('button',{name:'儲存收藏'}).click();
  await page.getByRole('link',{name:who+' 常用網站'}).waitFor();await page.reload();await page.getByRole('link',{name:who+' 常用網站'}).waitFor();
  await page.getByRole('button',{name:'整理捷徑'}).click();await page.getByRole('button',{name:'移除 即時隧道費'}).click();await page.getByRole('button',{name:'確定',exact:true}).click();await page.reload();await useful.getByRole('link',{name:'香港天文台'}).waitFor();assert.equal(await useful.getByRole('link',{name:'即時隧道費'}).count(),0);
  await page.locator('nav[aria-label="資訊分類"]').getByRole('link',{name:'資訊設定'}).click();assert.equal(await page.getByRole('checkbox',{name:'交通路況'}).count(),0);await page.getByRole('checkbox',{name:'公開新聞'}).click();await page.waitForFunction(()=>[...document.querySelectorAll('input[type=checkbox]')].some(e=>e.checked));
  await page.locator('nav[aria-label="資訊分類"]').getByRole('link',{name:'美股・港股'}).click();await page.getByText('美股／港股速讀',{exact:true}).waitFor();
  assert.equal(external,0);assert.equal(chartRequests,0);const memberRead=page.waitForRequest(r=>r.url().includes('/api/market-chart?index='));await page.getByRole('button',{name:'載入走勢圖'}).click();await memberRead;await page.locator('.dl-chart').waitFor({state:'attached'});assert.ok(chartRequests>0);
  await page.getByRole('button',{name:'收起圖表'}).click();await page.locator('nav[aria-label="資訊分類"]').getByRole('link',{name:'香港新聞'}).click();
  await page.getByRole('button',{name:samples.local+'，稍後睇'}).click();await page.getByText('已收藏',{exact:true}).waitFor();
  if(process.env.SCREENSHOT_DIR){await mkdir(process.env.SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:process.env.SCREENSHOT_DIR+'/reading-'+width+'.png',fullPage:true});}
  await page.locator('nav[aria-label="資訊分類"]').getByRole('link',{name:'我的收藏'}).click();await page.getByRole('button',{name:'稍後睇',exact:true}).click();assert.equal(await page.getByRole('link',{name:samples.local}).getAttribute('href'),'https://example.test/local');
  await page.getByRole('button',{name:'移除 '+samples.local}).click();await page.getByRole('button',{name:'確定',exact:true}).click();await page.getByText('未有留低嘅報道。',{exact:false}).waitFor();
  for(const [key,name] of [['gadgets','手機・Tablet'],['care','居家護理市場']]){await page.locator('nav[aria-label="資訊分類"]').getByRole('link',{name}).click();await page.getByRole('link',{name:samples[key],exact:true}).waitFor();}
  await page.locator('nav[aria-label="資訊分類"]').getByRole('link',{name:'交通路況'}).click();await page.getByText('較慢 · 約 19 分鐘',{exact:true}).waitFor();await page.getByText('65 km/h',{exact:true}).waitFor();await page.getByText('HK$ 30',{exact:true}).waitFor();await page.getByLabel('車種',{exact:true}).selectOption('MC');await page.getByText('HK$ 12',{exact:true}).waitFor();
  await page.getByRole('button',{name:'揀路段'}).click();await page.getByRole('checkbox',{name:'紅隧過海（來回）'}).uncheck();await page.getByRole('button',{name:'儲存路段'}).click();await page.getByText('已儲存路段。').waitFor();await page.reload();await page.getByText('65 km/h',{exact:true}).waitFor();assert.equal(await page.getByLabel('我揀嘅道路').getByText('紅隧過海（來回）').count(),0);
  const saveToggle=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/information'&&r.request().method()==='POST'&&r.ok());await page.getByRole('checkbox',{name:'喺我嘅首頁最底顯示交通實況'}).click();await saveToggle;await page.waitForFunction(()=>document.querySelector('.dl-road-toggle input')?.checked);assert.equal(prefs.journals,false);
  await page.goto(base+'/');await page.getByRole('heading',{name:/今日總覽/}).waitFor();const board=page.locator('.dl-traffic-mini');await board.getByText('65 km/h',{exact:true}).waitFor();assert.equal(await board.locator('.dl-home-fares li').count(),4);
  assert.ok(await board.evaluate(el=>el.nextElementSibling?.matches('footer.dl-footer')));assert.equal(await board.getByText('紅隧過海（來回）',{exact:true}).count(),0);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);console.log('PASS reading room '+who+' '+width+'px: editable default + custom private shortcuts, retries, private route presets, four fares and dashboard footer, original news + privacy.');await ctx.close();
 }
}finally{await browser.close();}
