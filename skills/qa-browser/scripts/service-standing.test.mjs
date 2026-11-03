import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {captureStanding} from './standing.mjs';
import {terminalQueue,servicePacer} from './phases.mjs';
import {breakKinds} from './contract.mjs';
for(const engine of ['chromium','webkit'])test(engine+' standing capture requires actual service affordance proof and defers the action',{skip:!process.env.QA_PW_PATH,timeout:15000},async()=>{
 let fired=0;const server=createServer((req,res)=>{if(req.url==='/fire')fired++;res.setHeader('Content-Type','text/html');res.end('<html style="color:black;background:white"><button id="action" style="width:140px;height:48px">Continue</button></html>');});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const out=mkdtempSync(join(tmpdir(),'qa-service-standing-')),pw=createRequire(process.env.QA_PW_PATH)('playwright'),browsers=new Map(),launches=new Map();
 try{for(const proof of [false,true,'preloaded']){
  const recipe={selector:'#action',name:'Continue',role:'button',service:true,serviceRequest:{origin:'http://127.0.0.1:1',method:'POST'},safe:true,steps:[{action:'click',selector:'#action'},{action:'visible',selector:'#action'}]},flow={id:'entry',capture:'standing',url:'/',states:['signed-out'],steps:[],controls:[recipe],breaks:[]},task={flow,engine,theme:'light',size:'390x660',state:{id:'signed-out'}},report={cells:[],gaps:[]},config={baseURL:'http://127.0.0.1:'+server.address().port,servicePhase:{size:'390x660',theme:'light',limiter:'remote',cellLimiter:'cell'},serviceIntervals:{remote:10,cell:10}},services=terminalQueue({service:true});
  const adapter={captureStanding:async({context,flow:providerFlow,serviceRecipes,checkService,beginCell})=>{assert.equal(providerFlow.controls[0].terminal,true);const page=await context.newPage();if(proof==='preloaded')await page.goto(config.baseURL);await beginCell({...task,page});await page.setViewportSize({width:390,height:660});await page.goto(config.baseURL);const path=join(out,'frame-'+proof+'.png');await page.screenshot({path});if(proof)await checkService({page,recipe:serviceRecipes.controls[0],kind:'control',theme:task.theme,size:task.size});const row={screen:'entry',state:'signed-out',engine,theme:task.theme,size:task.size,path};return {summary:{complete:true},results:[row],interactions:[{...row,selector:'#action',deferred:true}],edges:[{...row,controls:['#action'],checks:breakKinds.map(kind=>({kind,target:'#action',pass:true}))}]};}};
  await captureStanding([task],{config,report,adapter,out,browsers,launches,browserModule:pw,services,pace:servicePacer(config.serviceIntervals),sessions:new Map()});
  assert.equal(fired,0);if(proof==='preloaded'){assert.equal(report.cells.length,0);assert.ok(report.gaps.some(g=>g.includes('fresh blank page')),JSON.stringify(report));continue;}assert.equal(report.cells.length,1,JSON.stringify(report));const cell=report.cells[0];
  assert.ok(cell.gaps.some(g=>g.startsWith(proof?'service check pending:':'standing service affordance unproven:')),JSON.stringify(report));
  assert.equal(cell.complete,false);
 }}finally{for(const b of browsers.values())await b.close();server.closeAllConnections();await new Promise(r=>server.close(r));rmSync(out,{recursive:true,force:true});}
});
