import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runCell} from './cell.mjs';
import {captureStanding} from './standing.mjs';
import {observeBuild} from './provenance.mjs';

for(const engine of ['chromium','webkit'])for(const variant of ['changed','matching','unlisted'])test(engine+' native and standing enforce the served asset manifest: '+variant,{skip:!process.env.QA_PW_PATH,timeout:15000},async()=>{
 let script='globalThis.assetRevision=1;';const expected=createHash('sha256').update(script).digest('hex');
 const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':'text/html');res.end(req.url==='/app.js'?script:'<html style="color:black;background:white"><body><script src="/app.js"></script>Ready</body></html>');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const baseURL=`http://127.0.0.1:${server.address().port}`,out=mkdtempSync(join(tmpdir(),'qa-standing-assets-')),pw=createRequire(process.env.QA_PW_PATH)('playwright'),browsers=new Map(),launches=new Map();
 try{
  const probe=await fetch(baseURL+'/app.js');assert.equal(createHash('sha256').update(await probe.text()).digest('hex'),expected,'initial manifest probe must match');
  if(variant==='changed')script='globalThis.assetRevision=2;';
  const assetHashes=variant==='unlisted'?{'/unused.js':expected}:{'/app.js':expected},flow={id:'entry',url:'/',entry:'entry.js',states:['signed-out','signed-in'],steps:[],controls:[],breaks:[]},task={flow,state:{id:'signed-out'},engine,theme:'light',size:'390x660'},config={baseURL,assetHashes};
  const native={cells:[],gaps:[]};await runCell(task,{config,report:native,out,browserModule:pw,browsers,launches});
  const report={cells:[],gaps:[]},buildObserver=observeBuild(baseURL),adapter={captureStanding:async({context,beginCell})=>{
   await beginCell(task);const page=await context.newPage();await page.setViewportSize({width:390,height:660});await page.goto(baseURL);await page.getByText('Ready',{exact:true}).waitFor();
   const path=join(out,'standing.png');await page.screenshot({path});const row={screen:'entry',state:'signed-out',engine,theme:'light',size:'390x660',path,failures:[]};
   return {summary:{complete:true},results:[row],interactions:[],edges:[{...row,controls:[],checks:['empty','invalid','double-submit','refresh','back-forward','signed-out','signed-in'].map(kind=>({kind,pass:true}))}]};
  }};
  await captureStanding([task],{config,report,adapter,browsers,launches,browserModule:pw,out,pace:async()=>{},sessions:new Map(),buildObserver});
  const standing=report.cells[0];assert.ok(standing,'standing must preserve its capture evidence');
  if(variant==='changed'){
   for(const cell of [native.cells[0],standing])assert.ok(cell.failures.includes('served asset hash mismatch: /app.js'),JSON.stringify(cell));
   assert.equal(standing.functional,'fail');assert.equal(report.standingEntry[0].status,'fail');
   assert.ok((await buildObserver.finish()).assets.some(a=>a.path==='/app.js'&&a.sha256!==expected));
  }else if(variant==='unlisted'){
   for(const cell of [native.cells[0],standing])assert.ok(cell.gaps.some(g=>g==='served build asset absent from manifest: /app.js'));
   assert.equal(standing.complete,false);assert.equal(standing.functional,'incomplete');
  }else{assert.deepEqual(standing.failures,[]);assert.deepEqual(standing.gaps,[]);assert.equal(standing.functional,'pass');}
 }finally{for(const browser of browsers.values())await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));rmSync(out,{recursive:true,force:true});}
});
