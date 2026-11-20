const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const source=fs.readFileSync(path.join(__dirname,'../course-assistant.user.js'),'utf8');
const fixture=`<!doctype html><html><head><meta charset="utf-8"></head><body>
<h1>课程演示页</h1><input placeholder="普通搜索框，不应识别成题目">
<fieldset id="single"><legend>1 + 1 等于多少？</legend><label><input type="radio" name="single" value="1">A. 1</label><label><input type="radio" name="single" value="2">B. 2</label></fieldset>
<fieldset id="multi"><legend>选择偶数</legend><label><input type="checkbox" value="2">A. 2</label><label><input type="checkbox" checked value="3">B. 3</label><label><input type="checkbox" value="4">C. 4</label></fieldset>
<fieldset id="text"><legend>太阳从哪边升起？</legend><textarea></textarea></fieldset>
<fieldset hidden><legend>隐藏题</legend><input type="radio"></fieldset>
<fieldset><legend>只读题</legend><textarea readonly></textarea></fieldset>
<iframe srcdoc="<fieldset><legend>同源框架题</legend><label><input type='radio' name='frame'>A. 正确</label><label><input type='radio' name='frame'>B. 错误</label></fieldset>"></iframe>
<video id="video" style="width:260px;height:150px"></video>
</body></html>`;
let browser;
before(async()=>{
  const edge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_BROWSER_PATH?{executablePath:process.env.PLAYWRIGHT_BROWSER_PATH}:process.platform==='win32'&&fs.existsSync(edge)?{executablePath:edge}:{})});
});
after(async()=>{await browser?.close();});
async function pageFor(t){
  const context=await browser.newContext({viewport:{width:1100,height:980}});t.after(()=>context.close());
  const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await context.route('**/*',route=>route.request().isNavigationRequest()?route.fulfill({contentType:'text/html',body:fixture}):route.abort());
  await context.addInitScript(()=>{
    window.__requests=[];window.__delay=0;window.__apiReply='回答 <img src=x onerror=alert(1)>';window.__apiStatus=200;window.__aborts=0;window.__plays=0;
    const storage=()=>JSON.parse(localStorage.getItem('test-GM')||'{}');
    window.GM_getValue=(key,fallback)=>storage()[key]??fallback;
    window.GM_setValue=(key,value)=>{const all=storage();all[key]=value;localStorage.setItem('test-GM',JSON.stringify(all));};
    window.GM_xmlhttpRequest=options=>{
      window.__requests.push({url:options.url,data:options.data,headers:options.headers});
      const timer=setTimeout(()=>{
        let response;
        if(options.url.endsWith('/models'))response={data:[{id:'deepseek-flash'},{id:'test-model'}]};
        else{
          const data=JSON.parse(options.data);let content=window.__apiReply;
          if(data.response_format){const q=JSON.parse(data.messages.at(-1).content);content=JSON.stringify({answers:q.type==='multiple'?['A','C']:q.type==='text'?['东']:['B'],explanation:'测试解析'});}
          response={choices:[{finish_reason:'stop',message:{content}}]};
        }
        options.onload({status:window.__apiStatus,responseText:JSON.stringify(response)});
      },window.__delay);
      return {abort(){clearTimeout(timer);window.__aborts++;options.onabort?.();}};
    };
    HTMLMediaElement.prototype.play=function(){window.__plays++;Object.defineProperty(this,'paused',{configurable:true,value:false});return Promise.resolve();};
    HTMLMediaElement.prototype.pause=function(){Object.defineProperty(this,'paused',{configurable:true,value:true});};
  });
  await page.goto('https://i.chaoxing.com/demo');await page.addScriptTag({content:source});await page.getByRole('navigation').waitFor();
  t.after(()=>assert.deepEqual(errors,[],'No browser runtime errors'));
  return page;
}
async function tab(page,name){await page.getByRole('navigation').getByRole('button',{name,exact:true}).click();}
async function configure(page){await tab(page,'设置');await page.getByLabel('DeepSeek API Key',{exact:true}).fill('test-only-key');await page.getByRole('button',{name:'保存设置',exact:true}).click();}
const notice=page=>page.locator('#notice');

test('all eight panels render; width adapts; collapse and reopen preserve the UI',async t=>{
  const page=await pageFor(t);
  for(const name of ['视频','队列','题目','AI','刷新','设置','记录','概览']){await tab(page,name);assert.equal(await page.getByRole('navigation').getByRole('button',{name,exact:true}).getAttribute('aria-pressed'),'true');}
  fs.mkdirSync(path.join(__dirname,'../test-results'),{recursive:true});
  await page.locator('#window').screenshot({path:path.join(__dirname,'../test-results/overview.png')});
  await page.setViewportSize({width:390,height:844});const box=await page.locator('#window').boundingBox();assert.ok(box.x>=0&&box.x+box.width<=390);
  await page.getByRole('button',{name:'收起面板'}).click();assert.equal(await page.locator('#window').isVisible(),false);
  await page.getByRole('button',{name:'展开课程助手'}).click();assert.equal(await page.locator('#window').isVisible(),true);
});
test('scan includes native questions and same-origin frames, excludes ordinary and readonly forms',async t=>{
  const page=await pageFor(t);await tab(page,'题目');await page.getByRole('button',{name:'扫描本页',exact:true}).click();
  assert.equal(await page.locator('.question').count(),4);await page.getByLabel('搜索已扫描题目').fill('偶数');assert.equal(await page.locator('.question').count(),1);
});
test('AI analysis fills native answers, corrects wrong checks, and does not submit a form',async t=>{
  const page=await pageFor(t);await configure(page);await tab(page,'题目');await page.getByRole('button',{name:'扫描本页',exact:true}).click();
  await page.getByText('分析后填入已匹配的答案（不提交）',{exact:true}).click();await page.getByRole('button',{name:'分析全部',exact:true}).click();
  await page.waitForFunction(()=>document.getElementById('course-assistant-root').shadowRoot.getElementById('notice').textContent.includes('分析结束'));
  assert.equal(await page.locator('#single input[value="2"]').isChecked(),true);
  assert.equal(await page.locator('#multi input[value="3"]').isChecked(),false);assert.equal(await page.locator('#multi input[value="4"]').isChecked(),true);
  assert.equal(await page.locator('#text textarea').inputValue(),'东');
  assert.equal(await page.evaluate(()=>window.__requests.length),4);
  await page.getByRole('button',{name:'分析全部',exact:true}).click();
  await page.waitForFunction(()=>document.getElementById('course-assistant-root').shadowRoot.getElementById('notice').textContent.includes('分析结束'));
  assert.equal(await page.locator('#multi input[value="3"]').isChecked(),false);
});
test('stale question text is rejected before filling',async t=>{
  const page=await pageFor(t);await configure(page);await tab(page,'题目');await page.getByRole('button',{name:'扫描本页',exact:true}).click();
  await page.locator('.question').first().getByRole('button',{name:'分析',exact:true}).click();await page.locator('.question .answer').first().waitFor();
  await page.locator('#single legend').evaluate(el=>el.textContent='changed question');await page.locator('.question').first().getByRole('button',{name:'填入',exact:true}).click();
  assert.match(await notice(page).textContent(),/题目已变化/);assert.equal(await page.locator('#single input[value="2"]').isChecked(),false);
});
test('stopping analysis prevents a delayed response from filling the page',async t=>{
  const page=await pageFor(t);await configure(page);await page.evaluate(()=>window.__delay=10000);await tab(page,'题目');await page.getByRole('button',{name:'扫描本页',exact:true}).click();
  await page.getByText('分析后填入已匹配的答案（不提交）',{exact:true}).click();await page.getByRole('button',{name:'分析全部',exact:true}).click();await page.getByRole('button',{name:'停止分析',exact:true}).click();
  assert.equal(await page.locator('#single input[value="2"]').isChecked(),false);assert.equal(await page.evaluate(()=>window.__aborts),1);
});
test('chat renders untrusted model output as plain text and cancellation allows retry',async t=>{
  const page=await pageFor(t);await configure(page);await tab(page,'AI');await page.getByLabel('你的问题').fill('你好');await page.getByRole('button',{name:'发送',exact:true}).click();
  await page.locator('.message.assistant').waitFor();assert.equal(await page.locator('.message img').count(),0);
  assert.match(await page.locator('.message.assistant').textContent(),/<img/);
  await page.evaluate(()=>window.__delay=10000);await page.getByLabel('你的问题').fill('取消我');await page.getByRole('button',{name:'发送',exact:true}).click();await page.getByRole('button',{name:'停止',exact:true}).click();
  assert.equal(await page.getByLabel('你的问题').inputValue(),'取消我');assert.equal(await page.getByRole('button',{name:'发送',exact:true}).isEnabled(),true);
});
test('model test sends GET only and empty keys never send a request',async t=>{
  const page=await pageFor(t);await tab(page,'设置');await page.getByRole('button',{name:'测试连接 / 获取模型',exact:true}).click();assert.equal(await page.evaluate(()=>window.__requests.length),0);
  await configure(page);await page.getByRole('button',{name:'测试连接 / 获取模型',exact:true}).click();await page.waitForFunction(()=>document.getElementById('course-assistant-root').shadowRoot.getElementById('notice').textContent.includes('连接成功'));
  assert.deepEqual(await page.evaluate(()=>window.__requests.map(r=>({url:r.url,data:r.data}))),[{url:'https://api.deepseek.com/models',data:undefined}]);
});
test('stored keys never get repopulated into the page and can be explicitly cleared',async t=>{
  const page=await pageFor(t);await configure(page);assert.equal(await page.getByLabel('DeepSeek API Key',{exact:true}).inputValue(),'');
  await page.reload();await page.addScriptTag({content:source});await tab(page,'设置');assert.equal(await page.getByLabel('DeepSeek API Key',{exact:true}).inputValue(),'');
  assert.match(await page.getByLabel('DeepSeek API Key',{exact:true}).getAttribute('placeholder'),/已保存/);
  await page.getByRole('button',{name:'清除已保存密钥',exact:true}).click();await page.getByRole('button',{name:'测试连接 / 获取模型',exact:true}).click();assert.equal(await page.evaluate(()=>window.__requests.length),0);
});
test('refresh presets, cross-panel persistence, navigation pause and reload limit',async t=>{
  const page=await pageFor(t);await tab(page,'刷新');await page.getByRole('button',{name:'30 秒',exact:true}).click();assert.equal(await page.getByLabel('刷新间隔（秒）').inputValue(),'30');
  await page.getByRole('button',{name:'开始刷新',exact:true}).click();await tab(page,'AI');await tab(page,'刷新');assert.equal(await page.getByRole('button',{name:'开始刷新',exact:true}).isDisabled(),true);
  await page.evaluate(()=>history.pushState({},'', '/changed'));await page.waitForFunction(()=>document.getElementById('course-assistant-root').shadowRoot.getElementById('refresh-start').disabled===false);
  await page.getByLabel('刷新间隔（秒）').fill('10');await page.getByLabel('次数上限（0 为不限）').fill('1');await page.getByRole('button',{name:'开始刷新',exact:true}).click();
  await Promise.all([page.waitForEvent('load'),page.clock.setFixedTime(new Date(Date.now()+20000))]);
  await page.addScriptTag({content:source});await page.getByRole('navigation').waitFor();await tab(page,'刷新');
  assert.equal(await page.getByRole('button',{name:'开始刷新',exact:true}).isEnabled(),true);assert.match(await page.locator('#refresh-count').textContent(),/1/);
});
test('queue validates URLs, persists items, and stop-all prevents automatic playback',async t=>{
  const page=await pageFor(t);await tab(page,'队列');await page.getByLabel('页面网址').fill('javascript:alert(1)');await page.getByRole('button',{name:'加入网址',exact:true}).click();assert.match(await notice(page).textContent(),/http/);
  await page.getByRole('button',{name:'加入当前页',exact:true}).click();await page.getByRole('button',{name:'开始队列',exact:true}).click();assert.ok(await page.evaluate(()=>window.__plays)>0);
  await page.getByRole('button',{name:'停止全部',exact:true}).click();assert.equal(await page.locator('#video').evaluate(v=>v.paused),true);
  await page.reload();await page.addScriptTag({content:source});await tab(page,'队列');assert.equal(await page.locator('#queue-list .list-item').count(),1);assert.equal(await page.getByRole('button',{name:'开始队列',exact:true}).isEnabled(),true);
});
test('copy unlock preserves default events and is reversible',async t=>{
  const page=await pageFor(t);await tab(page,'设置');await page.getByText('允许页面文字选中、复制和粘贴',{exact:true}).click();await page.getByRole('button',{name:'保存设置',exact:true}).click();
  const allowed=await page.evaluate(()=>{document.body.addEventListener('copy',e=>e.preventDefault());return document.body.dispatchEvent(new Event('copy',{bubbles:true,cancelable:true}));});assert.equal(allowed,true);
  await page.getByText('允许页面文字选中、复制和粘贴',{exact:true}).click();await page.getByRole('button',{name:'保存设置',exact:true}).click();
  assert.equal(await page.evaluate(()=>document.body.dispatchEvent(new Event('copy',{bubbles:true,cancelable:true}))),false);
});
