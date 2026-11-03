import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runCell} from './cell.mjs';

for(const engine of ['chromium','webkit'])test(engine+' errors retain their emitting document and caught lifecycle cause',{skip:!process.env.QA_PW_PATH,timeout:15000},async()=>{
 const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<html style="background:white;color:black"><body><p>Ready</p><iframe src="data:text/html,<script>setTimeout(()=>{throw Error(\'opaque-frame-error\')},10)</script>"></iframe><script>setTimeout(()=>Promise.reject(Error("main-document-error")),10)</script></body></html>');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const out=mkdtempSync(join(tmpdir(),'qa-errors-')),pw=createRequire(process.env.QA_PW_PATH)('playwright'),browsers=new Map(),launches=new Map(),baseURL=`http://127.0.0.1:${server.address().port}`;
 try{
  const flow={id:'entry',entry:'entry.js',url:'/',states:['signed-out'],steps:[],controls:[],breaks:[]};
  const run=async(adapter={})=>{const report={cells:[],gaps:[]};await runCell({flow,engine,theme:'light',size:'390x660',state:{id:'signed-out'}},{config:{baseURL,flows:[flow]},report,out,browserModule:pw,browsers,launches,adapter});return report.cells[0];};
  const cell=await run({authenticate:async({context})=>{const page=await context.newPage();await page.evaluate(()=>setTimeout(()=>{throw Error('blank-document-error')},0));await page.waitForTimeout(50);await page.close();}});
  for(const [message,url]of [['blank-document-error','about:blank'],['opaque-frame-error','data:text/html'],['main-document-error',baseURL]]){
   const detail=cell.diagnostics.find(d=>d.message===message&&d.document?.url.startsWith(url));assert.ok(detail,JSON.stringify(cell.diagnostics));
   assert.ok(detail.stack.includes(message));assert.ok(detail.phase);assert.ok(detail.frame.id);assert.ok(detail.document.id);assert.ok(Number.isInteger(detail.navigation.generation));assert.equal(detail.flow,'entry');assert.equal(detail.engine,engine);
  }
  const failed=await run({enter:async()=>{throw Error('entry recipe refused');}});
  assert.ok(failed.gaps.some(g=>g.includes('entry recipe refused')));assert.ok(!failed.gaps.includes('cell failed to complete navigation or checks'));
  assert.ok(failed.diagnostics.some(d=>d.kind==='caught-exception'&&d.phase==='entry'&&d.stack.includes('entry recipe refused')));
 }finally{for(const b of browsers.values())await b.close();server.closeAllConnections();await new Promise(r=>server.close(r));rmSync(out,{recursive:true,force:true});}
});

test('caught shared-entry failure keeps its stack and phase in the CLI report',{skip:!process.env.QA_PW_PATH,timeout:12000},async()=>{
 const {writeFileSync,readFileSync}=await import('node:fs');const {fileURLToPath}=await import('node:url');const {command}=await import('./process.mjs');
 const server=createServer((req,res)=>res.end('<body>Ready</body>'));await new Promise(r=>server.listen(0,'127.0.0.1',r));const out=mkdtempSync(join(tmpdir(),'qa-entry-error-'));
 try{
  const adapter=join(out,'adapter.mjs');writeFileSync(adapter,'export async function prepareEngine(){throw Error("shared setup refused");}');
  const flow={id:'entry',entry:'entry.js',url:'/',main:true,states:['signed-in'],steps:[],controls:[],breaks:[]},file=join(out,'config.json');
  writeFileSync(file,JSON.stringify({version:1,baseURL:`http://127.0.0.1:${server.address().port}`,adapter,playwrightPath:process.env.QA_PW_PATH,flows:[flow]}));
  const result=await command(process.execPath,[fileURLToPath(new URL('./run.mjs',import.meta.url)),'--config',file,'--out',join(out,'result')],{timeout:8000});
  const report=JSON.parse(readFileSync(join(out,'result','report.json'),'utf8'));assert.equal(result.code,2);
  assert.ok(report.sharedEntry.every(entry=>entry.diagnostics?.some(d=>d.phase==='shared-entry'&&d.stack.includes('shared setup refused'))));
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));rmSync(out,{recursive:true,force:true});}
});
