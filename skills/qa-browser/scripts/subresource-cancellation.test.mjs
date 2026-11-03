import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {trackNavigations} from './navigation.mjs';

for(const engine of ['chromium','webkit'])test(engine+' subresource cancellation needs a committed tool document replacement',{skip:!process.env.QA_PW_PATH,timeout:12000},async()=>{
 const server=createServer((req,res)=>{if(req.url==='/stream'){res.writeHead(200);res.write('pending');return;}res.setHeader('Content-Type','text/html');res.end('<body>Ready</body>');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`,pw=createRequire(process.env.QA_PW_PATH)('playwright'),browser=await pw[engine].launch();
 try{
  const page=await browser.newPage(),tracker=trackNavigations(page),cancelled=[],active=new Set();let atCommit=new Set();
  page.on('request',r=>active.add(r));page.on('requestfinished',r=>active.delete(r));page.on('requestfailed',r=>{active.delete(r);cancelled.push(r);});page.on('framenavigated',frame=>{if(frame===page.mainFrame()&&frame.url()===base+'/next')atCommit=new Set(active);});
  await tracker.run(()=>page.goto(base));
  const pending=page.waitForEvent('response',r=>r.url()===base+'/stream');await page.evaluate(()=>{fetch('/stream').then(r=>r.text()).catch(()=>{});});const response=await pending;
  await tracker.run(()=>page.goto(base+'/next'));await page.waitForTimeout(100);
  const receipt=tracker.cancellations().find(r=>r.url===base+'/stream');
  if(cancelled.includes(response.request())){
   if(atCommit.has(response.request())){assert.ok(receipt);assert.equal(receipt.replacement,base+'/next');assert.ok(receipt.generation>=1);}
   else{assert.ok(tracker.unclassified().includes(response.request()),'a request ended before commit must remain unexplained');assert.equal(receipt,undefined);}
  }
  else assert.equal(receipt,undefined,'no cancellation receipt without a browser cancellation event');
  const next=page.waitForEvent('response',r=>r.url()===base+'/stream');await page.evaluate(()=>{window.abort=new AbortController();fetch('/stream',{signal:abort.signal}).then(r=>r.text()).catch(()=>{});});await next;
  await tracker.run(()=>page.evaluate(()=>{history.replaceState({},'',location.pathname+'#same');abort.abort();}));await page.waitForTimeout(100);
  assert.ok(tracker.unclassified().some(r=>r.url()===base+'/stream'),'same-document mutation hid an explicit abort');
 }finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
});
