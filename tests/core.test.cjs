const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/core.cjs');
const Q = require('../src/course-queue.cjs');

function clock(saved, navigation='navigate') {
  let time=0, stored=saved, fail=false;
  const timer=new C.RefreshTimer({read:()=>stored,write:value=>{if(fail)throw Error('blocked');stored=value;},now:()=>time,url:'https://i.chaoxing.com/a',navigation});
  return {timer,step:ms=>{time+=ms;return timer.tick('https://i.chaoxing.com/a');},stored:()=>stored,fail:()=>{fail=true;}};
}
test('refresh uses a deadline, resumes after reload and stops exactly at the limit',()=>{
  let c=clock();c.timer.start(10,2,'https://i.chaoxing.com/a');assert.equal(c.step(9999),false);assert.equal(c.step(1),true);assert.equal(c.step(10000),false);
  c=clock(c.stored(),'reload');assert.equal(c.timer.state.active,true);assert.equal(c.step(10000),true);assert.equal(c.stored().count,2);
  c=clock(c.stored(),'reload');assert.equal(c.timer.state.active,false);assert.equal(c.step(200000),false);
});
test('navigation and manual stop disable refresh',()=>{
  const c=clock();c.timer.start(10,0,'https://i.chaoxing.com/a');const saved=c.stored();assert.equal(clock(saved).timer.state.active,false);
  assert.equal(c.timer.tick('https://i.chaoxing.com/b'),false);assert.equal(c.timer.state.active,false);
  c.timer.start(10,0,'https://i.chaoxing.com/a');c.timer.stop();assert.equal(c.step(10000),false);
});
test('background delays do not burst, and failed storage prevents reload',()=>{
  const c=clock();c.timer.start(10,0,'https://i.chaoxing.com/a');assert.equal(c.step(900000),true);assert.equal(c.stored().count,1);
  const d=clock();d.timer.start(10,0,'https://i.chaoxing.com/a');d.fail();assert.throws(()=>d.step(10000),/无法保存/);assert.equal(d.timer.state.active,false);
});
test('invalid and corrupt interval data cannot start a timer',()=>{
  const c=clock({active:true,seconds:-1,limit:0,count:0,due:5},'reload');assert.equal(c.timer.state.active,false);
  for(const [seconds,limit] of [[9,0],[Infinity,0],[10,-1],[10,1.2],[86401,0]])assert.throws(()=>c.timer.start(seconds,limit,'x'));
});
test('duration displays hours and clamps negative numbers',()=>{assert.equal(C.duration(3601),'01:00:01');assert.equal(C.duration(-1),'00:00');assert.equal(C.duration(59.2),'01:00');});
test('URLs reject script schemes and credentials',()=>{
  for(const s of ['javascript:alert(1)','data:text/html,foo','https://u:p@i.chaoxing.com','https://chaoxing.com.example.net'])assert.equal(Q.site(s),null);
  assert.equal(Q.site('/page','https://i.chaoxing.com').url.href,'https://i.chaoxing.com/page');
  assert.equal(Q.identify('https://i.chaoxing.com/mycourse/studentstudy?courseId=5&clazzid=2'),'cx:5:2');
  assert.equal(Q.identify('https://smartcoursestudent.zhihuishu.com/learnPage/5/unit/12'),'zhs:smart:5:12');
});
test('settings clamp corrupt values without retaining unknown fields',()=>{
  assert.deepEqual(C.config({apiKey:' key ',model:'bad model',timeout:1,rate:100,unlock:'true',extra:1}),{...C.defaults,apiKey:'key'});
});
test('choice answers accept letters or unique exact text and reject ambiguous responses',()=>{
  const q={kind:'single',options:['北京','上海']};
  assert.deepEqual(C.parseAnswer('{"answers":["B"],"explanation":"说明"}',q).indices,[1]);
  assert.deepEqual(C.parseAnswer('```json\n{"answers":["北京"]}\n```',q).indices,[0]);
  for(const text of ['bad','{"answers":[]}','{"answers":["A","B"]}','{"answers":["C"]}','{"answers":[false]}'])assert.throws(()=>C.parseAnswer(text,q));
  assert.throws(()=>C.parseAnswer('{"answers":["相同"]}',{kind:'single',options:['相同','相同']}));
});
test('multiple choice deduplicates and fill-in validates answer count',()=>{
  assert.deepEqual(C.parseAnswer('{"answers":["A","C","A"]}',{kind:'multiple',options:['a','b','c']}).indices,[0,2]);
  assert.throws(()=>C.parseAnswer('{"answers":["x"]}',{kind:'text',fields:2}));
  assert.deepEqual(C.parseAnswer('{"answers":["x","y"]}',{kind:'text',fields:2}).answers,['x','y']);
});
test('queue keeps selection order and separates outcomes from the paused state',()=>{
  const entry = (id, title) => ({ title, url:`https://mooc1.chaoxing.com/mycourse/stu?courseid=${id}&clazzid=20` });
  const queue=Q.cleanQueue({items:[entry(4,'第二门'),entry(1,'第一门'),entry(4,'重复')]},'chaoxing');
  assert.equal(queue.items.length,2);
  assert.equal(Q.begin(queue,'owner',0).title,'第二门');
  Q.pause(queue);
  assert.equal(Q.currentCourse(queue).title,'第二门');
  assert.equal(Q.begin(queue,'owner',50).title,'第二门');
  Q.resolve(queue,'skipped','已跳过');
  assert.equal(Q.begin(queue,'owner',60).title,'第一门');
  Q.resolve(queue,'done','已完成');
  assert.deepEqual(queue.items.map(item=>item.status),['skipped','done']);
  assert.equal(queue.status,'finished');
  assert.equal(Q.begin(queue,'owner',100),null);
});
test('navigation handoff preserves the platform fragment and course identity',()=>{
  const original='https://studyvideoh5.zhihuishu.com/stuStudy?recruitAndCourseId=abc#chapter=1';
  const restored=Q.readHandoff(Q.handoffURL(original,'token').href);
  assert.equal(restored.ticket,'token');
  assert.equal(restored.url.href,original);
  assert.equal(Q.identify(restored.url.href),'zhs:shared:abc');
  assert.equal(Q.readHandoff(original),null);
});
test('legacy settings use the DeepSeek endpoint and never include credentials in the body',async()=>{
  let captured;const request=C.requester(options=>{captured=options;options.onload({status:200,responseText:'{"data":[]}'});},()=>({apiKey:'test-only-key'}));
  await request('/models');assert.equal(captured.url,'https://api.deepseek.com/models');assert.equal(captured.headers.Authorization,'Bearer test-only-key');assert.equal(captured.anonymous,true);assert.equal(captured.data,undefined);
  await assert.rejects(request('https://other.example'),/不支持/);
});
test('each AI preset routes model discovery and completion to its configured service',async()=>{
  for (const [provider,preset] of Object.entries(C.providers)) {
    const local=provider==='ollama';
    const cfg=C.config({provider,base:'https://gateway.example/api/v1',model:'org/model:tag',apiKey:local?'':'example-key',thinking:true});
    const calls=[];
    const request=C.requester(options=>{
      calls.push(options);
      options.onload({status:200,responseText:JSON.stringify({choices:[{message:{content:[{type:'text',text:'{"answers":["A"]}'}]}}]})});
    },()=>cfg);
    await request('/models');
    assert.deepEqual(C.parseAnswer(await C.complete(request,cfg,[],undefined,true),{kind:'single',options:['first']}).indices,[0]);
    const base=provider==='custom'?'https://gateway.example/api/v1':preset.base;
    assert.deepEqual(calls.map(c=>c.url),[base+'/models',base+'/chat/completions']);
    assert.equal(calls[1].headers.Authorization,local?undefined:'Bearer example-key');
    assert.equal(calls[1].redirect,'error');
    const payload=JSON.parse(calls[1].data);
    assert.equal(payload.model,'org/model:tag');
    assert.equal('thinking' in payload,provider==='deepseek');
    assert.equal('response_format' in payload,provider==='deepseek');
  }
});
test('custom addresses normalize pasted endpoints and reject unsafe destinations before sending',async()=>{
  assert.equal(C.customBase('https://gateway.example/api/v1/chat/completions/'),'https://gateway.example/api/v1');
  assert.equal(C.customBase('http://[::1]:1234/v1/models'),'http://[::1]:1234/v1');
  for(const base of ['http://localhost.example/v1','https://x:y@example.com','https://example.com/v1?token=x','file:///v1','invalid']){
    await assert.rejects(C.requester(()=>assert.fail('unexpected request'),()=>({provider:'custom',base,apiKey:'k'}))('/models'),/地址/);
  }
  assert.equal(C.config({provider:'unknown',apiKey:'legacy',base:'https://example.com'}).apiKey,'');
});
test('missing key fails before transport, and error bodies never leak secrets',async()=>{
  let calls=0;await assert.rejects(C.requester(()=>calls++,()=>({}))('/models'),/API Key/);assert.equal(calls,0);
  const request=C.requester(o=>o.onload({status:401,responseText:'secret-echo'}),()=>({apiKey:'test-only'}));await assert.rejects(request('/models'),e=>e.message==='API Key 无效');
});
test('abort rejects pending requests once and ignores a late successful response',async()=>{
  let options,aborts=0;const request=C.requester(o=>{options=o;return {abort(){aborts++;o.onabort();}};},()=>({apiKey:'test-only'}));
  const c=new AbortController();const pending=request('/models',null,c.signal);c.abort();options.onload({status:200,responseText:'{"data":[]}'});
  await assert.rejects(pending,{name:'AbortError'});assert.equal(aborts,1);
});
test('already aborted requests never reach the transport',async()=>{
  const c=new AbortController();c.abort();let calls=0;await assert.rejects(C.requester(()=>calls++,()=>({apiKey:'test'}))('/models',null,c.signal),{name:'AbortError'});assert.equal(calls,0);
});
test('timeouts, network failures, malformed JSON and server errors have actionable messages',async()=>{
  const variants=[['ontimeout',undefined,/超时/],['onerror',undefined,/连接失败/],['onload',{status:200,responseText:'oops'},/解析/],['onload',{status:502,responseText:''},/502/]];
  for(const [callback,payload,expected]of variants)await assert.rejects(C.requester(o=>o[callback](payload),()=>({apiKey:'test'}))('/models'),expected);
});
test('completion rejects empty or truncated output and sends thinking and JSON preferences',async()=>{
  let payload;const request=async(_path,data)=>{payload=data;return {choices:[{finish_reason:'stop',message:{content:'{"answers":["A"]}'}}]};};
  const result=await C.complete(request,{...C.defaults,thinking:true},[{role:'user',content:'test'}],undefined,true);
  assert.equal(payload.thinking.type,'enabled');assert.equal(payload.response_format.type,'json_object');assert.ok(result.includes('answers'));
  await assert.rejects(C.complete(async()=>({choices:[{finish_reason:'length',message:{content:'partial'}}]}),C.defaults,[]),/截断/);
  await assert.rejects(C.complete(async()=>({choices:[]}),C.defaults,[]),/有效回答/);
});
