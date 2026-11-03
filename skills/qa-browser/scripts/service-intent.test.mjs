import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runCell} from './cell.mjs';
for(const engine of ['chromium','webkit'])test(engine+' matrix service intent really activates the control and blocks egress',{skip:!process.env.QA_PW_PATH,timeout:15000},async()=>{
 let calls=0;const remote=createServer((q,r)=>{calls++;r.setHeader('Access-Control-Allow-Origin','*');r.end('Ready');});await new Promise(r=>remote.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+remote.address().port;
 const app=createServer((q,r)=>{r.setHeader('Content-Type','text/html');r.end(`<html style="background:white;color:black"><button id="action" style="width:150px;height:48px" onclick="if(innerWidth===412)return;fetch('${origin}/send')">Continue</button></html>`);});await new Promise(r=>app.listen(0,'127.0.0.1',r));
 const pw=createRequire(process.env.QA_PW_PATH)('playwright'),browsers=new Map(),launches=new Map(),out=mkdtempSync(join(tmpdir(),'qa-service-intent-'));
 try{for(const size of ['390x660','412x620']){
  const recipe={service:true,serviceRequest:{origin,method:'GET'},safe:true,selector:'#action',name:'Continue',role:'button',steps:[{action:'click',selector:'#action'},{action:'visible',selector:'#action'}]},flow={id:'entry',url:'/',states:['signed-out'],steps:[],controls:[recipe],breaks:[]},report={cells:[],gaps:[]},config={baseURL:'http://127.0.0.1:'+app.address().port,flows:[flow],actionTimeoutMs:700};
  const services={defer:()=> 'phase'};await runCell({flow,engine,size,theme:'light',state:{id:'signed-out'}},{config,report,out,browserModule:pw,browsers,launches,services});
  assert.equal(calls,0,'no service request leaves matrix');
  const cell=report.cells[0];if(size==='412x620')assert.ok(cell.failures.some(f=>f.includes('intent did not attempt')),JSON.stringify(cell));else assert.ok(cell.controls.some(r=>r.intent?.outcome==="intent proved; this action's request was stopped before leaving the browser")||cell.gaps.some(g=>g.includes('initiator unavailable')),JSON.stringify(cell));
 }}finally{for(const b of browsers.values())await b.close();for(const s of [app,remote]){s.closeAllConnections();await new Promise(r=>s.close(r));}rmSync(out,{recursive:true,force:true});}
});
