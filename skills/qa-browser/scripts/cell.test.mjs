import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runCell} from './cell.mjs';

test('real cell reports runtime failures and a dead control with frame evidence',{skip:!process.env.QA_PW_PATH},async()=>{
 const pw=createRequire(process.env.QA_PW_PATH)('playwright');
 const server=createServer((req,res)=>{
  if(req.url==='/missing'){res.writeHead(500);res.end('Unavailable');return;}
  res.setHeader('Content-Type','text/html');
  res.end('<html style="background:white;color:black"><body><button id="open">Open</button><section id="panel" hidden>Settings</section><script>console.error("Intentional fixture error");fetch("/missing")</script></body></html>');
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const out=mkdtempSync(join(tmpdir(),'qa-cell-')),browsers=new Map(),launches=new Map();
 const baseURL=`http://127.0.0.1:${server.address().port}`;
 const flow={id:'settings',entry:'settings.js',url:'/',main:true,states:['signed-out','signed-in'],steps:[{action:'visible',selector:'body'}],controls:[{selector:'#open',safe:true,steps:[{action:'click',selector:'#open'},{action:'visible',selector:'#panel'}]}],breaks:[]};
 try{for(const engine of ['chromium','webkit']){
  const report={cells:[],gaps:[]};
  await runCell({flow,engine,theme:'light',size:'390x660',state:{id:'signed-out'}},{config:{baseURL,flows:[flow],actionTimeoutMs:500},report,out,browserModule:pw,browsers,launches});
  const cell=report.cells[0];
  assert.ok(cell.frames.length>0);
  assert.ok(cell.failures.some(f=>f.startsWith('console error')));
  assert.ok(cell.failures.some(f=>f.startsWith('HTTP 500')));
  assert.ok(cell.failures.some(f=>f.includes('control expected effect failed')));
  assert.equal(cell.complete,false);
  const blocked={cells:[],gaps:[]};let attempts=0;
  const adapter={authenticate:async()=>{attempts++;throw Error('Service unavailable')}};
  for(let i=0;i<2;i++)await runCell({flow,engine,theme:'light',size:'390x660',state:{id:'signed-in'}},{config:{baseURL,flows:[flow]},report:blocked,out,browserModule:pw,browsers,launches,adapter});
  assert.equal(attempts,1,'do not keep calling an unavailable auth service');
  assert.ok(blocked.cells[1].gaps.some(g=>g.includes('authentication unavailable')));
  assert.equal(blocked.cells[1].frames.length,0);
 }}finally{
  for(const b of browsers.values())await b.close();
  await new Promise(r=>server.close(r));rmSync(out,{recursive:true,force:true});
 }
});
