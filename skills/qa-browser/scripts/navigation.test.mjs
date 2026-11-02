import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {inspect,steps} from './browser.mjs';

test('inspection retries a replaced document once and retains genuine failures',async()=>{
 for(const errors of [['Execution context was destroyed'],['Execution context was destroyed','Execution context was destroyed'],['real inspection failure']]){
  let remaining=[...errors];
  const frame={waitForLoadState:async()=>{},evaluate:async fn=>{if(remaining.length)throw Error(remaining.shift());if(String(fn).includes('height:'))return {height:0,step:100};return true;}};
  const result=await inspect({frames:()=>[frame],mainFrame:()=>frame});
  assert.deepEqual(result,errors.length===1&&errors[0].includes('destroyed')?[]:['frame inspection failed']);
 }
});

test('critic manifest identifies entry captures explicitly',async()=>{
 const {reviewBatches}=await import('./review.mjs');
 const batch=reviewBatches([{id:'home',screen:'home',engine:'webkit',theme:'light',size:'390x660',frames:['a-entry.png','b-control.png'],entryFrame:'a-entry.png'}])[0];
 assert.deepEqual(batch.frames.map(f=>f.isEntry),[true,false]);
});

test('real navigation classification requires a successful replacement during a tool action',{skip:!process.env.QA_PW_PATH},async()=>{
 const {trackNavigations}=await import('./navigation.mjs');
 const pw=createRequire(process.env.QA_PW_PATH)('playwright');
 const server=createServer((req,res)=>{
  if(req.url==='/stream'){res.writeHead(200,{'Content-Type':'text/html'});res.write('<body>Loading');return;}
  if(['/data','/unowned','/pending'].includes(req.url)){return;}
  if(req.url==='/failed'){res.destroy();return;}
  res.end('<html style="background:white;color:black"><body><a href="/" id="current">Current</a></body></html>');
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{for(const engine of ['webkit','chromium']){
  const browser=await pw[engine].launch();try{
   const page=await browser.newPage(),tracking=trackNavigations(page),url=`http://127.0.0.1:${server.address().port}`;
   const pending=page.waitForEvent('request',r=>r.url().endsWith('/data'));
   const first=tracking.run(()=>page.goto(url+'/data')).catch(()=>{});await pending;
   await tracking.run(()=>page.goto(url));
   await page.waitForTimeout(50);
   assert.equal(tracking.unclassified().length,0,engine+' tool document replacement');
   await page.evaluate(()=>{const c=new AbortController();fetch('/data',{signal:c.signal}).catch(()=>{});setTimeout(()=>c.abort(),30)});
   await page.waitForTimeout(100);
   assert.ok(tracking.unclassified().some(r=>r.url().endsWith('/data')),engine+' fetch cancellation must remain a gap');
   const next=page.waitForEvent('request',r=>r.url().endsWith('/unowned'));
   const unowned=page.goto(url+'/unowned').catch(()=>{});await next;await page.goto(url);await unowned;await first;await page.waitForTimeout(50);
   assert.ok(tracking.unclassified().some(r=>r.url().endsWith('/unowned')),engine+' unowned replacement must remain a gap');
   const requested=page.waitForEvent('request',r=>r.url().endsWith('/pending'));
   const incomplete=page.goto(url+'/pending').catch(()=>{});await requested;
   await tracking.run(()=>page.goto(url+'/failed',{timeout:2000})).catch(()=>{});await page.close();await incomplete;
   assert.ok(tracking.unclassified().some(r=>r.url().endsWith('/pending')),engine+' unsuccessful replacement must remain a gap');
  }finally{await browser.close();}
 }}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});


test('declared no-effect click verifies unchanged current-page navigation and rejects a change',{skip:!process.env.QA_PW_PATH},async()=>{
 const pw=createRequire(process.env.QA_PW_PATH)('playwright');
 for(const engine of ['chromium','webkit']){const browser=await pw[engine].launch();try{
  const page=await browser.newPage();await page.setContent('<button id="current">Current</button>');
  assert.equal((await steps(page,[{action:'no-effect',selector:'#current'}]))[0].unchanged,true);
  await page.locator('#current').evaluate(e=>e.onclick=()=>e.textContent='Changed');
  await assert.rejects(steps(page,[{action:'no-effect',selector:'#current'}]),/changed state/);
 }finally{await browser.close();}}
});


test('explicit successful Back classifies a document cancellation without a replacement request',{skip:!process.env.QA_PW_PATH},async()=>{
 const {trackNavigations}=await import('./navigation.mjs');
 const pw=createRequire(process.env.QA_PW_PATH)('playwright');
 const server=createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.write('<body>Loading');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await pw.webkit.launch();
 try{const page=await browser.newPage(),tracking=trackNavigations(page);let cancellations=0;
  page.on('requestfailed',()=>cancellations++);
  await tracking.run(()=>page.goto(`http://127.0.0.1:${server.address().port}`,{waitUntil:'commit'}));
  await steps(page,[{action:'back'}],page,undefined,tracking.run);
  assert.ok(cancellations>0,'fixture must actually cancel the document');
  assert.equal(tracking.unclassified().length,0,'successful tool history navigation supersedes the pending document');
 }finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
});
