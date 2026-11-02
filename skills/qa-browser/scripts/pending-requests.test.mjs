import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {runCell} from './cell.mjs';
import {command} from './process.mjs';
const enabled=!!process.env.QA_PW_PATH;

for(const ms of [300,1500])test('late POST 500 is observed before a control or terminal check passes: '+ms,{skip:!enabled,timeout:30000},async()=>{
 const server=createServer((req,res)=>{
  if(req.url==='/save'){setTimeout(()=>{res.writeHead(500);res.end('Failed');},ms);return;}
  res.setHeader('Content-Type','text/html');res.end('<html style="background:white;color:black"><body><button id="save" onclick="fetch(\'/save\',{method:\'POST\'});this.textContent=\'Saved\'">Save</button></body></html>');
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const out=mkdtempSync(join(tmpdir(),'qa-pending-')),pw=createRequire(process.env.QA_PW_PATH)('playwright'),browsers=new Map(),launches=new Map(),baseURL=`http://127.0.0.1:${server.address().port}`;
 const control={selector:'#save',safe:true,steps:[{action:'click',selector:'#save'},{action:'text',selector:'#save',value:'Saved'}]},flow={id:'entry',entry:'entry.js',url:'/',main:true,states:['signed-out'],steps:[],controls:[control],breaks:[]};
 try{
  for(const engine of ['chromium','webkit']){
   const report={cells:[],gaps:[]};await runCell({flow,engine,theme:'light',size:'390x660',state:{id:'signed-out'}},{config:{baseURL,flows:[flow]},report,out,browserModule:pw,browsers,launches});
   assert.ok(report.cells[0].failures.some(f=>f.includes('HTTP 500')),engine+' silently aborted the control request');
  }
  const file=join(out,'config.json'),resultOut=join(out,'terminal');writeFileSync(file,JSON.stringify({version:1,baseURL,playwrightPath:process.env.QA_PW_PATH,flows:[{...flow,controls:[{...control,terminal:true}]}]}));
  const result=await command(process.execPath,[fileURLToPath(new URL('./run.mjs',import.meta.url)),'--config',file,'--out',resultOut],{cwd:out,timeout:20000});
  const report=JSON.parse(readFileSync(join(resultOut,'report.json')));assert.equal(result.code,1);assert.ok(report.terminalChecks.every(t=>t.status==='fail'));assert.ok(report.cells.every(c=>c.failures.some(f=>f.includes('HTTP 500'))));
 }finally{for(const browser of browsers.values())await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));rmSync(out,{recursive:true,force:true});}
});

test('an unresolved mutation is a bounded gap, never an aborted passing control',{skip:!enabled,timeout:12000},async()=>{
 const server=createServer((req,res)=>{if(req.url==='/pending')return;res.setHeader('Content-Type','text/html');res.end('<html style="background:white;color:black"><body><button id="save" onclick="fetch(\'/pending\',{method:\'POST\'});this.textContent=\'Saved\'">Save</button></body></html>');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const out=mkdtempSync(join(tmpdir(),'qa-unresolved-')),pw=createRequire(process.env.QA_PW_PATH)('playwright'),browsers=new Map(),launches=new Map();
 try{
  const flow={id:'entry',entry:'entry.js',url:'/',states:['signed-out'],steps:[],controls:[{selector:'#save',safe:true,steps:[{action:'click',selector:'#save'},{action:'text',selector:'#save',value:'Saved'}]}],breaks:[]},report={cells:[],gaps:[]},start=Date.now();
  await runCell({flow,engine:'chromium',theme:'light',size:'390x660',state:{id:'signed-out'}},{config:{baseURL:`http://127.0.0.1:${server.address().port}`,flows:[flow]},report,out,browserModule:pw,browsers,launches});
  const cell=report.cells[0];assert.ok(cell.gaps.some(g=>g.includes('in-flight request unresolved')));assert.equal(cell.complete,false);assert.ok(!cell.controls.some(c=>c.selector==='#save'&&c.status==='pass'));assert.ok(Date.now()-start<10000);assert.deepEqual(cell.failures,[]);
 }finally{for(const b of browsers.values())await b.close();server.closeAllConnections();await new Promise(r=>server.close(r));rmSync(out,{recursive:true,force:true});}
});
