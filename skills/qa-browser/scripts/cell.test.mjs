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

test('state traversal reaches a control enabled by a prior selection',{skip:!process.env.QA_PW_PATH},async()=>{
 const pw=createRequire(process.env.QA_PW_PATH)('playwright');
 const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(`<html style="background:white;color:black"><body><button id="choice" aria-pressed="false" onclick="this.setAttribute('aria-pressed','true');document.querySelector('#next').disabled=false">Choose</button><button id="next" disabled onclick="document.querySelector('#panel').hidden=false">Continue</button><section id="panel" hidden>Details</section><div id="custom" tabindex="0" onclick="document.querySelector('#extra').hidden=false">Custom action</div><output id="extra" hidden>Custom result</output><button id="disabled" disabled>Unavailable</button></body></html>`)});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const out=mkdtempSync(join(tmpdir(),'qa-selection-')),browsers=new Map(),launches=new Map();
 const baseURL=`http://127.0.0.1:${server.address().port}`;
 const flow={id:'choice',entry:'choice.js',url:'/',main:true,states:['signed-out'],steps:[{action:'visible',selector:'body'}],breaks:[],controls:[{selector:'#choice',safe:true,steps:[{action:'click',selector:'#choice'},{action:'visible',selector:'#next:not(:disabled)'}]},{selector:'#next',safe:true,steps:[{action:'click',selector:'#next'},{action:'visible',selector:'#panel'}]},{selector:'#custom',safe:true,steps:[{action:'click',selector:'#custom'},{action:'visible',selector:'#extra'}]},{selector:'#disabled',safe:true,steps:[{action:'visible',selector:'#disabled:disabled'}]}]};
 try{for(const engine of ['chromium','webkit']){
  const report={cells:[],gaps:[]};await runCell({flow,engine,theme:'light',size:'390x660',state:{id:'signed-out'}},{config:{baseURL,flows:[flow],actionTimeoutMs:2000},report,out,browserModule:pw,browsers,launches});
  assert.ok(report.cells[0].controls.some(c=>c.selector==='#next'&&c.status==='pass'),'newly enabled control must be exercised');
  assert.ok(report.cells[0].controls.some(c=>c.selector==='#custom'&&c.status==='pass'),'declared custom control must be exercised');
  assert.ok(report.cells[0].controls.some(c=>c.selector==='#disabled'&&c.status==='disabled'),'declared disabled controls must be classified');
  assert.ok(!report.cells[0].gaps.some(g=>g==='declared control not exercised: #disabled'));
 }}finally{for(const b of browsers.values())await b.close();await new Promise(r=>server.close(r));rmSync(out,{recursive:true,force:true});}
});

test('real break engine exercises all kinds and rejects actions escaping their target',{skip:!process.env.QA_PW_PATH},async()=>{
 const pw=createRequire(process.env.QA_PW_PATH)('playwright');
 const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(`<html style="background:white;color:black"><body><form id="form"><label>Email<input id="email" type="email"></label><label>Other<input id="other"></label><button type="button" id="send" onclick="document.querySelector('output').textContent=++window.count">Send</button></form><output>0</output><a id="next" href="/next">Next</a><script>window.count=0</script></body></html>`)});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const out=mkdtempSync(join(tmpdir(),'qa-breaks-')),browsers=new Map(),launches=new Map(),baseURL=`http://127.0.0.1:${server.address().port}`;
 const breaks=[
  {kind:'empty',target:'#email',steps:[{action:'fill',selector:'#email',value:''},{action:'value',selector:'#email',value:''}]},
  {kind:'invalid',target:'#email',steps:[{action:'fill',selector:'#email',value:'invalid'},{action:'value',selector:'#email',value:'invalid'}]},
  {kind:'double-submit',target:'#send',steps:[{action:'double-click',selector:'#send'},{action:'text',selector:'output',value:'2'}]},
  {kind:'refresh',target:'#email',steps:[{action:'fill',selector:'#email',value:'draft'},{action:'reload'},{action:'value',selector:'#email',value:''}]},
  {kind:'back-forward',target:'body',steps:[{action:'click',selector:'#next'},{action:'back'},{action:'forward'},{action:'url',value:'/next'}]},
  ...['signed-out','signed-in'].map(kind=>({kind,target:'body',steps:[{action:'visible',selector:'body'}]}))
 ].map(b=>({...b,safe:true}));
 const flow={id:'breaks',url:'/',entry:'form.js',main:true,states:['signed-out','signed-in'],steps:[],controls:[],breaks};
 try{for(const engine of ['chromium','webkit']){
  for(const state of ['signed-out','signed-in']){
   const report={cells:[],gaps:[]};await runCell({flow,engine,theme:'light',size:'390x660',state:{id:state}},{config:{baseURL,flows:[flow],actionTimeoutMs:500},report,out,browserModule:pw,browsers,launches,adapter:{authenticate:async()=>{}}});
   for(const kind of ['empty','invalid','double-submit','refresh','back-forward',state])assert.ok(report.cells[0].controls.some(c=>c.break===kind&&c.status==='pass'),engine+' '+kind);
  }
  const wrong={...flow,breaks:[{kind:'invalid',target:'#email',safe:true,steps:[{action:'fill',selector:'#other',value:'wrong'},{action:'value',selector:'#other',value:'wrong'}]}]};
  const report={cells:[],gaps:[]};await runCell({flow:wrong,engine,theme:'light',size:'390x660',state:{id:'signed-out'}},{config:{baseURL,flows:[wrong],actionTimeoutMs:500},report,out,browserModule:pw,browsers,launches});
  assert.ok(report.cells[0].failures.some(f=>f.includes('break failed: invalid')),'target escape must fail');
  assert.ok(!report.cells[0].controls.some(c=>c.break==='invalid'&&c.status==='pass'));
  wrong.breaks=[{kind:'invalid',target:'#email',safe:true,steps:[{action:'fill',selector:'#email',value:'bad'},{action:'value',selector:'#email',value:'unseen'}]}];
  const outcome={cells:[],gaps:[]};await runCell({flow:wrong,engine,theme:'light',size:'390x660',state:{id:'signed-out'}},{config:{baseURL,flows:[wrong],actionTimeoutMs:500},report:outcome,out,browserModule:pw,browsers,launches});assert.ok(outcome.cells[0].controls.some(c=>c.break==='invalid'&&c.status==='fail'));assert.ok(outcome.cells[0].repro.some(s=>s.includes('unseen')));
 }}finally{for(const b of browsers.values())await b.close();await new Promise(r=>server.close(r));rmSync(out,{recursive:true,force:true});}
});
