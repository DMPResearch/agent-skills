import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {observeBuild} from './provenance.mjs';
import {terminalQueue,servicePacer} from './phases.mjs';
for(const engine of ['chromium','webkit'])test(engine+' a delayed background request cannot prove a service click',{skip:!process.env.QA_PW_PATH,timeout:10000},async()=>{
 let calls=0;const remote=createServer((q,r)=>{calls++;r.setHeader('Access-Control-Allow-Origin','*');r.end('Done');});await new Promise(r=>remote.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+remote.address().port;
 const app=createServer((q,r)=>{r.setHeader('Content-Type','text/html');r.end(`<html style="color:black;background:white"><button id="action" style="width:150px;height:48px">Continue</button><output hidden>Done</output><script>setTimeout(()=>fetch('${origin}/background').then(()=>document.querySelector('output').hidden=false),250)</script></html>`);});await new Promise(r=>app.listen(0,'127.0.0.1',r));
 const pw=createRequire(process.env.QA_PW_PATH)('playwright'),browser=await pw[engine].launch(),out=mkdtempSync(join(tmpdir(),'qa-causal-')),baseURL='http://127.0.0.1:'+app.address().port,observer=observeBuild(baseURL);
 try{const context=await browser.newContext();observer.attach(context);const page=await context.newPage();await page.goto(baseURL);const build=await observer.finish();await context.close();calls=0;
  const recipe={selector:'#action',name:'Continue',role:'button',safe:true,service:true,serviceRequest:{origin,method:'GET'},steps:[{action:'click',selector:'#action'},{action:'visible',selector:'output'}]},flow={id:'entry',url:'/',steps:[],controls:[recipe],breaks:[]},cell={id:'entry',theme:'light',size:'390x660',build,frames:[],failures:[],gaps:[],controls:[]},report={cells:[cell],gaps:[]},config={baseURL,servicePhase:{size:'390x660',theme:'light',limiter:'write',cellLimiter:'load'},serviceIntervals:{write:1,load:1}},queue=terminalQueue({service:true});
  const id=queue.defer({flow,engine,state:{id:'signed-out'},theme:cell.theme,size:cell.size},cell,recipe,'control',config);cell.controls.push({servicePhase:id,status:'deferred'});await queue.run({config,report,out,browsers:new Map([[engine,browser]]),sessions:new Map(),pace:servicePacer(config.serviceIntervals)});
  assert.notEqual(report.serviceChecks[0].status,'pass',JSON.stringify(report));assert.equal(calls,0,'unattributed traffic is not allowed to leave');
 }finally{await browser.close();for(const s of [app,remote]){s.closeAllConnections();await new Promise(r=>s.close(r));}rmSync(out,{recursive:true,force:true});}
});
