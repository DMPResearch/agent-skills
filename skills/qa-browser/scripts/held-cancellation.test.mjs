import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {trackNavigations} from './navigation.mjs';

async function deadline(promise){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('held-navigation fixture exceeded its 2000 ms stage deadline')),2000);})]);}finally{clearTimeout(timer);}}
for(const engine of ['chromium','webkit'])test(engine+' cancelled request stays unexplained across a held replacement commit',{skip:!process.env.QA_PW_PATH,timeout:10000},async t=>{
 let releaseNavigation,heldResponse,fetchRouteReady;const held=new Promise(resolve=>{releaseNavigation=resolve;}),routed=new Promise(resolve=>{fetchRouteReady=resolve;});
 const server=createServer((req,res)=>{if(req.url==='/held-next'){heldResponse=res;releaseNavigation(res);return;}res.setHeader('Content-Type','text/html');res.end('<body>Ready</body>');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`,pw=createRequire(process.env.QA_PW_PATH)('playwright'),browser=await pw[engine].launch(),events=[];
 try{
  const page=await browser.newPage(),navigation=trackNavigations(page);page.setDefaultTimeout(2000);page.setDefaultNavigationTimeout(2000);
  page.on('requestfailed',request=>{if(request.url()===base+'/slow-data')events.push('request-cancelled');});
  page.on('framenavigated',frame=>{if(frame===page.mainFrame()&&frame.url()===base+'/held-next')events.push('replacement-committed');});
  await page.route('**/slow-data',route=>{fetchRouteReady(route);});await page.goto(base);
  await page.evaluate(url=>{fetch(url).then(r=>r.text()).catch(()=>{});},base+'/slow-data');const route=await deadline(routed),request=route.request();
  const cancelled=page.waitForEvent('requestfailed',r=>r===request);events.push('navigation-started');const moving=navigation.run(()=>page.goto(base+'/held-next'));moving.catch(()=>{});
  const response=await deadline(held);events.push('navigation-held');const aborting=route.abort('aborted');aborting.catch(()=>{});
  const failed=await deadline(cancelled);assert.match(failed.failure().errorText,/ABORTED|cancelled|canceled/i);assert.ok(!events.includes('replacement-committed'),'fixture committed before observing cancellation');
  events.push('navigation-released');response.setHeader('Content-Type','text/html');response.end('<body>Next</body>');
  await deadline(moving);const abortResult=await deadline(Promise.allSettled([aborting]));
  t.diagnostic(JSON.stringify({events,abortResult:abortResult[0].status,...abortResult[0].status==='rejected'?{abortError:abortResult[0].reason.message}:{}}));
  assert.ok(events.indexOf('request-cancelled')<events.indexOf('replacement-committed'));assert.ok(navigation.unclassified().includes(request));assert.ok(!navigation.cancellations().some(r=>r.url===request.url()));
 }finally{heldResponse?.end();await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
