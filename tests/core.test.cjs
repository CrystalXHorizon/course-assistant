const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/core.cjs');

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
  for(const s of ['javascript:alert(1)','data:text/html,foo','https://u:p@example.com'])assert.equal(C.safeURL(s),null);
  assert.equal(C.safeURL('/page','https://i.chaoxing.com').href,'https://i.chaoxing.com/page');
  assert.equal(C.canonical('https://a.example/p#fragment'),'https://a.example/p');
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
test('queue advances, finishes, or loops without producing invalid indices',()=>{
  let q={items:[{},{}],index:0,active:true,loop:false,rounds:0};q=C.nextQueue(q);assert.equal(q.index,1);q=C.nextQueue(q);assert.equal(q.active,false);assert.equal(q.rounds,1);
  q=C.nextQueue({...q,loop:true,active:true});assert.equal(q.index,0);assert.equal(q.active,true);
  assert.equal(C.nextQueue({...q,items:[]}).active,false);
});
test('API requests use only the official endpoint and never include credentials in the body',async()=>{
  let captured;const request=C.requester(options=>{captured=options;options.onload({status:200,responseText:'{"data":[]}'});},()=>({apiKey:'test-only-key'}));
  await request('/models');assert.equal(captured.url,'https://api.deepseek.com/models');assert.equal(captured.headers.Authorization,'Bearer test-only-key');assert.equal(captured.anonymous,true);assert.equal(captured.data,undefined);
  await assert.rejects(request('https://other.example'),/不支持/);
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
