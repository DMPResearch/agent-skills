import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runCell} from './cell.mjs';

for(const engine of ['chromium','webkit'])test(engine+' handoff ends at the exact foreign origin and rejects wrong or absent transitions',{skip:!process.env.QA_PW_PATH,timeout:20000},async()=>{
 const foreign=createServer((req,res)=>{res.end('<body><button id="duplicate">One</button><button id="duplicate">Two</button><script>console.error("Foreign defect")</script>');});await new Promise(r=>foreign.listen(0,'127.0.0.1',r));
 const wrong=createServer((req,res)=>res.end('Unexpected'));await new Promise(r=>wrong.listen(0,'127.0.0.1',r));
 const destination='http://127.0.0.1:'+foreign.address().port;
 const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(`<html style="background:white;color:black"><body><a id="out" href="${req.url==='/wrong'?'http://127.0.0.1:'+wrong.address().port:req.url==='/none'?'#':destination}">Continue</a><button id="local" onclick="document.querySelector('output').textContent='Ready'">Local</button><output>Waiting</output></body></html>`);});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const out=mkdtempSync(join(tmpdir(),'qa-handoff-')),browsers=new Map(),launches=new Map(),pw=createRequire(process.env.QA_PW_PATH)('playwright');
 try{
  for(const url of ['/','/wrong','/none']){
   const flow={id:'entry',url,states:['signed-out','signed-in'],steps:[],controls:[{selector:'#out',safe:true,steps:[{action:'handoff',selector:'#out',origin:destination}]},{selector:'#local',safe:true,steps:[{action:'click',selector:'#local'},{action:'text',selector:'output',value:'Ready'}]}],breaks:[]};
   const report={cells:[],gaps:[]};await runCell({flow,engine,theme:'light',size:'390x660',state:{id:'signed-out'}},{config:{baseURL:'http://127.0.0.1:'+server.address().port,flows:[flow],actionTimeoutMs:500},report,out,browsers,launches,browserModule:pw});
   const cell=report.cells[0],handoff=cell.controls.find(c=>c.selector==='#out');
   assert.equal(handoff.status,url==='/'?'pass':'fail',JSON.stringify(cell));
   if(url==='/'){assert.equal(handoff.effects[0].type,'handoff');assert.equal(handoff.effects[0].host,new URL(destination).host);assert.ok(cell.controls.some(c=>c.selector==='#local'&&c.status==='pass'),'our remaining control still runs');}
   assert.ok(!cell.failures.some(f=>/Foreign defect|duplicate visible id/.test(f)));
  }
 }finally{for(const b of browsers.values())await b.close();for(const s of [server,foreign,wrong]){s.closeAllConnections();await new Promise(r=>s.close(r));}rmSync(out,{recursive:true,force:true});}
});
