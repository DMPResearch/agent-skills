import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {serviceAction} from './service-action.mjs';
for(const engine of ['chromium','webkit'])test(engine+' native form intent is intercepted and its real request is attributable',{skip:!process.env.QA_PW_PATH,timeout:10000},async()=>{
 let baseURL,calls=0;const provider=createServer((q,r)=>r.end('<h1>Provider</h1>'));await new Promise(r=>provider.listen(0,'127.0.0.1',r));const providerOrigin='http://127.0.0.1:'+provider.address().port;const remote=createServer((q,r)=>{calls++;r.writeHead(302,{Location:q.url==='/handoff'?providerOrigin:baseURL+'/ready'});r.end();});await new Promise(r=>remote.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+remote.address().port;
 const app=createServer((q,r)=>{r.setHeader('Content-Type','text/html');r.end(q.url==='/ready'?'<h1 id="code">Code</h1>':`<form action="${origin}${q.url==='/handoff'?'/handoff':'/send'}" method="post"><button id="send">Send</button></form>`);});await new Promise(r=>app.listen(0,'127.0.0.1',r));baseURL='http://127.0.0.1:'+app.address().port;
 const pw=createRequire(process.env.QA_PW_PATH)('playwright'),browser=await pw[engine].launch();
 try{for(const mode of ['intent','real']){const page=await browser.newPage();await page.goto(baseURL);const recipe={selector:'#send',serviceRequest:{origin,method:'POST'},steps:[{action:'click',selector:'#send'},{action:'visible',selector:'#code'}]};const proof=await serviceAction(page,page,recipe,{mode,baseURL});assert.equal(proof.status,'pass');assert.equal(calls,mode==='real'?1:0);if(mode==='intent')assert.equal(proof.outcome,"intent proved; this action's request was stopped before leaving the browser");else assert.equal(await page.locator('#code').count(),1);await page.close();}
 const page=await browser.newPage();page.setDefaultTimeout(700);await page.goto(baseURL+'/handoff');const receipt=await serviceAction(page,page,{selector:'#send',serviceRequest:{origin,method:'POST'},steps:[{action:'handoff',selector:'#send',origin:providerOrigin}]},{mode:'real',baseURL});assert.equal(receipt.effects[0].origin,providerOrigin);assert.equal(page.isClosed(),true);assert.equal(calls,2);}
 finally{await browser.close();for(const s of [app,remote,provider]){s.closeAllConnections();await new Promise(r=>s.close(r));}}
});
