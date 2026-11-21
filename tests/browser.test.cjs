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
async function pageFor(t, options = {}){
  const context=await browser.newContext({viewport:{width:1100,height:980}});t.after(()=>context.close());
  const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
  if (options.tabStorage) {
    const values = new WeakMap();
    await context.exposeBinding('testReadTab', ({page}) => values.get(page) || {});
    await context.exposeBinding('testSaveTab', ({page}, value) => { values.set(page, value); });
    await context.addInitScript(() => {
      window.GM_getTab = callback => window.testReadTab().then(callback);
      window.GM_saveTab = (value, callback) => window.testSaveTab(value).then(callback);
    });
  }
  await context.route('**/*',route=>route.request().isNavigationRequest()?route.fulfill({contentType:'text/html; charset=utf-8',body:options.fixture?.(new URL(route.request().url())) ?? fixture}):route.abort());
  await context.addInitScript(useSharedStore=>{
    window.__requests=[];window.__delay=0;window.__apiReply='回答 <img src=x onerror=alert(1)>';window.__apiStatus=200;window.__aborts=0;window.__plays=0;
    const storage=()=>JSON.parse(useSharedStore ? decodeURIComponent(document.cookie.match(/(?:^|; )testgm=([^;]*)/)?.[1] || '%7B%7D') : localStorage.getItem('test-GM')||'{}');
    window.GM_getValue=(key,fallback)=>storage()[key]??fallback;
    window.GM_setValue=(key,value)=>{
      const all=storage();all[key]=value;
      if (useSharedStore) document.cookie=`testgm=${encodeURIComponent(JSON.stringify(all))}; Domain=chaoxing.com; Path=/; Secure`;
      else localStorage.setItem('test-GM',JSON.stringify(all));
    };
    window.GM_xmlhttpRequest=options=>{
      window.__requests.push({url:options.url,data:options.data,headers:options.headers});
      const timer=setTimeout(()=>{
        let response;
        if(options.url.endsWith('/models'))response={data:[{id:'deepseek-flash'},{id:'test-model'}]};
        else{
          const data=JSON.parse(options.data);let content=window.__apiReply;
          if(data.messages[0]?.content.includes('只返回 JSON 对象')){const q=JSON.parse(data.messages.at(-1).content);content=JSON.stringify({answers:q.type==='multiple'?['A','C']:q.type==='text'?['东']:['B'],explanation:'测试解析'});}
          response={choices:[{finish_reason:'stop',message:{content}}]};
        }
        options.onload({status:window.__apiStatus,responseText:JSON.stringify(response)});
      },window.__delay);
      return {abort(){clearTimeout(timer);window.__aborts++;options.onabort?.();}};
    };
    HTMLMediaElement.prototype.play=function(){window.__plays++;Object.defineProperty(this,'paused',{configurable:true,value:false});return Promise.resolve();};
    HTMLMediaElement.prototype.pause=function(){Object.defineProperty(this,'paused',{configurable:true,value:true});};
  }, options.sharedStore || false);
  await page.goto(options.url || 'https://i.chaoxing.com/demo');await page.addScriptTag({content:source});await page.getByRole('navigation').waitFor();
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
test('mixed chapter keeps all 25 questions in order, including split letter rows and flat sibling choices', async t => {
  const page = await pageFor(t,{fixture: () => {
    const options = ['AI 技术','实践','奋斗','奉献'];
    const single = '<article><p>【单选题】选一项。</p><div>' + options.map((s,i) => '<div aria-checked="false"><div><span>'+String.fromCharCode(65+i)+'</span></div><div>'+s+'</div></div>').join('')+'</div></article>';
    const multi = '<article><p>【多选题】选两项。</p><div>' + options.map((s,i) => '<span aria-checked="false">'+String.fromCharCode(65+i)+'</span><span>'+s+'</span>').join('')+'</div></article>';
    const judge = '<div class="questionLi"><div class="TiMu" data="3"><div class="Zy_TItle"><span class="fontLabel">此句成立吗？</span></div><ul class="Zy_ulTop"><li aria-label="对选择">✓</li><li aria-label="错选择">✗</li></ul></div></div>';
    return single.repeat(9)+multi.repeat(6)+judge.repeat(10);
  }});
  await tab(page,'题目');
  await page.getByRole('button',{name:'扫描本页'}).click();
  const cards = page.locator('#questions .question');
  assert.equal(await cards.count(),25);
  assert.deepEqual(await cards.locator('.tag').allTextContents(),[...Array(9).fill('单选'),...Array(6).fill('多选'),...Array(10).fill('判断')]);
  assert.equal(await cards.first().locator('p').textContent(),'选一项。');
  assert.deepEqual(await cards.nth(9).locator('.option').allTextContents(),['A. AI 技术','B. 实践','C. 奋斗','D. 奉献']);
});

test('a per-frame font decodes stem and option text once, preserves plain siblings, and sends readable choices to the API',async t=>{
  const b64=fs.readFileSync(path.join(__dirname,'fixtures/question-subset.ttf')).toString('base64');
  const frame='<style>@font-face{font-family:font-cxsecret;src:url(data:font/ttf;base64,'+b64+')} .font-cxsecret{font-family:font-cxsecret}</style>'+
    '<div class="questionLi"><div class="TiMu" data="1"><div class="Zy_TItle"><i role="option">1</i><span class="newZy_TItle">【多选题】</span><div class="fontLabel" role="option"><b class="font-cxsecret">玢盐</b>：玢</div></div>'+
    '<ul class="Zy_ulTop" aria-hidden="true">'+['玢','盐','清水'].map((s,i)=>'<li qtype="1" role="checkbox" aria-checked="false" onclick="this.setAttribute(\'aria-checked\',this.getAttribute(\'aria-checked\')===\'true\'?\'false\':\'true\')"><span class="num_option">'+String.fromCharCode(65+i)+'</span><a class="font-cxsecret">'+s+'</a></li>').join('')+'</ul></div></div>';
  const page=await pageFor(t,{fixture:url=>url.pathname==='/frame'?frame:'<iframe src="/frame"></iframe>'});
  await configure(page); await tab(page,'题目');
  await page.getByRole('button',{name:'扫描本页'}).click();
  assert.equal(await page.locator('.question p').textContent(),'盐会：玢');
  assert.deepEqual(await page.locator('.question .option').allTextContents(),['A. 盐','B. 会','C. 清水']);
  await page.getByText('分析后填入已匹配的答案',{exact:true}).click();
  await page.getByRole('button',{name:'分析全部'}).click();
  await page.locator('.question .answer').waitFor();
  const payload=await page.evaluate(()=>JSON.parse(JSON.parse(window.__requests[0].data).messages.at(-1).content));
  assert.equal(payload.question,'盐会：玢');
  assert.deepEqual(payload.options.map(o=>o.text),['盐','会','清水']);
  const child=page.frameLocator('iframe');
  assert.deepEqual(await child.locator('li').evaluateAll(els=>els.map(el=>el.getAttribute('aria-checked'))),['true','false','true']);
  assert.equal(await child.locator('.fontLabel b').textContent(),'玢盐');
  await child.locator('.fontLabel b').evaluate(el=>el.textContent='吪');
  await page.getByRole('button',{name:'扫描本页'}).click();
  assert.equal(await page.getByRole('button',{name:'分析全部'}).isDisabled(),true);
  assert.equal(await page.getByRole('button',{name:'分析',exact:true}).isDisabled(),true);
});

test('AI analysis fills native answers, corrects wrong checks, and does not submit a form',async t=>{
  const page=await pageFor(t);await configure(page);await tab(page,'题目');await page.getByRole('button',{name:'扫描本页',exact:true}).click();
  await page.getByText('分析后填入已匹配的答案',{exact:true}).click();await page.getByRole('button',{name:'分析全部',exact:true}).click();
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
  await page.getByText('分析后填入已匹配的答案',{exact:true}).click();await page.getByRole('button',{name:'分析全部',exact:true}).click();await page.getByRole('button',{name:'停止分析',exact:true}).click();
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
test('a legacy key and model survive switching providers, and prior chat stays with its service',async t=>{
  const page=await pageFor(t);
  await page.evaluate(()=>GM_setValue('course-assistant.v1.settings',{apiKey:'legacy-key',model:'legacy-model'}));
  await page.reload();await page.addScriptTag({content:source});
  const send=async text=>{
    await tab(page,'AI');await page.getByLabel('你的问题').fill(text);
    await page.locator('#chat-send').click();await page.locator('.message.assistant').waitFor();
  };
  await send('旧服务对话');
  await tab(page,'设置');await page.getByLabel('AI 服务商').selectOption('openrouter');
  await page.locator('#test-models').click();
  assert.equal(await page.evaluate(()=>__requests.length),1);
  await page.getByLabel('OpenRouter API Key').fill('router-key');
  await page.getByLabel('模型名称').fill('vendor/model:free');
  await page.getByRole('button',{name:'保存设置'}).click();
  await send('新服务对话');
  const calls=await page.evaluate(()=>__requests);
  assert.equal(calls[0].headers.Authorization,'Bearer legacy-key');
  assert.equal(calls[1].url,'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(calls[1].headers.Authorization,'Bearer router-key');
  assert.equal(JSON.parse(calls[1].data).model,'vendor/model:free');
  assert.ok(!calls[1].data.includes('旧服务对话'));
  await tab(page,'设置');await page.getByLabel('AI 服务商').selectOption('deepseek');
  assert.equal(await page.getByLabel('模型名称').inputValue(),'legacy-model');
  await page.locator('#test-models').click();
  assert.equal(await page.evaluate(()=>__requests.at(-1).headers.Authorization),'Bearer legacy-key');
});
test('changing a custom endpoint requires its own key and supports discovery with a blank model',async t=>{
  const page=await pageFor(t);await tab(page,'设置');
  await page.getByLabel('AI 服务商').selectOption('custom');
  await page.locator('#api-base').fill('https://first.example/v1/chat/completions');
  await page.locator('#api-key').fill('first-key');await page.locator('#test-models').click();
  await page.waitForFunction(()=>document.querySelector('#course-assistant-root').shadowRoot.querySelector('#model').value==='deepseek-flash');
  await page.locator('#api-base').fill('https://second.example/v1');
  await page.locator('#test-models').click();
  assert.deepEqual(await page.evaluate(()=>__requests.map(r=>r.url)),['https://first.example/v1/models']);
  await page.locator('#api-key').fill('second-key');await page.locator('#test-models').click();
  const last=await page.evaluate(()=>__requests.at(-1));
  assert.equal(last.url,'https://second.example/v1/models');assert.equal(last.headers.Authorization,'Bearer second-key');
});
test('refresh presets, cross-panel persistence, navigation pause and reload limit',async t=>{
  const page=await pageFor(t);await tab(page,'刷新');await page.getByRole('button',{name:'30 秒',exact:true}).click();assert.equal(await page.getByLabel('刷新间隔（秒）').inputValue(),'30');
  await page.getByRole('button',{name:'开始刷新',exact:true}).click();await tab(page,'AI');await tab(page,'刷新');assert.equal(await page.getByRole('button',{name:'开始刷新',exact:true}).isDisabled(),true);
  await page.evaluate(()=>history.pushState({},'', '/changed'));await page.waitForFunction(()=>document.getElementById('course-assistant-root').shadowRoot.getElementById('refresh-start').disabled===false);
  await page.getByLabel('刷新间隔（秒）').fill('10');await page.getByLabel('次数上限（0 为不限）').fill('1');await page.getByRole('button',{name:'开始刷新',exact:true}).click();
  await Promise.all([page.waitForEvent('load'),page.clock.setFixedTime(new Date(Date.now()+20000))]);
  await page.addScriptTag({content:source});await page.getByRole('navigation').waitFor();assert.equal(await page.getByRole('navigation').getByRole('button',{name:'刷新',exact:true}).getAttribute('aria-pressed'),'true');
  assert.equal(await page.getByRole('button',{name:'开始刷新',exact:true}).isEnabled(),true);assert.match(await page.locator('#refresh-count').textContent(),/1/);
});
const quizPath = '/mooc-ans/work/doHomeWorkNew?workAnswerId=51&courseId=11';
const autoLabel = '自动填入并提交章节测验（运行队列时自动答题）';
function assignment(total = 1) {
  return `<div class="ceyan_name">题量：${total}</div><div class="testTit_status">待完成</div>
    <form id="form1"><fieldset class="TiMu"><legend>选择第二项</legend>
    <label><input type="radio" name="a">甲</label><label><input type="radio" name="a">乙</label>
    </fieldset></form><div class="ZY_sub"><button class="btnSubmit" onclick="parent.document.querySelector('#workpop').hidden=false">提交</button></div>`;
}
function confirmation() {
  return `<div hidden id="workpop"><p id="popcontent">确认提交？</p><button id="popok" onclick="
    const d=document.querySelector('iframe').contentDocument;
    if (!d.querySelectorAll('input')[1].checked) throw Error('unchecked');
    d.querySelector('.testTit_status').textContent='已提交';
    document.querySelector('#workpop').hidden=true;
    sessionStorage.setItem('submits',String(Number(sessionStorage.getItem('submits'))+1));
    const chapter=document.querySelector('[data-course-chapter]'); if(chapter) chapter.dataset.chapterStatus='complete';
  ">提交</button></div>`;
}
test('one queue start plays video, switches task cards, fills and confirms the quiz once, then finishes the next course',async t=>{
  const first='/mycourse/studentstudy?courseid=11&clazzid=90',second='/mycourse/studentstudy?courseid=22&clazzid=91';
  const page=await pageFor(t,{fixture:url=>{
    if(url.pathname==='/demo')return `<a href="${first}">第一门</a><a href="${second}">第二门</a>`;
    if(url.pathname.endsWith('doHomeWorkNew'))return assignment();
    if(url.searchParams.get('courseid')==='22')return '<div data-course-chapter data-current="true" data-chapter-status="complete">完成</div>';
    return `<div data-course-chapter data-current="true" data-chapter-status="pending">章节</div>
      <div id="prev_tab"><ul class="prev_ul"><li class="active" cardid="1">视频</li>
      <li cardid="2" onclick="document.querySelector('video').remove();this.previousElementSibling.className='';this.className='active';document.querySelector('iframe').src='${quizPath}'">测验</li></ul></div>
      <video></video><iframe></iframe>`+confirmation()+`<script>
      const v=document.querySelector('video');const original=v.play.bind(v);v.play=async()=>{
        await original();sessionStorage.setItem('played','yes');setTimeout(()=>{v.pause();Object.defineProperty(v,'ended',{value:true});},60);
      };</script>`;
  }});
  await tab(page,'设置');await page.getByLabel('AI 服务商').selectOption('ollama');
  await page.getByRole('button',{name:'保存设置'}).click();
  await tab(page,'题目');await page.getByLabel(autoLabel).check();
  await readCatalog(page);await page.getByRole('button',{name:/第一门/}).click();await page.getByRole('button',{name:/第二门/}).click();
  await page.getByRole('button',{name:'开始学习',exact:true}).click();
  await page.waitForURL(/courseid=11/);await page.addScriptTag({content:source});
  await page.waitForURL(/courseid=22/,{timeout:18000});await page.addScriptTag({content:source});
  await page.getByText('本轮队列已结束',{exact:true}).waitFor({timeout:8000});
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('played')),'yes');
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('submits')),'1');
});
test('auto submission rejects incomplete scans and only confirms a fully filled quiz once',async t=>{
  const page=await pageFor(t,{fixture:url=>url.pathname.endsWith('doHomeWorkNew')?assignment(2):'<iframe src="'+quizPath+'"></iframe>'+confirmation()});
  await configure(page);await tab(page,'题目');await page.getByLabel(autoLabel).check();
  await page.getByRole('button',{name:'扫描本页'}).click();await page.getByRole('button',{name:'分析全部'}).click();
  assert.match(await notice(page).textContent(),/题量/);assert.equal(await page.evaluate(()=>window.__requests.length),0);
  await page.frameLocator('iframe').locator('.ceyan_name').evaluate(el=>el.textContent='题量：1');
  await page.getByRole('button',{name:'分析全部'}).click();
  await page.waitForFunction(()=>sessionStorage.getItem('submits')==='1');
  assert.equal(await page.evaluate(()=>window.__requests.length),1);
  await page.reload();await page.addScriptTag({content:source});await tab(page,'题目');
  await page.getByRole('button',{name:'扫描本页'}).click();
  await page.frameLocator('iframe').locator('.ceyan_name').evaluate(el=>el.textContent='题量：1');
  await page.getByRole('button',{name:'分析全部'}).click();assert.match(await notice(page).textContent(),/已发起过提交/);
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('submits')),'1');
});
test('pausing a running queue cancels its pending answer and leaves the quiz unsubmitted',async t=>{
  const url='https://mooc1.chaoxing.com/mycourse/studentstudy?courseid=11&clazzid=90';
  const page=await pageFor(t,{url,fixture:u=>u.pathname.endsWith('doHomeWorkNew')?assignment():
    '<a href="'+url+'">测试课程</a><iframe src="'+quizPath+'"></iframe>'+confirmation()});
  await configure(page);await tab(page,'题目');await page.getByLabel(autoLabel).check();
  await page.evaluate(()=>window.__delay=10000);
  await readCatalog(page);await page.getByRole('button',{name:/测试课程/}).click();await page.getByRole('button',{name:'开始学习'}).click();
  await page.waitForFunction(()=>window.__requests.length===1);
  await page.getByRole('button',{name:'暂停队列'}).click();
  await page.waitForFunction(()=>window.__aborts===1);
  assert.equal(await page.frameLocator('iframe').locator('input:checked').count(),0);
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('submits')),null);
});
const queueFixture = url => {
  if (url.pathname === '/demo') return `<!doctype html><title>我的课程</title>
    <div class="course"><h3>线性代数</h3><a href="/mycourse/studentstudy?courseid=11&clazzid=90">进入课程</a></div>
    <div class="course" courseid="22" clazzid="91" personid="10"><h3 class="course-name">大学物理</h3><div class="course-info"><p>李老师</p></div></div>
    <a href="https://example.com/mycourse/studentstudy?courseid=4&clazzid=9">陌生链接</a>`;
  const completed = url.searchParams.get('courseid') === '11';
  return `<!doctype html><title>课程</title>
    <div data-course-chapter data-chapter-status="${completed ? 'complete' : 'pending'}" data-current="true"><button>第 1 章</button></div>
    <video id="video" style="width:260px;height:150px"></video>`;
};
async function readCatalog(page) {
  await tab(page,'队列');
  await page.getByRole('button',{name:'读取课程列表',exact:true}).click();
  await page.locator('.queue-choice').first().waitFor();
}

test('queue reads cards, filters by teacher and numbers picks in selection order',async t=>{
  const page=await pageFor(t,{fixture:queueFixture});
  await readCatalog(page);
  assert.equal(await page.locator('.queue-choice').count(),2);
  await page.getByLabel('搜索课程').fill('李老师');
  assert.equal(await page.locator('.queue-choice').count(),1);
  await page.getByRole('button',{name:/大学物理/}).click();
  await page.getByLabel('搜索课程').fill('');
  await page.getByRole('button',{name:/线性代数/}).click();
  assert.equal(await page.getByRole('button',{name:/大学物理/}).locator('.queue-index').textContent(),'1');
  assert.equal(await page.getByRole('button',{name:/线性代数/}).locator('.queue-index').textContent(),'2');
  await page.locator('#window').screenshot({path:path.join(__dirname,'../test-results/queue.png')});
  await Promise.all([page.waitForURL(/courseid=22/),page.getByRole('button',{name:'开始学习',exact:true}).click()]);
  await page.addScriptTag({content:source});
  await page.getByRole('button',{name:'暂停队列',exact:true}).waitFor();
  assert.equal(await page.locator('.queue-current').textContent(),'大学物理');
  await page.getByRole('button',{name:'移出线性代数',exact:true}).click();
  await page.getByRole('button',{name:'暂停队列',exact:true}).click();
  await page.reload();
  await page.addScriptTag({content:source});
  assert.equal(await page.locator('#queue-list .list-item').count(),1);
  await page.getByRole('button',{name:'继续队列',exact:true}).click();
  await page.waitForFunction(()=>window.__plays>0);
  await page.getByRole('button',{name:'停止全部',exact:true}).click();
  assert.equal(await page.locator('#video').evaluate(v=>v.paused),true);
});

test('queue advances on confirmed chapter completion, not on an ended video alone',async t=>{
  const page=await pageFor(t,{fixture:queueFixture});
  await readCatalog(page);
  await page.getByRole('button',{name:/线性代数/}).click();
  await page.getByRole('button',{name:/大学物理/}).click();
  await Promise.all([page.waitForURL(/courseid=11/),page.getByRole('button',{name:'开始学习',exact:true}).click()]);
  await page.addScriptTag({content:source});
  await page.waitForURL(/courseid=22/, {timeout:8500});
  await page.addScriptTag({content:source});
  assert.match(await page.locator('#queue-list .list-item').first().textContent(),/线性代数.*已完成/);
  await page.locator('#video').evaluate(v=>{Object.defineProperty(v,'ended',{value:true});v.dispatchEvent(new Event('ended'));});
  await page.waitForTimeout(2750);
  assert.match(await page.locator('#queue-list .list-item').last().textContent(),/大学物理.*学习中/);
  await page.getByRole('button',{name:'跳过本门',exact:true}).click();
  assert.match(await page.locator('#queue-list .list-item').last().textContent(),/已跳过/);
  assert.match(await page.locator('.queue-current').textContent(),/已结束/);
});

test('queue clicks the next pending platform chapter when the current one is done',async t=>{
  const url='https://i.chaoxing.com/mycourse/studentstudy?courseid=11&clazzid=90';
  const page=await pageFor(t,{url,fixture:()=>`<!doctype html><title>课程</title>
    <a href="${url}">例题课程</a>
    <div data-course-chapter data-current="true" data-chapter-status="complete"><button>第 1 章</button></div>
    <div data-course-chapter data-chapter-status="pending"><button onclick="document.body.dataset.opened='true'">第 2 章</button></div>`});
  await readCatalog(page);
  await page.getByRole('button',{name:/例题课程/}).click();
  await page.getByRole('button',{name:'开始学习',exact:true}).click();
  await page.waitForFunction(()=>document.body.dataset.opened==='true');
});

test('queue keeps control when the course opens on another platform subdomain',async t=>{
  const course='https://mooc1.chaoxing.com/mycourse/studentstudy?courseid=22&clazzid=9';
  const page=await pageFor(t,{sharedStore:true,fixture:url=>url.pathname==='/demo'
    ? `<!doctype html><a href="${course}#step=1">跨域课程</a>` : queueFixture(url)});
  await readCatalog(page);
  await page.getByRole('button',{name:/跨域课程/}).click();
  await Promise.all([page.waitForURL(/mooc1\.chaoxing\.com\/mycourse\/studentstudy/),page.getByRole('button',{name:'开始学习',exact:true}).click()]);
  await page.addScriptTag({content:source});
  await page.getByRole('button',{name:'暂停队列',exact:true}).waitFor();
  assert.equal(page.url(),`${course}#step=1`);
  await page.reload();
  await page.addScriptTag({content:source});
  await page.waitForFunction(()=>window.__plays>0);
  assert.equal(await page.getByRole('button',{name:'暂停队列',exact:true}).isEnabled(),true);
});

test('only the original tab runs after the course entry redirects across origins without its fragment', async t => {
  const entry = 'https://mooc1.chaoxing.com/mooc-ans/visit/stucoursemiddle?courseid=22&clazzid=91';
  const destination = 'https://mooc2-ans.chaoxing.com/mycourse/studentstudy?courseid=22&clazzid=91';
  const page = await pageFor(t, {sharedStore: true, tabStorage: true, fixture: url => {
    if (url.pathname === '/demo') return `<a href="${entry}">工程制图</a>`;
    if (url.pathname.endsWith('/stucoursemiddle')) return `<script>location.replace('${destination}')</script>`;
    return queueFixture(url);
  }});
  await readCatalog(page);
  await page.getByRole('button', {name: /工程制图/}).click();
  await page.getByRole('button', {name: '开始学习', exact: true}).click();
  await page.waitForURL(destination);
  await page.addScriptTag({content: source});
  await page.waitForFunction(() => window.__plays > 0, null, {timeout: 5000});
  const other = await page.context().newPage();
  await other.goto(destination);
  await other.addScriptTag({content: source});
  await other.getByText('在另一标签页运行', {exact: true}).waitFor();
  assert.equal(await other.getByRole('button', {name: '暂停队列'}).isDisabled(), true);
  assert.equal(await other.evaluate(() => window.__plays), 0);
});

test('Chaoxing course home opens its first unfinished chapter through the platform transfer', async t => {
  const home = 'https://mooc2-ans.chaoxing.com/mooc2-ans/mycourse/stu?courseid=22&clazzid=91&cpi=10';
  const page = await pageFor(t, {
    url: home, sharedStore: true,
    fixture: url => {
      if (url.pathname.endsWith('/stu')) return `<!doctype html><title>高等数学</title>
        <a href="${home}">高等数学</a><button data-url="/mooc2-ans/mycourse/studentcourse" onclick="document.querySelector('iframe').removeAttribute('hidden')">章节</button>
        <iframe hidden src="/mooc2-ans/mycourse/studentcourse?courseid=22&clazzid=91&cpi=10"></iframe>`;
      if (url.pathname.endsWith('/studentcourse')) return `<!doctype html><script>var enc = 'fixture_value'; var cpi = 10;</script>
        <div class="chapter_item" onclick="toOld(22, 101)"><b class="icon_yiwanc">已完成</b>第一章</div>
        <div class="chapter_item"><a href="javascript:;" onclick="toOld(courseId, '102', 91)">第 2 章</a><input class="knowledgeJobCount" type="hidden" value="3"></div>`;
      if (url.pathname === '/mycourse/transfer') return `<!doctype html><script>location.replace(new URLSearchParams(location.search).get('refer') + location.hash);</script>`;
      return queueFixture(url);
    }
  });
  await readCatalog(page);
  await page.getByRole('button', { name: /高等数学/ }).click();
  const transfer = page.waitForRequest(req => new URL(req.url()).pathname === '/mycourse/transfer');
  await page.getByRole('button', { name: '开始学习', exact: true }).click();
  const address = new URL((await transfer).url());
  assert.equal(address.hostname, 'mooc1.chaoxing.com');
  assert.equal(new URL(address.searchParams.get('refer')).searchParams.get('chapterId'), '102');
  await page.waitForURL(url => url.pathname === '/mycourse/studentstudy');
  await page.addScriptTag({ content: source });
  await page.waitForFunction(() => window.__plays > 0);
  assert.equal(await page.getByRole('button', { name: '暂停队列', exact: true }).isEnabled(), true);
});

test('Chaoxing reads collapsed chapters from the catalog response and survives a transfer dropping its hash', async t => {
  const home = 'https://mooc2-ans.chaoxing.com/mooc2-ans/mycourse/stu?courseid=22&clazzid=91';
  const page = await pageFor(t, { url: home, sharedStore: true, fixture: url => {
    if (url.pathname.endsWith('/stu')) return `<a href="${home}">大学英语</a>
      <input id="enc" value="catalog_access"><input id="oldenc" value="study_access"><input id="cpi" value="14">`;
    if (url.pathname.endsWith('/transfer')) return `<script>location.replace(new URL(location.href).searchParams.get('refer'));</script>`;
    return queueFixture(url);
  }});
  let requests = 0;
  await page.route('**/mycourse/studentcourse?*', async route => {
    requests++;
    const params = new URL(route.request().url()).searchParams;
    assert.deepEqual(['courseid','clazzid','cpi','stuenc','ut'].map(key => params.get(key)), ['22','91','14','catalog_access','s']);
    await route.fulfill({contentType: 'text/html', body: `<section hidden>
      <div class="chapter_item" onclick="toOld('', 40)"><i class="icon_yiwanc"></i>第一章</div>
      <div class="chapter_item" onclick="toOld('', 41)"><input class="knowledgeJobCount" value="2">第二章</div>
      </section>`});
  });
  await readCatalog(page);
  await page.getByRole('button', {name: /大学英语/}).click();
  await page.getByRole('button', {name: '开始学习', exact: true}).click();
  await page.waitForURL(url => url.pathname.endsWith('/studentstudy'), {timeout: 6000});
  assert.equal(requests, 1);
  assert.equal(new URL(page.url()).searchParams.get('chapterId'), '41');
  assert.equal(new URL(page.url()).searchParams.get('enc'), 'study_access');
  await page.addScriptTag({content: source});
  await page.waitForFunction(() => window.__plays > 0, null, {timeout: 4000});
  assert.equal(await page.getByRole('button', {name: '暂停队列', exact:true}).isEnabled(), true);
});

test('Chaoxing study view advances when the active chapter unfinished task count becomes zero', async t => {
  const url = 'https://mooc1.chaoxing.com/mycourse/studentstudy?courseid=11&clazzid=90';
  const page = await pageFor(t, { url, fixture: () => `<!doctype html><title>高等数学</title>
    <a href="${url}">高等数学</a><input type="hidden" id="curChapterId" value="101">
    <div class="posCatalog_select"><button onclick="getTeacherAjax(11,90,101)">第一章</button><input type="hidden" class="jobUnfinishCount" value="1"></div>
    <div hidden><button onclick="getTeacherAjax(11,90,102)">第二章</button><input type="hidden" class="jobUnfinishCount" value="2"></div>
    <script>function getTeacherAjax(course, group, chapter) { document.querySelector('#curChapterId').value = String(chapter); }</script>
    <video id="video" style="width:260px;height:150px"></video>` });
  await readCatalog(page);
  await page.getByRole('button', { name: /高等数学/ }).click();
  await page.getByRole('button', { name: '开始学习', exact: true }).click();
  await page.waitForFunction(() => window.__plays > 0);
  assert.equal(await page.locator('#curChapterId').inputValue(), '101');
  await page.locator('.jobUnfinishCount').first().evaluate(input => { input.value = '0'; });
  await page.waitForFunction(() => document.querySelector('#curChapterId').value === '102');
});

test('unavailable catalog endpoint falls back to collapsed chapters in the page', async t => {
  const home = 'https://mooc2-ans.chaoxing.com/fanyav3/stu?courseid=22&clazzid=91&enc=directory&cpi=15';
  const page = await pageFor(t, { url: home, sharedStore: true, fixture: url =>
    url.pathname.endsWith('/stu') ? `<a href="${home}">力学</a><input id="oldenc" value="old_value">
      <div class="chapter_item" onclick="toOld(22,1)"><i class="icon_yiwanc"></i>第一章</div>
      <div hidden aria-current="page" class="chapter_item" onclick="toOld(22,2)"><input class="knowledgeJobCount" value="1">第二章</div>
      <video style="width:260px;height:150px"></video>`
    : queueFixture(url) });
  let attempts = 0;
  await page.route('**/mycourse/studentcourse?*', route => {
    attempts++;
    return route.fulfill({status: 503});
  });
  await readCatalog(page);
  await page.getByRole('button', {name: /力学/}).click();
  await page.getByRole('button', {name: '开始学习', exact: true}).click();
  await page.waitForURL(url => url.pathname.endsWith('/transfer'), {timeout: 6000});
  assert.equal(attempts, 1);
  const study = new URL(new URL(page.url()).searchParams.get('refer'));
  assert.equal(study.searchParams.get('chapterId'), '2');
});
test('copy unlock preserves default events and is reversible',async t=>{
  const page=await pageFor(t);await tab(page,'设置');await page.getByText('允许页面文字选中、复制和粘贴',{exact:true}).click();await page.getByRole('button',{name:'保存设置',exact:true}).click();
  const allowed=await page.evaluate(()=>{document.body.addEventListener('copy',e=>e.preventDefault());return document.body.dispatchEvent(new Event('copy',{bubbles:true,cancelable:true}));});assert.equal(allowed,true);
  await page.getByText('允许页面文字选中、复制和粘贴',{exact:true}).click();await page.getByRole('button',{name:'保存设置',exact:true}).click();
  assert.equal(await page.evaluate(()=>document.body.dispatchEvent(new Event('copy',{bubbles:true,cancelable:true}))),false);
});
