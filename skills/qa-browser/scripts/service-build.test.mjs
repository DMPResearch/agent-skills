import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {observeBuild} from './provenance.mjs';
import {terminalQueue,servicePacer} from './phases.mjs';
for(const engine of ['chromium','webkit'])test(engine+' a service phase cannot cover cells captured from another build',{skip:!process.env.QA_PW_PATH,timeout:15000},async()=>{
 let version='A';const external=createServer((q,r)=>{r.setHeader('Access-Control-Allow-Origin','*');r.end('Ready');});await new Promise(r=>external.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+external.address().port;
 const app=createServer((q,r)=>{r.setHeader('Content-Type','text/html');r.end(`<html style="color:black;background:white"><h1>${version}</h1><button id="action" style="width:150px;height:48px" onclick="fetch('${origin}/send').then(()=>document.querySelector('output').hidden=false)">Continue</button><output hidden>Done</output></html>`);});await new Promise(r=>app.listen(0,'127.0.0.1',r));
 const pw=createRequire(process.env.QA_PW_PATH)('playwright'),browser=await pw[engine].launch(),out=mkdtempSync(join(tmpdir(),'qa-service-build-')),baseURL='http://127.0.0.1:'+app.address().port,buildObserver=observeBuild(baseURL);
 try{const context=await browser.newContext();buildObserver.attach(context);const page=await context.newPage();await page.goto(baseURL);const build=await buildObserver.finish();await context.close();version='B';
  const recipe={selector:'#action',service:true,serviceRequest:{origin,method:'GET'},name:'Continue',role:'button',safe:true,steps:[{action:'click',selector:'#action'},{action:'visible',selector:'output'}]},flow={id:'entry',url:'/',steps:[],controls:[recipe],breaks:[]},config={baseURL,servicePhase:{size:'390x660',theme:'light',limiter:'write',cellLimiter:'load'},serviceIntervals:{write:1,load:1}},cell={id:'entry',theme:'light',size:'390x660',build,frames:[],controls:[],failures:[],gaps:[]},report={cells:[cell],gaps:[]},queue=terminalQueue({service:true});
  const id=queue.defer({flow,engine,theme:'light',size:'390x660',state:{id:'signed-out'}},cell,recipe,'control',config);cell.controls.push({servicePhase:id,status:'deferred'});
  await queue.run({config,report,out,browsers:new Map([[engine,browser]]),sessions:new Map(),pace:servicePacer(config.serviceIntervals),buildObserver});
  assert.notEqual(report.serviceChecks[0].status,'pass',JSON.stringify(report));assert.ok(cell.failures.some(f=>f.includes('build mismatch')),JSON.stringify(report));
  assert.notEqual(build.id,(await buildObserver.finish()).id,'shared build observer sees phase bytes');
 }finally{await browser.close();for(const s of [app,external]){s.closeAllConnections();await new Promise(r=>s.close(r));}rmSync(out,{recursive:true,force:true});}
});
