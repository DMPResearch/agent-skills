import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
test('capture build identifies the actual served documents and first-party assets',{skip:!process.env.QA_PW_PATH},async()=>{
 const {observeBuild}=await import('./provenance.mjs');let script='window.ready=true';
 const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':'text/html');res.end(req.url==='/app.js'?script:'<html><body><script src="/app.js"></script></body></html>');});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const url=`http://127.0.0.1:${server.address().port}`,browser=await createRequire(process.env.QA_PW_PATH)('playwright').chromium.launch();
 try{const context=await browser.newContext(),observer=observeBuild(url);observer.attach(context);const page=await context.newPage();await page.goto(url);const first=await observer.finish();assert.equal(first.assets.length,2);assert.ok(first.assets.some(a=>a.path==='/app.js'));script='window.ready=false';await page.reload();const second=await observer.finish();assert.notEqual(first.id,second.id);}finally{await browser.close();await new Promise(r=>server.close(r));}
});
