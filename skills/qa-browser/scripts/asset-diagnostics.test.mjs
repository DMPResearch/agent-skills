import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {trackNavigations} from './navigation.mjs';
import {observeBuild} from './provenance.mjs';
import {runCell} from './cell.mjs';

async function bounded(operation,ms){
 let timer;
 try{return await Promise.race([operation,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(`observer exceeded ${ms} ms test deadline`)),ms);})]);}
 finally{clearTimeout(timer);}
}
const enabled=!!process.env.QA_PW_PATH;

test('unfinished real body is cancelled by a committed tool navigation within the diagnostic bound',{skip:!enabled,timeout:15000},async()=>{
 const pw=createRequire(process.env.QA_PW_PATH)('playwright');
 const server=createServer((req,res)=>{
  res.writeHead(200,{'Content-Type':'text/html'});
  if(req.url==='/entry')res.write('<body>Entry');else res.end('<body>Next</body>');
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{for(const engine of ['chromium','webkit']){
  const browser=await pw[engine].launch();
  try{
   const context=await browser.newContext(),baseURL=`http://127.0.0.1:${server.address().port}`,observer=observeBuild(baseURL);
   try{
    observer.attach(context);
    const page=await context.newPage(),navigation=trackNavigations(page);page.setDefaultNavigationTimeout(2000);
    await page.goto(baseURL+'/entry',{waitUntil:'commit'});
    const started=Date.now();await navigation.run(()=>page.goto(baseURL+'/next'));
    const result=await bounded(observer.finish(),2500);
    const diagnostic=result.diagnostics?.find(d=>d.url.endsWith('/entry'));
    assert.equal(diagnostic?.reason,'body read cancelled by navigation',engine);
    assert.equal(diagnostic.navigationCancelled,true);
    assert.ok(diagnostic.url.endsWith('/entry'));assert.ok(!result.unreadable.includes('/entry'));
    assert.ok(Date.now()-started<2500);
   }finally{await context.close();}
  }finally{await browser.close();}
 }}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});

test('completed served bytes with a wrong manifest hash remain a real asset failure',{skip:!enabled,timeout:15000},async()=>{
 const pw=createRequire(process.env.QA_PW_PATH)('playwright');
 const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':'text/html');res.end(req.url==='/app.js'?'window.loaded=true':'<html style="background:white;color:black"><body><script src="/app.js"></script>Ready</body></html>');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const out=mkdtempSync(join(tmpdir(),'qa-asset-')),browsers=new Map(),launches=new Map();
 try{for(const engine of ['chromium','webkit']){
  const flow={id:'entry',entry:'entry.js',url:'/',states:['signed-out','signed-in'],steps:[],controls:[],breaks:[]},report={cells:[],gaps:[]};
  await runCell({flow,engine,theme:'light',size:'390x660',state:{id:'signed-out'}},{config:{baseURL:`http://127.0.0.1:${server.address().port}`,flows:[flow],assetHashes:{'/app.js':'0'.repeat(64)}},report,out,browserModule:pw,browsers,launches});
  assert.ok(report.cells[0].failures.some(f=>f.includes('served asset hash mismatch: /app.js')));
 }}finally{for(const browser of browsers.values())await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));rmSync(out,{recursive:true,force:true});}
});

test('an unfinished body without a declared replacement remains unreadable at the read bound',{skip:!enabled,timeout:8000},async()=>{
 const pw=createRequire(process.env.QA_PW_PATH)('playwright');
 const server=createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.write('<body>Loading');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await pw.chromium.launch();
 try{
  const context=await browser.newContext(),baseURL=`http://127.0.0.1:${server.address().port}`,observer=observeBuild(baseURL);observer.attach(context);
  try{
   const page=await context.newPage();await page.goto(baseURL+'/pending',{waitUntil:'commit'});
   const result=await bounded(observer.finish(),2500);
   assert.ok(result.unreadable.includes('/pending'));
   assert.match(result.diagnostics[0].error,/2000 ms/);assert.equal(result.diagnostics[0].navigationCancelled,false);
  }finally{await context.close();}
 }finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
});

test('a timed-out original body gets one bounded fresh read and keeps its unverifiable status',{skip:!enabled,timeout:8000},async()=>{
 const {readBody}=await import('./body.mjs');let requests=0;
 const server=createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/javascript'});if(++requests===1)res.write('window.value=');else res.end('window.value="changed"');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const pw=createRequire(process.env.QA_PW_PATH)('playwright'),browser=await pw.chromium.launch();
 try{
  const context=await browser.newContext(),page=await context.newPage(),url=`http://127.0.0.1:${server.address().port}/asset.js`;
  const response=await page.goto(url,{waitUntil:'commit'});
  const result=await bounded(readBody(response,{retry:async()=>{const fresh=await context.request.get(url,{timeout:2000,maxRetries:0});return fresh.body();}}),4500);
  assert.equal(result.reason,'body read timed out');assert.equal(result.recovered,true);assert.equal(requests,2);
  assert.match(result.body.toString(),/changed/);assert.equal(result.navigationCancelled,false);
 }finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
});
