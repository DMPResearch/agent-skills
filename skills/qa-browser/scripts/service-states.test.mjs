import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {observeBuild} from './provenance.mjs';
import {terminalQueue,servicePacer} from './phases.mjs';
import {reviewPlan} from './review-plan.mjs';
for(const engine of ['chromium','webkit'])test(engine+' one real code entry covers every declared size/theme and detects its wide layout failure',{skip:!process.env.QA_PW_PATH,timeout:60000},async()=>{
 let calls=0,baseURL;const remote=createServer((q,r)=>{calls++;r.writeHead(302,{Location:baseURL+'/code'});r.end();});await new Promise(r=>remote.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+remote.address().port;
 const entry=`<html style="background:white;color:black"><form method="post" action="${origin}/send"><button id="send" style="width:150px;height:48px">Send</button></form></html>`,code='<html style="background:white;color:black"><style>input{width:150px;height:48px}</style><button id="unmapped">Other</button><label for="other">Other value</label><input id="other"><label for="code">Code</label><form method="post" action="'+origin+'/verify" onsubmit="if(innerWidth===412)event.preventDefault()"><input id="code" oninput="if(innerWidth!==412)this.value=this.value.replace(/[^0-9]/g,&#39;&#39;)"><button id="verify" style="width:150px;height:48px">Verify</button></form><script>for(const e of document.querySelectorAll("input"))e.style.width=(innerWidth>=800||matchMedia("(prefers-color-scheme: dark)").matches)?"2000px":"150px";</script></html>';
 const app=createServer((q,r)=>{r.setHeader('Content-Type','text/html');r.end(q.url==='/code'?code:entry);});await new Promise(r=>app.listen(0,'127.0.0.1',r));baseURL='http://127.0.0.1:'+app.address().port;
 const pw=createRequire(process.env.QA_PW_PATH)('playwright'),browser=await pw[engine].launch(),out=mkdtempSync(join(tmpdir(),'qa-service-state-'));
 try{
  const buildObserver=observeBuild(baseURL),context=await browser.newContext();buildObserver.attach(context);const page=await context.newPage();await page.goto(baseURL);const build=await buildObserver.finish();await context.close();
  const recipe={selector:'#send',safe:true,service:true,name:'Send',role:'button',serviceRequest:{origin,method:'POST'},postState:{flow:'code',state:'signed-out'},steps:[{action:'click',selector:'#send'},{action:'visible',selector:'#code'}]},flow={id:'entry',url:'/',steps:[],controls:[recipe],breaks:[]},target={id:'code',url:'/code',steps:[{action:'visible',selector:'#code'}],controls:[{selector:'#verify',service:true,safe:true,name:'Verify',role:'button',serviceRequest:{origin,method:'POST'},steps:[{action:'click',selector:'#verify'},{action:'visible',selector:'#code'}]}],breaks:['empty','invalid'].map(kind=>({kind,target:'#code',safe:true,steps:[{action:'fill',selector:'#code',value:kind==='empty'?'':'x'},{action:'value',selector:'#code',value:''}]}))};
  const cells=['light','dark'].flatMap(theme=>['390x660','412x620','390x844','820x1180','1440x900'].map(size=>({id:engine+theme+size,screen:'entry',state:'signed-out',engine,theme,size,build,frames:[],failures:[],gaps:[],controls:[]}))),report={cells,gaps:[]},config={baseURL,flows:[flow,target],assetHashes:{'/code':createHash('sha256').update(code).digest('hex')},servicePhase:{size:'390x660',theme:'light',limiter:'write',cellLimiter:'load'},serviceIntervals:{write:1,load:1}},queue=terminalQueue({service:true});
  for(const cell of [...cells]){const id=queue.defer({flow,engine,theme:cell.theme,size:cell.size,state:{id:'signed-out'}},cell,recipe,'control',config);cell.controls.push({servicePhase:id,status:'deferred'});}
  await queue.run({config,report,out,browsers:new Map([[engine,browser]]),sessions:new Map(),pace:servicePacer(config.serviceIntervals),buildObserver});
  assert.equal(calls,2,'one send and one real verify; matrix intents never leave');const post=report.cells.filter(c=>c.serviceState&&c.servicePhase===report.serviceChecks[0].id);assert.equal(post.filter(c=>c.screen==='code').length,30,JSON.stringify(report));assert.ok(post.every(c=>c.frames.length>0),JSON.stringify(post));
  assert.ok(post.every(c=>c.gaps.some(g=>g.includes('unmapped visible control'))&&c.gaps.some(g=>g.includes('empty')&&g.includes('#other'))),'newly reached controls and input bindings need their own coverage');
  assert.ok(post.filter(c=>c.state.includes('invalid')&&c.size==='412x620').every(c=>c.failures.length>0),'local invalid handler must run at each width');
  assert.ok(post.filter(c=>c.size==='1440x900').every(c=>c.failures.length>0),'mount-only wide failure must be tested from a fresh page');
  assert.ok(post.filter(c=>c.screen==='code'&&c.state==='signed-out'&&c.size==='412x620').every(c=>c.controls.some(r=>r.intent?.status==='fail')),'inert post-state submit must fail at its own size');
  for(const theme of ['light','dark'])for(const size of ['390x660','412x620','390x844','820x1180','1440x900'])assert.equal(post.filter(c=>c.theme===theme&&c.size===size).length,3);
  assert.ok(post.every(c=>c.captureSource==='service response replayed from real call in phase '+report.serviceChecks[0].id),'every view must state replay provenance');
  const missing=structuredClone(post);missing[0].frames=[];assert.ok(reviewPlan(missing,{framesPerBatch:28}).gaps.some(g=>g.includes('state size capture missing')));
 }finally{await browser.close();for(const s of [app,remote]){s.closeAllConnections();await new Promise(r=>s.close(r));}rmSync(out,{recursive:true,force:true});}
});
