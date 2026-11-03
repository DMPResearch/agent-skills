import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runCell} from './cell.mjs';
import {captureStanding} from './standing.mjs';
import {terminalQueue} from './phases.mjs';
import {breakKinds} from './contract.mjs';

for(const engine of ['chromium','webkit'])for(const caller of ['native','standing','terminal'])test(engine+' '+caller+' applies flow-only probe classes and retains unrelated errors',{skip:!process.env.QA_PW_PATH,timeout:15000},async()=>{
 let origin;
 const external=createServer((req,res)=>{res.setHeader('Content-Type','text/javascript');if(req.url.startsWith('/client.js')){res.setHeader('Access-Control-Allow-Origin','*');res.end(`const url='${origin}/probe?request='+crypto.randomUUID();${req.url.includes('no-request')?"throw new Error('Probe failure '+url)":"fetch(url).catch(()=>{throw new Error('Probe failure '+url)})"}`);}else res.end('No cross-origin permission');});
 await new Promise(r=>external.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+external.address().port;
 const app=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(`<html style="background:white;color:black"><h1>Ready</h1><script crossorigin="anonymous" src="${origin}/client.js?${req.url.includes('no-request')?'no-request':'genuine'}"></script>`);});await new Promise(r=>app.listen(0,'127.0.0.1',r));
 const baseURL='http://127.0.0.1:'+app.address().port,out=mkdtempSync(join(tmpdir(),'qa-flow-observation-')),pw=createRequire(process.env.QA_PW_PATH)('playwright'),browsers=new Map(),launches=new Map();let complete=false;
 try{for(const mode of ['genuine','no-request']){
  const observations=[{kind:'external-request',id:'probe',owner:'Transport',reason:'Known cross-origin diagnostic probe',match:{origin,path:'/probe',methods:['GET'],resourceTypes:['fetch']},outcomes:['pending','cancelled'],sameSiteException:{hostname:'127.0.0.1',reason:'Separate fixture service uses the loopback host'}}];
  const flow={id:'entry',url:'/'+mode,states:['signed-out','signed-in'],steps:[{action:'visible',selector:'h1'}],controls:[],breaks:breakKinds.map(kind=>({kind,notApplicable:true,reason:'Read-only entry without controls'})),observations},task={flow,state:{id:'signed-out'},engine,theme:'light',size:'390x660'},config={baseURL,flows:[flow],actionTimeoutMs:1000},report={cells:[],gaps:[]},env={config,report,out,browserModule:pw,browsers,launches,sessions:new Map(),pace:async()=>{}};
  if(caller==='native')await runCell(task,env);
  if(caller==='standing'){
   const adapter={captureStanding:async({context,beginCell})=>{await beginCell(task);const page=await context.newPage();await page.setViewportSize({width:390,height:660});await page.goto(new URL(flow.url,baseURL).href);await page.waitForTimeout(200);const path=join(out,mode+'.png');await page.screenshot({path});const row={screen:flow.id,state:'signed-out',engine,theme:task.theme,size:task.size,path,failures:[]};return {summary:{complete:true},results:[row],interactions:[],edges:[{...row,controls:[],checks:breakKinds.map(kind=>({kind,pass:true}))}]};}};
   await captureStanding([task],{...env,adapter});
  }
  if(caller==='terminal'){
   if(!browsers.has(engine)){const browser=await pw[engine].launch();browsers.set(engine,browser);launches.set(engine,Promise.resolve(browser));}
   const cell={id:'terminal-cell',screen:'entry',state:'signed-out',engine,theme:task.theme,size:task.size,frames:[],controls:[],failures:[],gaps:[]};report.cells.push(cell);
   const queue=terminalQueue();queue.defer(task,cell,{selector:'h1',safe:true,steps:[{action:'visible',selector:'h1'}]},'control');await queue.run(env);
  }
  const cell=report.cells[0];assert.ok(cell,JSON.stringify(report));writeFileSync(join(out,caller+'-'+mode+'.json'),JSON.stringify(report,null,2));
  const receipts=(cell.observations||[]).filter(o=>o.outcome==='page-error');
  if(mode==='genuine'){assert.ok(receipts.length>0,JSON.stringify(report));assert.ok(!cell.failures.some(f=>f.includes('uncaught page error: Probe failure')||f.startsWith('request failed:')),JSON.stringify(cell));}
  else{assert.equal(receipts.length,0,JSON.stringify(report));assert.ok(cell.failures.some(f=>f.includes('uncaught page error: Probe failure')),JSON.stringify(cell));}
 }complete=true;
 }finally{for(const b of browsers.values())await b.close();for(const s of [app,external]){s.closeAllConnections();await new Promise(r=>s.close(r));}if(complete)rmSync(out,{recursive:true,force:true});else console.error('Flow observation evidence retained at '+out);}
});
