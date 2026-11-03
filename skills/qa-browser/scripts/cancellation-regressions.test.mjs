import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runCell} from './cell.mjs';
import {captureStanding} from './standing.mjs';
import {trackNavigations} from './navigation.mjs';

async function fixture(engine,check){
 const server=createServer((req,res)=>{if(req.url.startsWith('/required-data')){res.writeHead(200);res.write('pending');return;}res.setHeader('Content-Type','text/html');res.end('<html style="color:black;background:white"><body>Ready</body></html>');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const baseURL=`http://127.0.0.1:${server.address().port}`,pw=createRequire(process.env.QA_PW_PATH)('playwright'),out=mkdtempSync(join(tmpdir(),'qa-cancel-regression-')),browsers=new Map(),launches=new Map();
 try{await check({baseURL,pw,out,browsers,launches,engine});}
 finally{for(const browser of browsers.values())await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));rmSync(out,{recursive:true,force:true});}
}
async function abort(page,url){
 const response=page.waitForEvent('response',r=>r.url()===url);await page.evaluate(url=>{globalThis.abortRequest=new AbortController();fetch(url,{signal:abortRequest.signal}).then(r=>r.text()).catch(()=>{});},url);await response;
 const failed=page.waitForEvent('requestfailed',r=>r.url()===url);await page.evaluate(()=>abortRequest.abort());return failed;
}
const breaks=[...['empty','invalid','double-submit'].map(kind=>({kind,notApplicable:true,reason:'No inputs or submission controls'})),...['refresh','back-forward','signed-out','signed-in'].map(kind=>({kind,target:'body',safe:true,state:kind.startsWith('signed-')?kind:undefined,steps:[...(kind==='refresh'?[{action:'reload'}]:kind==='back-forward'?[{action:'back'},{action:'forward'}]:[]),{action:'text',selector:'body',value:'Ready'}]}))];
for(const engine of ['chromium','webkit']){
 test(engine+' later replay cannot excuse an already aborted first-party request',{skip:!process.env.QA_PW_PATH,timeout:12000},()=>fixture(engine,async env=>{
  const flow={id:'entry',url:'/',states:['signed-out','signed-in'],steps:[],controls:[],breaks},report={cells:[],gaps:[]};let visits=0;
  const adapter={enter:async({page})=>{if(++visits===1)await abort(page,env.baseURL+'/required-data');}};
  await runCell({flow,state:{id:'signed-out'},engine,theme:'light',size:'390x660'},{config:{baseURL:env.baseURL},report,out:env.out,browserModule:env.pw,browsers:env.browsers,launches:env.launches,adapter});
  const cell=report.cells[0];assert.equal(cell.complete,false);assert.ok(cell.gaps.some(g=>g.includes('unclassified cancelled request')&&g.includes('/required-data')));assert.ok(!cell.diagnostics.some(d=>d.kind==='navigation-cancellation'&&d.url.endsWith('/required-data')));
 }));
 for(const closed of [false,true])test(engine+' standing abort remains incomplete on '+(closed?'a closed page':'an open page'),{skip:!process.env.QA_PW_PATH,timeout:12000},()=>fixture(engine,async env=>{
  const flow={id:'entry',url:'/',states:['signed-out'],steps:[],controls:[],breaks:[]},task={flow,state:{id:'signed-out'},engine,theme:'light',size:'390x660'},report={cells:[],gaps:[]};
  const adapter={captureStanding:async({context,beginCell})=>{
   await beginCell(task);const page=await context.newPage();await page.setViewportSize({width:390,height:660});await page.goto(env.baseURL);
   const source=closed?await context.newPage():page;if(closed)await source.goto(env.baseURL);await abort(source,env.baseURL+'/required-data');if(closed)await source.close();
   const path=join(env.out,'entry.png');await page.screenshot({path});const row={screen:'entry',state:'signed-out',engine,theme:'light',size:'390x660',path,failures:[]};
   return {summary:{complete:true},results:[row],interactions:[],edges:[{...row,controls:[],checks:['empty','invalid','double-submit','refresh','back-forward','signed-out','signed-in'].map(kind=>({kind,pass:true}))}]};
  }};
  await captureStanding([task],{config:{baseURL:env.baseURL},report,adapter,browsers:env.browsers,launches:env.launches,browserModule:env.pw,out:env.out,pace:async()=>{},sessions:new Map()});
  const cell=report.cells[0];assert.equal(cell.complete,false);assert.equal(cell.functional,'incomplete');assert.ok(cell.gaps.some(g=>g.includes('unclassified cancelled request')&&g.includes('/required-data')));assert.equal(report.standingEntry[0].status,'incomplete');
 }));
 test(engine+' abort before a navigation starts inside the same tool action stays unexplained',{skip:!process.env.QA_PW_PATH,timeout:12000},()=>fixture(engine,async env=>{
  const browser=await env.pw[engine].launch();env.browsers.set(engine,browser);const page=await browser.newPage(),nav=trackNavigations(page);await nav.run(()=>page.goto(env.baseURL));
  let request;await nav.run(async()=>{request=await abort(page,env.baseURL+'/required-data');await page.goto(env.baseURL+'/next');});
  assert.ok(nav.unclassified().includes(request));assert.deepEqual(nav.cancellations(),[]);
 }));
}
