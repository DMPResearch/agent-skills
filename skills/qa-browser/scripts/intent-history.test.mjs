import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runCell} from './cell.mjs';
for(const engine of ['chromium','webkit'])test(engine+' intent abort cannot excuse a first-party request cancelled earlier',{skip:!process.env.QA_PW_PATH,timeout:15000},async()=>{
 let calls=0;const external=createServer((q,r)=>{calls++;r.end('Ready');});await new Promise(r=>external.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+external.address().port;
 const app=createServer((q,r)=>{if(q.url==='/held')return;r.setHeader('Content-Type','text/html');r.end(`<html style="color:black;background:white"><form method="post" action="${origin}/send"><button id="send" style="width:150px;height:48px">Send</button></form><script>const c=new AbortController;fetch('/held',{signal:c.signal}).catch(()=>document.body.dataset.ready='yes');setTimeout(()=>c.abort(),50)</script></html>`);});await new Promise(r=>app.listen(0,'127.0.0.1',r));
 const pw=createRequire(process.env.QA_PW_PATH)('playwright'),browsers=new Map(),launches=new Map(),out=mkdtempSync(join(tmpdir(),'qa-intent-history-'));
 try{const recipe={selector:'#send',safe:true,service:true,name:'Send',role:'button',serviceRequest:{origin,method:'POST'},steps:[{action:'click',selector:'#send'},{action:'visible',selector:'#send'}]},flow={id:'entry',url:'/',states:['signed-out'],steps:[],controls:[recipe],breaks:[]},report={cells:[]};await runCell({flow,engine,theme:'light',size:'390x660',state:{id:'signed-out'}},{config:{baseURL:'http://127.0.0.1:'+app.address().port,flows:[flow]},report,out,browserModule:pw,browsers,launches,adapter:{enter:async({page})=>page.locator('body[data-ready]').waitFor()},services:{defer:()=> 'phase'}});assert.equal(calls,0);assert.ok(report.cells[0].controls.some(c=>c.intent?.status==='pass'),JSON.stringify(report));assert.ok(report.cells[0].gaps.some(g=>g.includes('unclassified cancelled request')&&g.includes('/held')),JSON.stringify(report));}
 finally{for(const b of browsers.values())await b.close();for(const s of [app,external]){s.closeAllConnections();await new Promise(r=>s.close(r));}rmSync(out,{recursive:true,force:true});}
});
