import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runCell} from './cell.mjs';

test('a volatile entry label stops replay with its cause instead of inventing graph states',{skip:!process.env.QA_PW_PATH,timeout:10000},async()=>{
 const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<html style="background:white;color:black"><body><button id="change" aria-label="Updated '+Date.now()+'">Refresh</button></body></html>');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const pw=createRequire(process.env.QA_PW_PATH)('playwright'),out=mkdtempSync(join(tmpdir(),'qa-live-label-')),browsers=new Map(),launches=new Map();
 try{
  const flow={id:'entry',entry:'entry.js',url:'/',states:['signed-out'],steps:[],controls:[{selector:'#change',safe:true,steps:[{action:'click',selector:'#change'},{action:'visible',selector:'body'}]}],breaks:[]},report={cells:[],gaps:[]},start=Date.now();
  await runCell({flow,engine:'chromium',theme:'light',size:'390x660',state:{id:'signed-out'}},{config:{baseURL:`http://127.0.0.1:${server.address().port}`,flows:[flow],cellTimeoutMs:4000},report,out,browserModule:pw,browsers,launches});
  assert.ok(report.cells[0].gaps.some(g=>g.includes('entry control inventory changes')));assert.equal(report.cells[0].complete,false);assert.ok(report.cells[0].frames.length<=2);assert.ok(Date.now()-start<3000);
 }finally{for(const b of browsers.values())await b.close();server.closeAllConnections();await new Promise(r=>server.close(r));rmSync(out,{recursive:true,force:true});}
});
