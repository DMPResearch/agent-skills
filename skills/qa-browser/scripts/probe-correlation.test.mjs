import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {observeErrors} from './errors.mjs';
import {observeRuntime} from './runtime.mjs';
for(const engine of ['chromium','webkit'])test(engine+' passive probe-error correlation preserves unrelated and first-party failures',{skip:!process.env.QA_PW_PATH,timeout:15000},async()=>{
 let baseURL,origin;
 const external=createServer((req,res)=>{
  const url=new URL(req.url,'http://fixture');
  if(url.pathname==='/client.js'){
   const mode=url.searchParams.get('mode'),target=(mode==='own'?baseURL:origin)+'/probe';
   res.setHeader('Content-Type','text/javascript');res.setHeader('Access-Control-Allow-Origin','*');
   res.end(mode==='no-request'?`throw new Error('Probe failure ${target}');`:`const url=${JSON.stringify(target+(mode==='http'?'?http=1':''))};${mode==='ambiguous'?'Promise.all([fetch(url),fetch(url)])':'fetch(url)'}.then(r=>{if(!r.ok)throw new Error('HTTP error '+url)}).catch(error=>{${mode==='stale'?"setTimeout(()=>{throw new Error('Probe failure '+url)},1200)":"throw new Error('Probe failure '+url+' '+error.message)"}});`);return;
  }
  if(url.searchParams.has('http')){res.statusCode=503;res.setHeader('Access-Control-Allow-Origin','*');}
  res.end('No CORS permission');
 });await new Promise(r=>external.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+external.address().port;
 const server=createServer((req,res)=>{
  const url=new URL(req.url,'http://fixture');
  if(url.pathname==='/local.js'){res.setHeader('Content-Type','text/javascript');res.end(`fetch('${origin}/probe').catch(()=>{throw new Error('Probe failure ${origin}/probe')});`);return;}
  if(url.pathname==='/probe'){req.socket.destroy();return;}
  res.setHeader('Content-Type',url.pathname==='/worker.js'?'text/javascript':'text/html');
  if(url.pathname==='/worker.js'){res.end(`fetch('${origin}/probe').catch(()=>{throw new Error('Worker probe failure ${origin}/probe')});`);return;}
  res.end(url.searchParams.get('mode')==='own-stack'?'<script src="/local.js"></script>':url.searchParams.get('mode')==='worker'?'<script>new Worker("/worker.js")</script>':`<script crossorigin="anonymous" src="${origin}/client.js?mode=${url.searchParams.get('mode')}"></script>`);
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));baseURL='http://127.0.0.1:'+server.address().port;
 const rule={kind:'external-request',id:'probe',owner:'Transport',reason:'Explicit diagnostic probe',match:{origin,path:'/probe',methods:['GET'],resourceTypes:['fetch']},outcomes:['pending','cancelled'],sameSiteException:{hostname:'127.0.0.1',reason:'Separate fixture service shares the loopback host'}};
 const pw=createRequire(process.env.QA_PW_PATH)('playwright'),browser=await pw[engine].launch();
 try{for(const mode of (process.env.QA_PROBE_MODE?[process.env.QA_PROBE_MODE]:['genuine','no-request','own','http','worker','own-stack','ambiguous','stale'])){
  const context=await browser.newContext(),cell={screen:'entry',state:'signed-out',engine,size:'390x660',failures:[],gaps:[]},config={baseURL,observations:[rule]};
  try{
   context.on('weberror',event=>{cell.fixtureNativeErrors||=[];cell.fixtureNativeErrors.push({message:event.error().message,stack:event.error().stack,page:event.page()?.url()||null});});
   const errors=await observeErrors(context,cell,cell.failures,config),runtime=observeRuntime(context,cell,config),page=await context.newPage();
   await page.goto(baseURL+'/?mode='+mode);await page.waitForTimeout(mode==='stale'?1500:400);await errors.finish();await runtime.audit();
   if(process.env.QA_BOUNDARY_EVIDENCE){mkdirSync(process.env.QA_BOUNDARY_EVIDENCE,{recursive:true});writeFileSync(join(process.env.QA_BOUNDARY_EVIDENCE,engine+'-'+mode+'.json'),JSON.stringify(cell,null,2));}
   const receipts=cell.observations.filter(o=>o.outcome==='page-error');
   if(mode==='genuine'){assert.ok(receipts.length>0,JSON.stringify(cell));assert.ok(!cell.failures.some(f=>f.includes('uncaught page error: Probe failure')),JSON.stringify(cell));}
   else if(mode==='worker'){assert.equal(receipts.length,0,JSON.stringify(cell));assert.ok(cell.failures.some(f=>f.startsWith(engine==='webkit'?'console error':'uncaught page error')),JSON.stringify(cell));assert.ok(cell.failures.some(f=>f.startsWith('request failed:')),JSON.stringify(cell));}
   else{assert.equal(receipts.length,0,JSON.stringify(cell));assert.ok(cell.failures.some(f=>f.includes('uncaught page error')||f.includes('HTTP 503')),JSON.stringify(cell));}
  }finally{await context.close();}
 }}finally{await browser.close();for(const s of [server,external]){s.closeAllConnections();await new Promise(r=>s.close(r));}}
});
