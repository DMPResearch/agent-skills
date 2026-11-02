import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runCell} from './cell.mjs';

const enabled=!!process.env.QA_PW_PATH;
async function fixture(html,check){
 const pw=createRequire(process.env.QA_PW_PATH)('playwright');
 const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<html style="background:white;color:black"><body>'+html+'</body></html>');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const out=mkdtempSync(join(tmpdir(),'qa-gate-')),browsers=new Map(),launches=new Map();
 try{for(const engine of ['chromium','webkit']){
  const run=async change=>{
   const flow={id:'entry',entry:'entry.js',url:'/',main:true,states:['signed-out','signed-in'],steps:[],controls:[],breaks:[],...change};
   const report={cells:[],gaps:[]};
   await runCell({flow,engine,theme:'light',size:'390x660',state:{id:'signed-out'}},{config:{baseURL:`http://127.0.0.1:${server.address().port}`,flows:[flow],actionTimeoutMs:500,maxStates:4},report,out,browserModule:pw,browsers,launches});
   return report.cells[0];
  };
  await check(run,engine);
 }}finally{for(const b of browsers.values())await b.close();await new Promise(r=>server.close(r));rmSync(out,{recursive:true,force:true});}
}

test('declarations stay bound after an earlier control replaces the document',{skip:!enabled},()=>fixture(`<button data-first onclick="document.body.innerHTML='<p>Replaced</p>'">Replace</button><button data-second onclick="document.querySelector('output').hidden=false">Reveal</button><output hidden>Revealed</output>`,async(run,engine)=>{
 const cell=await run({controls:[
  {selector:'[data-first]',safe:true,steps:[{action:'click',selector:'[data-first]'},{action:'text',selector:'body',value:'Replaced'}]},
  {selector:'[data-second]',safe:true,steps:[{action:'click',selector:'[data-second]'},{action:'visible',selector:'output'}]}
 ]});
 assert.ok(cell.controls.some(c=>c.selector==='[data-second]'&&c.status==='pass'),engine+' lost original binding');
 assert.ok(!cell.gaps.some(g=>g.includes('unmapped visible control: button Reveal')));
}));

test('declared break aliases cover accessible input names while actions bind CSS',{skip:!enabled},()=>fixture('<input name="entry" aria-label="Entry label">',async(run)=>{
 const target='input[name="entry"]';
 const cell=await run({breaks:['empty','invalid','double-submit','refresh'].map(kind=>({kind,target,coverageTarget:'Entry label',safe:true,steps:[...(kind==='empty'?[{action:'fill',selector:target,value:''}]:kind==='invalid'?[{action:'fill',selector:target,value:'bad'}]:kind==='double-submit'?[{action:'double-click',selector:target}]:[{action:'reload'}]),{action:'visible',selector:target}]}))});
 assert.ok(!cell.gaps.some(g=>g.includes('Entry label')),JSON.stringify(cell.gaps));
 assert.equal(cell.controls.filter(c=>c.break&&c.status==='pass').length,4);
}));

test('each break capture has its own identity even for repeated break kinds',{skip:!enabled},()=>fixture('<input id="one" aria-label="One"><input id="two" aria-label="Two">',async(run)=>{
 const cell=await run({breaks:['#one','#two'].map(target=>({kind:'invalid',target,safe:true,steps:[{action:'fill',selector:target,value:'bad'},{action:'value',selector:target,value:'bad'}]}))});
 assert.equal(new Set(cell.frames).size,cell.frames.length,'captured states overwrite one another');
}));

test('runtime diagnostics retain the actual exception and cell identity',{skip:!enabled},()=>fixture('<script>setTimeout(()=>{throw Error("Fixture exception detail")},10)</script>',async(run,engine)=>{
 const cell=await run({steps:[{action:'visible',selector:'body'}]});
 const error=cell.diagnostics?.find(d=>d.kind==='pageerror');
 assert.match(error?.message||'',/Fixture exception detail/);
 assert.match(error.stack,/Fixture exception detail/);
 assert.equal(error.flow,'entry');assert.equal(error.state,'signed-out');assert.equal(error.engine,engine);assert.equal(error.viewport,'390x660');
}));
