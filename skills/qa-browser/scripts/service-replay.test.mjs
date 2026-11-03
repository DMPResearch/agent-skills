import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtempSync,readFileSync,writeFileSync,readdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {terminalQueue,servicePacer} from './phases.mjs';
import {observeBuild} from './provenance.mjs';
for(const engine of ['chromium','webkit'])test(engine+' fresh local client accepts a real phase response without another service call',{skip:!process.env.QA_PW_PATH,timeout:30000},async()=>{
 let calls=0,baseURL,complete=false,version='A',activeVariant;const secret=[randomUUID(),randomUUID()].join('-'),client=readFileSync(new URL('./fixtures/service-client.js',import.meta.url),'utf8');
 const remote=createServer((q,r)=>{
  calls++;if(activeVariant?.endsWith('build'))version='B';r.setHeader('Content-Type','text/html');
  r.setHeader('Set-Cookie','fixtureSession='+secret+'; Path=/; SameSite=Lax');
  const payload=JSON.stringify({stage:'code',sessionValue:secret});
  r.end('<script>parent.postMessage('+payload+','+JSON.stringify(baseURL)+')</script>');
 });await new Promise(r=>remote.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+remote.address().port;
 const html=`<html style="color:black;background:white"><main></main><form action="${origin}/session" method="post" target="transport"><button id="send" style="width:150px;height:48px">Send</button></form><iframe hidden name="transport"></iframe><script src="/client.js"></script></html>`;
 const app=createServer((q,r)=>{r.setHeader('Content-Type',q.url==='/client.js'?'application/javascript':'text/html');r.end(q.url==='/client.js'?client:html+'<footer>'+version+'</footer>'+(activeVariant==='mount-build'&&version==='B'?'<script>document.querySelector("form").submit()</script>':''));});await new Promise(r=>app.listen(0,'127.0.0.1',r));baseURL='http://127.0.0.1:'+app.address().port;
 const pw=createRequire(process.env.QA_PW_PATH)('playwright'),browser=await pw[engine].launch(),out=mkdtempSync(join(tmpdir(),'qa-replay-client-'));
 try{
  const buildObserver=observeBuild(baseURL),context=await browser.newContext();buildObserver.attach(context);const p=await context.newPage();await p.goto(baseURL);const build=await buildObserver.finish();await context.close();
  for(const variant of ['plain','extra','reject','build','mount-build']){activeVariant=variant;version='A';const extra=variant==='extra',reject=variant==='reject';let entries=0;
   const recipe={selector:'#send',safe:true,service:true,name:'Send',role:'button',serviceRequest:{origin,method:'POST'},postState:{flow:'code',state:'signed-out'},steps:[{action:'click',selector:'#send'},{action:'visible',selector:'#code'}]},flow={id:'entry',url:reject?'/?reject=1':extra?'/?extra=1':'/',steps:[],controls:[recipe],breaks:[]},target={id:'code',url:'/',states:['signed-out'],steps:[{action:'visible',selector:'#code'}],controls:[],breaks:[]};
   const cells=['light','dark'].flatMap(theme=>['390x660','820x1180'].map(size=>({id:engine+variant+theme+size,engine,theme,size,build,frames:[],failures:[],gaps:[],controls:[]}))),report={cells,gaps:[]},config={baseURL,actionTimeoutMs:1000,flows:[flow,target],assetHashes:{'/client.js':createHash('sha256').update(client).digest('hex')},servicePhase:{size:'390x660',theme:'light',limiter:'write',cellLimiter:'load'},serviceIntervals:{write:1,load:1}},queue=terminalQueue({service:true});
   for(const cell of [...cells]){const id=queue.defer({flow,engine,theme:cell.theme,size:cell.size,state:{id:'signed-out'}},cell,recipe,'control',config);cell.controls.push({servicePhase:id});}
   const before=calls;await queue.run({config,report,out,browsers:new Map([[engine,browser]]),sessions:new Map(),adapter:reject?{authenticate:async({context})=>context.addInitScript(()=>globalThis.phaseOnly=true),enter:async()=>{entries++;}}:undefined,pace:servicePacer(config.serviceIntervals),buildObserver});
   writeFileSync(join(out,'report-'+variant+'.json'),JSON.stringify(report,null,2));
   assert.equal(calls-before,1,'one real phase response supplies every fresh view');const post=report.cells.filter(c=>c.serviceState);assert.equal(post.length,4,JSON.stringify(report));if(variant.endsWith('build')){assert.ok(post.every(c=>!c.serviceTraffic||c.serviceTraffic.every(t=>t.replayed===0)),'a mismatched build must not receive a recorded service response');assert.ok(post.slice(0,2).every(c=>c.failures.some(f=>f.includes('build mismatch'))),'entry build mismatch must fail before replay');}else if(reject){assert.equal(entries,3,'one real entry plus exactly two fresh replay attempts');assert.ok(post.every(c=>c.frames.length&&c.captureSource==='resized from a live page'&&c.gaps.includes('fresh-load layout not proven')&&!c.complete),JSON.stringify(post));}else assert.ok(post.every(c=>c.frames.length&&c.captureSource==='service response replayed from real call in phase '+report.serviceChecks[0].id),JSON.stringify(post));
   if(!reject&&!variant.endsWith('build'))assert.ok(post.filter(c=>c.size==='820x1180'||c.theme==='dark').every(c=>c.failures.length),'mount-time failures must be visible');
   if(extra)assert.ok(post.filter(c=>c.size==='820x1180').every(c=>c.failures.some(f=>f.includes('recorded phase method/URL shape'))),'a changed request method cannot leave or inherit a replay');
   for(const file of readdirSync(out))assert.equal(readFileSync(join(out,file)).includes(Buffer.from(secret)),false,'response bodies and cookies stay in memory');
  }complete=true;
 }finally{await browser.close();for(const s of [app,remote]){s.closeAllConnections();await new Promise(r=>s.close(r));}if(complete)rmSync(out,{recursive:true,force:true});else console.error('Replay client evidence retained at '+out);}
});
