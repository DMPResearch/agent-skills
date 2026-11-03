import {matrixBoundary} from './service-boundary.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runCell} from './cell.mjs';
async function exercise({attempts=10,holdAbort=0,holdRoute=0,holdDecision=0}={}){
 const events=[];let calls=0,upgrades=0,complete=false;
 const remote=createServer((q,r)=>{calls++;events.push({event:'server-request',at:performance.now(),method:q.method,path:new URL(q.url,'http://fixture').pathname});r.setHeader('Access-Control-Allow-Origin','*');r.end('Ready');});remote.on('upgrade',(_q,s)=>{upgrades++;events.push({event:'server-upgrade',at:performance.now()});s.destroy();});await new Promise(r=>remote.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+remote.address().port;
 const app=createServer((_q,r)=>{r.setHeader('Content-Type','text/html');r.end(`<html style="background:white;color:black"><button type="button" id="send" style="width:150px;height:48px" onclick="${holdDecision?'':`new WebSocket('${origin.replace('http','ws')}/socket');`}fetch('${origin}/send')">Send</button></html>`);});await new Promise(r=>app.listen(0,'127.0.0.1',r));
 const pw=createRequire(process.env.QA_PW_PATH)('playwright'),browsers=new Map(),launches=new Map(),out=mkdtempSync(join(process.env.QA_BOUNDARY_EVIDENCE||tmpdir(),'qa-webkit-teardown-'));const rows=[],holds=[];
 const browserModule={...pw,webkit:{launch:async()=>{const browser=await pw.webkit.launch(),create=browser.newContext.bind(browser);browser.newContext=async options=>{const context=await create(options),register=context.route.bind(context);context.route=async(pattern,handler)=>register(pattern,async route=>{if(route.request().url()===origin+'/send'){if(holdRoute)await new Promise(r=>setTimeout(r,holdRoute));if(holdAbort){const delayed=new Proxy(route,{get(target,key){if(key==='abort')return async(...args)=>{await new Promise(r=>setTimeout(r,holdAbort));return target.abort(...args);};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});return handler(delayed);}}return handler(route);});if(holdDecision){const createPage=context.newPage.bind(context);let patched=false;context.newPage=async options=>{const page=await createPage(options),boundary=await matrixBoundary(context);if(!patched){patched=true;const arm=boundary.action.bind(boundary);boundary.action=(handler,reject)=>arm(route=>{if(route.request().url()===origin+'/send'){const task=(async()=>{await new Promise(r=>setTimeout(r,holdDecision));return handler(route);})();holds.push(task);return task;}return handler(route);},reject);}return page;};}return context;};return browser;}}};
 try{for(let attempt=0;attempt<attempts;attempt++){
  const recipe={selector:'#send',name:'Send',role:'button',safe:true,service:true,serviceRequest:{origin,method:'GET'},steps:[{action:'click',selector:'#send'},{action:'visible',selector:'#send'}]},flow={id:'attempt'+attempt,url:'/',states:['signed-out'],steps:[],controls:[recipe],breaks:[]},config={baseURL:'http://127.0.0.1:'+app.address().port,flows:[flow],actionTimeoutMs:1000},report={cells:[],gaps:[]};
  await runCell({flow,engine:'webkit',theme:'light',size:'390x660',state:{id:'signed-out'}},{config,report,out,browserModule,browsers,launches,services:{defer:()=> 'phase'}});await Promise.all(holds);await new Promise(r=>setTimeout(r,25));rows.push({attempt,cell:report.cells[0]});writeFileSync(join(out,'trace.json'),JSON.stringify({calls,upgrades,events,rows},null,2));
  assert.equal(calls,0,'zero HTTP service egress; retained '+out);assert.equal(upgrades,0,'zero WebSocket handshakes');
  const diagnostics=report.cells[0].diagnostics.filter(d=>d.kind==='service-boundary'),request=diagnostics.find(d=>d.event==='request-observed'&&d.url===origin+'/send');assert.ok(request,'fetch must be observed');
  const ack=diagnostics.find(d=>d.event==='abort-acknowledged'&&d.request===request.request),closed=diagnostics.find(d=>d.event==='page-closed');assert.ok(ack&&closed&&ack.at<=closed.at,'abort acknowledgement must precede the native close event');assert.equal(closed.pending,0);assert.equal(closed.waiting,0);
  if(holdDecision)assert.ok(report.cells[0].failures.some(f=>f.includes('pending interception required abort at teardown')),'forced abort must fail this cell');
  if(holdRoute)assert.ok(report.cells[0].failures.some(f=>f.includes('pending interception/action unresolved after 2000 ms')),'over-bound routing must fail this cell');
  else assert.ok(!diagnostics.some(d=>d.event==='drain-failed'),'normal routing must settle inside the bound');
 }complete=true;}
 finally{for(const b of browsers.values())await b.close();for(const s of [app,remote]){s.closeAllConnections();await new Promise(r=>s.close(r));}if(complete&&!process.env.QA_BOUNDARY_EVIDENCE)rmSync(out,{recursive:true,force:true});else console.error('Teardown evidence retained at '+out);}
}
for(const [name,options]of [['normal',{attempts:10}],['delayed abort acknowledgement',{attempts:1,holdAbort:150}],['request beyond drain bound',{attempts:1,holdRoute:2500}],['forced pending decision',{attempts:1,holdDecision:2500}]])test('WebKit close barrier: '+name,{skip:!process.env.QA_PW_PATH,timeout:15000},()=>exercise(options));
