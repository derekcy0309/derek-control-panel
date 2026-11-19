import assert from 'node:assert/strict';
const g='11111111-1111-4111-8111-111111111111',second='22222222-2222-4222-8222-222222222222',id='33333333-3333-4333-8333-333333333333';
export function schoolReviewFixture(){
  const state={};
  function reset(){Object.assign(state,{mode:'off',pending:[{id,grant_id:g,operation:'update',before_fields:{title:'虛構通告',date:'2026-11-20'},changes:{date:'2026-11-23'}}],stepup:false,applied:0,codes:0});}reset();
  async function respond(route){
    const req=route.request();let result,status=200;
    if(req.method()==='GET')result={grants:[{id:g,label:'測試助手',mode:'redact'},{id:second,label:'另一個 bot',mode:state.mode}],pending:state.pending,more:false};
    else {const body=req.postDataJSON();
      if(body.action==='scope'){assert.equal(body.id,second);state.mode=body.mode;result={status:body.mode};}
      else if(body.action==='newCode'){assert.equal(body.mode,'omit');state.codes++;result={id:second,accessCode:'fixture-code-displayed-once'};}
      else {assert.equal(body.action,'approve');assert.equal(body.id,id);
        if(!state.stepup){status=401;result={error:'請先用本人帳戶重新登入，再返嚟確認。',reauth:true};}
        else{state.applied++;state.pending=[];result={status:'approved'};}
      }
    }return route.fulfill({status,json:result});
  }
  return {reset,respond,state};
}
export async function testSchoolReview(page,base,fixture){
  await page.goto(base+'/workspace/school',{waitUntil:'domcontentloaded'});
  const panel=page.getByRole('region',{name:'Bot 建議 · 等我確認'});
  await panel.getByRole('button',{name:/測試助手 建議修改/}).waitFor();
  await panel.getByText('管理邊個 bot 可以用',{exact:true}).click();
  const select=panel.getByRole('combobox',{name:'另一個 bot 學校授權',exact:true});await select.selectOption('omit');
  await panel.getByRole('button',{name:'儲存此授權'}).last().click();await panel.getByText('已儲存呢個 bot 嘅學校授權。').waitFor();
  await panel.getByText('俾另一個 bot：建立只限學校嘅 Code',{exact:true}).click();await panel.getByLabel('Bot 名稱').fill('第三個測試 bot');
  await panel.getByRole('button',{name:'確認開放，建立獨立 Code'}).click();const code=panel.getByLabel('學校 Bot Access Code（只顯示今次）');await code.waitFor();
  assert.equal(await code.getAttribute('type'),'password');assert.equal(fixture.state.codes,1);
  await panel.getByRole('button',{name:'已保存，收起'}).click();assert.equal(await code.count(),0);
  await panel.getByRole('button',{name:/測試助手 建議修改/}).click();for(const date of ['2026-11-20','2026-11-23'])await panel.getByText('日期：'+date).waitFor();
  assert.equal(fixture.state.applied,0);await panel.getByRole('button',{name:'本人確認修改'}).click();await panel.getByRole('button',{name:'用 Google 重新登入，再確認'}).waitFor();assert.equal(fixture.state.applied,0);
  fixture.state.stepup=true;
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await panel.getByRole('button',{name:'本人確認修改'}).click();await page.getByText('暫時冇建議等你確認。').waitFor();assert.equal(fixture.state.applied,1);
  console.log('PASS school owner UI: second bot scoped separately, school-only code, human diff and recent login, width '+page.viewportSize().width);
}
