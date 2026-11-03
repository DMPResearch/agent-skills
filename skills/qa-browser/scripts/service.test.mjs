import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runCell} from './cell.mjs';
import {terminalQueue,servicePacer} from './phases.mjs';

for(const engine of ['chromium','webkit'])test(engine+' service phase fires once while local controls keep their matrix coverage',{skip:!process.env.QA_PW_PATH,timeout:20000},async()=>{
 let calls=0,local=0,sdk=0,observedSdk=0,observedAll=0,completed=false;
 const external=createServer((req,res)=>{if(req.url==='/sdk')sdk++;else calls++;res.setHeader('Access-Control-Allow-Origin','*');res.end('Ready');});await new Promise(r=>external.listen(0,'127.0.0.1',r));
 const origin='http://127.0.0.1:'+external.address().port;
 const server=createServer((req,res)=>{if(req.url==='/local'){local++;setTimeout(()=>res.end('Ready'),100);return;}res.setHeader('Content-Type','text/html');res.end(`<html style="color:black;background:white"><form method="post" action="${origin}/" target="service-result"><button id="remote" style="width:140px;height:48px">Remote</button></form><iframe hidden name="service-result" onload="try{if(this.contentWindow.location.href==='about:blank')return;}catch{}if(document.querySelector('output'))document.querySelector('output').dataset.result='Remote';if(document.querySelector('output'))document.querySelector('output').textContent='Remote'"></iframe><button id="local" style="width:140px;height:48px" onclick="const poll=setInterval(()=>fetch('${origin}/sdk'),20);fetch('/local').then(()=>{clearInterval(poll);document.querySelector('output').dataset.result='Local';document.querySelector('output').textContent='Local'})">Local</button><button id="impostor" style="width:140px;height:48px" onclick="fetch('/local').then(()=>{document.querySelector('output').dataset.result='Local';document.querySelector('output').textContent='Local'})">Impostor</button><output>Waiting</output><script>fetch('${origin}/sdk')</script></html>`);});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const out=mkdtempSync(join(tmpdir(),'qa-service-')),pw=createRequire(process.env.QA_PW_PATH)('playwright'),browsers=new Map(),launches=new Map();
 const instrumented={...pw,[engine]:{launch:async()=>{const browser=await pw[engine].launch(),original=browser.newContext.bind(browser);browser.newContext=async options=>{const context=await original(options);context.on('request',r=>{if(new URL(r.url()).origin===origin)observedAll++;if(new URL(r.url()).pathname==='/sdk')observedSdk++;});return context;};return browser;}}};
 try{
  const recipe={selector:'#remote',name:'Remote',role:'button',safe:true,service:true,serviceRequest:{origin,method:'POST'},steps:[{action:'click',selector:'#remote'},{action:'visible',selector:'output[data-result=Remote]'}]},flow={id:'entry',url:'/',states:['signed-out','signed-in'],steps:[],controls:[recipe,{selector:'#local',safe:true,steps:[{action:'click',selector:'#local'},{action:'visible',selector:'output[data-result=Local]'}]}],breaks:[{kind:'double-submit',target:'#remote',name:'Remote',role:'button',safe:true,service:true,serviceRequest:{origin,method:'POST'},steps:[{action:'double-click',selector:'#remote'},{action:'visible',selector:'output[data-result=Remote]'}]}]};
  const config={baseURL:'http://127.0.0.1:'+server.address().port,servicePhase:{size:'390x660',theme:'light',limiter:'remote',cellLimiter:'cell-start'},serviceIntervals:{remote:10,'cell-start':10},flows:[flow]},report={cells:[],gaps:[]},services=terminalQueue({service:true}),env={config,report,out,browserModule:instrumented,browsers,launches,services,adapter:{prepareTerminal:async()=>{throw Error('nonconflicting service must not provision a terminal identity');}},sessions:new Map(),pace:servicePacer(config.serviceIntervals)};
  for(const [theme,size]of [['light','390x660'],['dark','1440x900']])await runCell({flow,engine,theme,size,state:{id:'signed-out'}},env);
  writeFileSync(join(out,'matrix.json'),JSON.stringify(report,null,2));
  assert.equal(calls,0,'matrix must never fire service actions');assert.ok(sdk>0);assert.ok(observedSdk>0);assert.ok(report.serviceTraffic.intercepted>0);assert.equal(report.serviceTraffic.total,observedAll);assert.ok(report.cells.every(c=>c.serviceTraffic.total>0));assert.ok(local>=2,'local actions keep firing');
  assert.ok(report.cells.filter(c=>!c.serviceState).every(c=>c.controls.some(r=>r.servicePhase&&r.status==='deferred')),JSON.stringify(report));
  await services.run(env);assert.ok(calls>=2&&calls<=3,'one real single and double-submit phase');assert.equal(report.serviceChecks.length,2);assert.equal(report.serviceChecks[0].status,'pass',JSON.stringify(report));
  assert.ok(report.cells.filter(c=>!c.serviceState).every(c=>c.controls.some(r=>r.servicePhase&&r.status==='shared'&&r.receipt==='service exercised in phase '+r.servicePhase)));
  const broken={...recipe,selector:'#impostor',name:'Impostor',steps:[{action:'click',selector:'#impostor'},{action:'visible',selector:'output[data-result=Local]'}]},cell={id:'impostor',screen:'entry',build:report.cells[0].build,theme:'light',size:'390x660',failures:[],gaps:[],frames:[],controls:[]},queue=terminalQueue({service:true});report.cells.push(cell);
  const id=queue.defer({flow,engine,theme:'light',size:'390x660',state:{id:'signed-out'}},cell,broken,'control',config);cell.controls.push({servicePhase:id,status:'deferred'});await queue.run(env);
  writeFileSync(join(out,'phase.json'),JSON.stringify(report,null,2));
  assert.equal(report.serviceChecks[0].status,'fail');assert.ok(cell.failures.some(f=>f.includes('intent did not attempt')));
 completed=true;
 }finally{for(const b of browsers.values())await b.close();for(const s of [server,external]){s.closeAllConnections();await new Promise(r=>s.close(r));}if(completed)rmSync(out,{recursive:true,force:true});else console.error('Service evidence retained at '+out);}
});
