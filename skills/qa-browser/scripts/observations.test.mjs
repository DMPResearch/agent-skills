import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runCell} from './cell.mjs';
import {validate} from './contract.mjs';

const request=origin=>({kind:'external-request',id:'device-probe',owner:'Identity service',reason:'Background device probe does not decide a control outcome',match:{origin,path:'/probe',methods:['GET'],resourceTypes:['fetch']},outcomes:['pending','cancelled']});
const warning=origin=>({kind:'expected-development-warning',id:'development-notice',owner:'Identity service',reason:'Development service is intentionally in use',source:{origin,paths:['/warning.js']},message:'Development transport active'});
const flow=observations=>({id:'entry',entry:'entry.js',url:'/',main:true,states:['signed-out','signed-in'],steps:[{action:'visible',selector:'#ready'}],controls:[],breaks:[],observations});

test('observation contracts refuse same-origin, broad and nondevelopment warning declarations',()=>{
 const config={version:1,baseURL:'https://app.example.invalid',flows:[flow([request('https://app.example.invalid')])]};
 assert.throws(()=>validate(config),/observations.*origin|same.origin/i);
 for(const change of [{match:{...request('https://device.example.invalid').match,path:'*'}},{outcomes:['HTTP']},{owner:''}])assert.throws(()=>validate({...config,flows:[flow([{...request('https://device.example.invalid'),...change}])]}),/observations/);
 assert.throws(()=>validate({...config,flows:[flow([warning('https://device.example.invalid')])]}),/development/);
});

for(const engine of ['chromium','webkit'])test(engine+' external observations are visible while own-origin and unknown failures survive',{skip:!process.env.QA_PW_PATH,timeout:20000},async()=>{
 let scenario='expected';
 const external=createServer((req,res)=>{
  if(req.url==='/warning.js'){res.setHeader('Content-Type','text/javascript');res.end('console.warn("Development transport active")');return;}
  res.writeHead(200,{'Access-Control-Allow-Origin':'*'});res.write('pending');
 });
 await new Promise(r=>external.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${external.address().port}`;
 const own=createServer((req,res)=>{
  if(req.url==='/broken'){res.writeHead(500);res.end('broken');return;}
  res.setHeader('Content-Type','text/html');res.end(`<html style="background:white;color:black"><body><p id="ready">Ready</p><script src="${origin}/warning.js"></script><script>fetch('${scenario==='own'?'/broken':origin+(scenario==='unknown'?'/unknown':'/probe')}');${scenario==='own'?'console.warn("Development transport active")':''}</script></body></html>`);
 });
 await new Promise(r=>own.listen(0,'127.0.0.1',r));const baseURL=`http://127.0.0.1:${own.address().port}`,pw=createRequire(process.env.QA_PW_PATH)('playwright'),browsers=new Map(),launches=new Map(),out=mkdtempSync(join(tmpdir(),'qa-observations-'));
 try{
  const run=async()=>{const f=flow([request(origin),warning(origin)]),report={cells:[],gaps:[]};await runCell({flow:f,engine,theme:'light',size:'390x660',state:{id:'signed-out'}},{config:{baseURL,flows:[f],serviceEnvironment:'development'},report,out,browserModule:pw,browsers,launches});return report.cells[0];};
  const expected=await run();assert.ok(!expected.gaps.some(g=>/in-flight|Development transport/.test(g)));assert.ok(expected.observations?.some(o=>o.classId==='device-probe'&&o.outcome==='pending'));assert.ok(expected.observations.some(o=>o.classId==='development-notice'));
  scenario='own';const negative=await run();assert.ok(negative.failures.some(f=>f.includes('HTTP 500')));assert.ok(negative.gaps.some(g=>g.includes('Development transport active')));assert.ok(!negative.observations?.some(o=>o.url?.startsWith(baseURL)));
  scenario='unknown';const unknown=await run();assert.ok(unknown.gaps.some(g=>g.includes('in-flight request unresolved')));
 }finally{for(const b of browsers.values())await b.close();for(const server of [own,external]){server.closeAllConnections();await new Promise(r=>server.close(r));}rmSync(out,{recursive:true,force:true});}
});
