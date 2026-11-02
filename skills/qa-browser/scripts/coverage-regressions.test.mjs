import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runCell} from './cell.mjs';
const enabled=!!process.env.QA_PW_PATH;

test('break aliases execute on the reached element and other auth scopes cannot cover it',{skip:!enabled,timeout:20000},async()=>{
 const observations=[],server=createServer((req,res)=>{
  const url=new URL(req.url,'http://local');
  if(url.pathname==='/observed'){observations.push(url.searchParams.get('name'));res.end();return;}
  res.setHeader('Content-Type','text/html');res.end(`<html style="background:white;color:black"><body><input name="q" aria-label="Alpha" oninput="fetch('/observed?name='+this.getAttribute('aria-label'))"><button id="swap" onclick="document.querySelector('input').setAttribute('aria-label','Beta')">Swap</button></body></html>`);
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const pw=createRequire(process.env.QA_PW_PATH)('playwright'),out=mkdtempSync(join(tmpdir(),'qa-coverage-')),browsers=new Map(),launches=new Map();
 const target='input[name="q"]',baseURL=`http://127.0.0.1:${server.address().port}`;
 try{for(const engine of ['chromium','webkit']){
  const breaks=alias=>['empty','invalid','double-submit','refresh'].map(kind=>({kind,target,coverageTarget:alias,safe:true,steps:[...(kind==='empty'?[{action:'fill',selector:target,value:''}]:kind==='invalid'?[{action:'fill',selector:target,value:'bad'}]:kind==='double-submit'?[{action:'double-click',selector:target}]:[{action:'reload'}]),{action:'visible',selector:target}]}));
  const flow={id:'entry',entry:'entry.js',url:'/',states:['signed-out','signed-in'],steps:[],controls:[{selector:'#swap',safe:true,steps:[{action:'click',selector:'#swap'},{action:'visible',selector:'[aria-label="Beta"]'}]}],breaks:[...breaks('Alpha'),...breaks('Beta')]};
  const run=async flow=>{const report={cells:[],gaps:[]};await runCell({flow,engine,theme:'light',size:'390x660',state:{id:'signed-out'}},{config:{baseURL,flows:[flow]},report,out,browserModule:pw,browsers,launches});return report.cells[0];};
  observations.length=0;const cell=await run(flow);
  assert.ok(observations.includes('Beta'),engine+' Beta breaks ran only on Alpha');
  assert.ok(cell.controls.some(c=>c.coverageTarget==='Beta'&&c.status==='pass'));
  const wrong=await run({...flow,controls:[],breaks:breaks('Beta')});assert.ok(wrong.gaps.some(g=>g.includes('Beta')));assert.ok(!wrong.controls.some(c=>c.coverageTarget==='Beta'&&c.status==='pass'));
  const scoped=await run({...flow,controls:[],breaks:breaks('Alpha').map(b=>({...b,state:'signed-in'}))});
  assert.ok(scoped.gaps.some(g=>g.includes('Alpha')),engine+' wrong-state break hid the missing coverage');
  assert.ok(!scoped.controls.some(c=>c.tag==='input'&&c.status==='covered-by-break-contract'));
 }}finally{for(const b of browsers.values())await b.close();server.closeAllConnections();await new Promise(r=>server.close(r));rmSync(out,{recursive:true,force:true});}
});
