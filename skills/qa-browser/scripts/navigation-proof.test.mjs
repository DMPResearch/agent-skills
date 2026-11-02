import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir,loadavg} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {runCell} from './cell.mjs';
import {validate,verdict} from './contract.mjs';

test('same-URL link needs no readiness workaround and never supplies a visual verdict',{skip:!process.env.QA_PW_PATH},async()=>{
 const busy=[],exits=[],samples=[],browsers=new Map(),launches=new Map();
 const out=process.env.QA_NAV_OUT||mkdtempSync(join(tmpdir(),'qa-navigation-'));mkdirSync(out,{recursive:true});
 const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><html style="background:white;color:black"><body><h1>Home</h1><a id="current" href="/">Current page</a></body></html>');});
 try{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  if(process.env.QA_NAV_STRESS==='1')for(let i=0;i<30;i++){const child=spawn(process.execPath,['-e','while(true){}'],{stdio:'ignore'});busy.push(child);exits.push(once(child,'exit'));}
  const baseURL=`http://127.0.0.1:${server.address().port}`,url={action:'url',value:baseURL+'/'};
  const flow={id:'home',url:'/',entry:'home.js',main:true,states:['signed-out','signed-in'],steps:[],controls:[{selector:'#current',safe:true,steps:[{action:'no-effect',selector:'#current'}]}],breaks:[
   ...['empty','invalid'].map(kind=>({kind,notApplicable:true,reason:'No inputs or forms'})),
   {kind:'double-submit',target:'#current',safe:true,steps:[{action:'double-click',selector:'#current'},url]},
   {kind:'refresh',target:'#current',safe:true,steps:[{action:'reload'},url]},
   {kind:'back-forward',target:'#current',safe:true,steps:[{action:'click',selector:'#current'},{action:'back'},{action:'forward'},url]},
   ...['signed-out','signed-in'].map(kind=>({kind,target:'body',safe:true,steps:[{action:'visible',selector:'body'}]}))
  ]};
  const config=validate({version:1,baseURL,flows:[flow]}),pw=createRequire(process.env.QA_PW_PATH)('playwright');
  for(const engine of ['chromium','webkit'])for(let run=0;run<Number(process.env.QA_NAV_RUNS||1);run++){
   const report={cells:[],gaps:[]},before=loadavg();
   await runCell({flow,engine,theme:'light',size:'390x660',state:{id:'signed-out'}},{config,report,out,browserModule:pw,browsers,launches});
   const cell=report.cells[0];samples.push({engine,run,loadBefore:before,loadAfter:loadavg(),cell});
   writeFileSync(join(out,'navigation-proof.json'),JSON.stringify({busyProcesses:busy.length,samples},null,2));
   assert.deepEqual(cell.failures,[],engine+' run '+run);assert.deepEqual(cell.gaps,[],engine+' run '+run);
   assert.equal(cell.complete,true);assert.ok(cell.entryFrame);assert.equal(verdict(report.cells,report.gaps),'incomplete','missing visual verdict must never pass');
  }
 }finally{
  for(const child of busy)child.kill('SIGTERM');await Promise.all(exits);
  for(const browser of browsers.values())await browser.close();
  server.closeAllConnections();await new Promise(r=>server.close(r));
  if(!process.env.QA_NAV_OUT)rmSync(out,{recursive:true,force:true});
 }
});
