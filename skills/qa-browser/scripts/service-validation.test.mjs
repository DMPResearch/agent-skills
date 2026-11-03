import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runCell} from './cell.mjs';
for(const engine of ['chromium','webkit'])test(engine+' local invalid validation cannot send even a delayed service request',{skip:!process.env.QA_PW_PATH,timeout:15000},async()=>{
 let calls=0;const external=createServer((q,r)=>{calls++;r.end('Ready');});await new Promise(r=>external.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+external.address().port;
 const app=createServer((q,r)=>{r.setHeader('Content-Type','text/html');r.end(`<html style="color:black;background:white"><label for="value">Value</label><input id="value" oninput="setTimeout(()=>fetch('${origin}/send',{method:'POST'}),200)"></html>`);});await new Promise(r=>app.listen(0,'127.0.0.1',r));
 const pw=createRequire(process.env.QA_PW_PATH)('playwright'),browsers=new Map(),launches=new Map(),out=mkdtempSync(join(tmpdir(),'qa-local-egress-'));
 try{const flow={id:'entry',url:'/',states:['signed-out'],steps:[],controls:[],breaks:[{kind:'invalid',target:'#value',safe:true,steps:[{action:'fill',selector:'#value',value:'x'},{action:'value',selector:'#value',value:'x'}]}]},report={cells:[]};await runCell({flow,engine,theme:'light',size:'390x660',state:{id:'signed-out'}},{config:{baseURL:'http://127.0.0.1:'+app.address().port,flows:[flow]},report,out,browserModule:pw,browsers,launches});assert.equal(calls,0);assert.ok(report.cells[0].failures.some(f=>f.includes('local validation attempted')),JSON.stringify(report));}
 finally{for(const b of browsers.values())await b.close();for(const s of [app,external]){s.closeAllConnections();await new Promise(r=>s.close(r));}rmSync(out,{recursive:true,force:true});}
});
