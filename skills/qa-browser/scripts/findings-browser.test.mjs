import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runCell} from './cell.mjs';
import {save} from './report.mjs';
for(const engine of ['chromium','webkit'])test(engine+' browser findings retain actual foreign documents and always fail owned resources',{skip:!process.env.QA_PW_PATH,timeout:15000},async()=>{
 let baseURL;
 const foreign=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(`<html style="background:white;color:black"><body><button id="repeat">One</button><button id="repeat">Two</button><script>console.error('Foreign inline console');throw new Error('Foreign inline exception');</script>${req.url.includes('resource')?`<script>fetch('${baseURL}/bad')</script>`:''}</body></html>`);});await new Promise(r=>foreign.listen(0,'127.0.0.1',r));
 const origin='http://127.0.0.1:'+foreign.address().port;
 const server=createServer((req,res)=>{if(req.url==='/bad'){res.writeHead(500,{'Access-Control-Allow-Origin':'*'});res.end('Broken');return;}res.setHeader('Content-Type','text/html');res.end(`<html style="background:white;color:black"><body><h1>Entry</h1><iframe title="External document" src="${origin}/${req.url.includes('resource')?'resource':''}"></iframe>${req.url.includes('owned')?"<script>console.error('Owned inline console');throw new Error('Owned inline exception');</script>":''}</body></html>`);});await new Promise(r=>server.listen(0,'127.0.0.1',r));baseURL='http://127.0.0.1:'+server.address().port;
 const out=mkdtempSync(join(tmpdir(),'qa-origin-')),browsers=new Map(),launches=new Map(),pw=createRequire(process.env.QA_PW_PATH)('playwright');
 try{for(const mode of ['foreign','owned','resource']){
  const flow={id:'entry',url:'/'+mode,states:['signed-out','signed-in'],steps:[{action:'visible',selector:'iframe'}],controls:[],breaks:[]},report={cells:[],gaps:[]};
  await runCell({flow,engine,theme:'light',size:'390x660',state:{id:'signed-out'}},{config:{baseURL,flows:[flow]},report,out,browsers,launches,browserModule:pw});
  save(report,out);const saved=JSON.parse(readFileSync(join(out,'report.json'))),cell=saved.cells[0];
  if(process.env.QA_BOUNDARY_EVIDENCE){mkdirSync(process.env.QA_BOUNDARY_EVIDENCE,{recursive:true});writeFileSync(join(process.env.QA_BOUNDARY_EVIDENCE,engine+'-provenance-'+mode+'.json'),JSON.stringify(saved,null,2));}
  assert.ok(cell.findings.some(f=>f.message.includes('duplicate visible id')&&f.document.origin===origin&&!f.affectsVerdict),JSON.stringify(cell));
  assert.ok(cell.findings.some(f=>f.message.includes('Foreign inline console')&&f.document.origin===origin&&!f.affectsVerdict),JSON.stringify(cell));
  assert.ok(!cell.failures.some(f=>/Foreign inline|duplicate visible id/.test(f)),JSON.stringify(cell));
  if(mode==='owned')assert.ok(cell.findings.some(f=>f.message.includes('Owned inline exception')&&f.origin===baseURL&&f.affectsVerdict));
  if(mode==='resource')assert.ok(cell.findings.some(f=>f.message.includes('HTTP 500')&&f.resourceOrigin===baseURL&&f.affectsVerdict));
  assert.ok(saved.issues.every(i=>i.document?.id&&i.origin&&i.phase));
 }}finally{for(const b of browsers.values())await b.close();for(const s of [server,foreign]){s.closeAllConnections();await new Promise(r=>s.close(r));}rmSync(out,{recursive:true,force:true});}
});
