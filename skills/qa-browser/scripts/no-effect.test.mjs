import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {validate} from './contract.mjs';
import {steps} from './browser.mjs';

const flow={id:'home',url:'/',entry:'home.js',main:true,states:['signed-out'],steps:[],controls:[],breaks:[]};
const config=f=>({version:1,baseURL:'http://localhost',flows:[f]});
test('no-effect is bound to its declared control and only its final step',()=>{
 const noEffect={action:'no-effect',selector:'#dead'};
 const control={selector:'#dead',safe:true,steps:[noEffect]};
 assert.doesNotThrow(()=>validate(config({...flow,controls:[control]})));
 for(const invalid of [
  {...flow,controls:[{...control,steps:[{...noEffect,selector:'#ok'}]}]},
  {...flow,controls:[{...control,steps:[noEffect,{action:'visible',selector:'#dead'}]}]},
  {...flow,controls:[{...control,steps:[{...noEffect,role:'button'}]}]},
  {...flow,steps:[noEffect]},
  {...flow,breaks:[{kind:'signed-out',steps:[noEffect]}]},
  {...flow,states:[{id:'signed-out',setup:[noEffect]}]}
 ])assert.throws(()=>validate(config(invalid)),/no-effect/);
});

for(const engine of ['chromium','webkit'])test(engine+' rejects delayed no-effect mutations',{skip:!process.env.QA_PW_PATH},async()=>{
 const pw=createRequire(process.env.QA_PW_PATH)('playwright');
 const server=createServer((req,res)=>res.end('<html><body><button id="current">Current</button></body></html>'));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await pw[engine].launch();
 try{const page=await browser.newPage();
  for(const change of [
   ()=>{document.body.append('Changed');document.body.className='changed'},
   ()=>document.documentElement.setAttribute('data-state','changed'),
   ()=>document.body.setAttribute('data-state','changed'),
   ()=>localStorage.setItem('state','changed'),
   ()=>sessionStorage.setItem('state','changed'),
   ()=>history.pushState({},'','/?changed')
  ]){
   await page.goto(`http://127.0.0.1:${server.address().port}`);
   await page.evaluate(()=>{localStorage.clear();sessionStorage.clear()});
   await page.locator('#current').evaluate((e,code)=>e.onclick=()=>setTimeout(()=>eval('('+code+')()'),400),change.toString());
   await assert.rejects(steps(page,[{action:'no-effect',selector:'#current'}]),/changed state/,engine+' '+change.toString());
  }
 }finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
});


for(const engine of ['chromium','webkit'])test(engine+' busy no-effect check ends as an incomplete cell',{skip:!process.env.QA_PW_PATH},async()=>{
 const {runCell}=await import('./cell.mjs');const {verdict}=await import('./contract.mjs');
 const {mkdtempSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const pw=createRequire(process.env.QA_PW_PATH)('playwright'),browsers=new Map(),launches=new Map();
 const out=mkdtempSync(join(tmpdir(),'qa-no-effect-'));
 const server=createServer((req,res)=>{if(req.url==='/busy')return;res.end('<html style="background:white;color:black"><body><button id="current" onclick="fetch(\'/busy\')">Current</button></body></html>')});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  const f={...flow,controls:[{selector:'#current',safe:true,steps:[{action:'no-effect',selector:'#current'}]}]},report={cells:[],gaps:[]};
  const c=validate({...config(f),baseURL:`http://127.0.0.1:${server.address().port}`});
  await runCell({flow:f,engine,theme:'light',size:'390x660',state:{id:'signed-out'}},{config:c,report,out,browserModule:pw,browsers,launches});
  const cell=report.cells[0];assert.ok(cell.gaps.some(g=>g.includes('no-effect did not settle')));
  assert.ok(!cell.controls.some(c=>c.selector==='#current'&&c.status==='pass'));
  assert.equal(cell.complete,false);assert.equal(verdict(report.cells,report.gaps),'incomplete');assert.deepEqual(cell.failures,[]);
 }finally{for(const browser of browsers.values())await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));rmSync(out,{recursive:true,force:true});}
});
