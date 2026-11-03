import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {mkdtempSync,rmSync,mkdirSync,writeFileSync,appendFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {terminalQueue} from './phases.mjs';
import {runCell} from './cell.mjs';

for(const engine of ['chromium','webkit'])for(const mode of ['control','break','terminal'])test(engine+' '+mode+' handoff ends at the exact foreign origin and rejects wrong or absent transitions',{skip:!process.env.QA_PW_PATH,timeout:20000},async t=>{
 const foreign=createServer((req,res)=>{res.end('<body><button id="duplicate">One</button><button id="duplicate">Two</button><script>console.error("Foreign defect")</script>');});await new Promise(r=>foreign.listen(0,'127.0.0.1',r));
 const wrong=createServer((req,res)=>res.end('Unexpected'));await new Promise(r=>wrong.listen(0,'127.0.0.1',r));
 const destination='http://127.0.0.1:'+foreign.address().port;
 const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(`<html style="background:white;color:black"><body><a id="out" href="${req.url==='/wrong'?'http://127.0.0.1:'+wrong.address().port:req.url==='/none'?'#':destination}">Continue</a><button id="local" onclick="document.querySelector('output').textContent='Ready'">Local</button><output>Waiting</output></body></html>`);});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const out=mkdtempSync(join(tmpdir(),'qa-handoff-')),browsers=new Map(),launches=new Map(),pw=createRequire(process.env.QA_PW_PATH)('playwright');
 const evidence=process.env.QA_HANDOFF_EVIDENCE||join(out,'evidence');const started=Date.now();let current,checkpoint,completed=false;
 if(evidence)mkdirSync(join(evidence,engine+'-'+mode),{recursive:true});
 const log=event=>{if(evidence)appendFileSync(join(evidence,engine+'-'+mode,'events.jsonl'),JSON.stringify({ms:Date.now()-started,...event})+'\n');};
 const launch=pw[engine].launch.bind(pw[engine]);
 const instrumented={...pw,[engine]:{launch:async()=>{const b=await launch();const original=b.newContext.bind(b);b.newContext=async options=>{const context=await original(options);log({event:'context-created',options});const setTimeout=context.setDefaultTimeout.bind(context);context.setDefaultTimeout=value=>{log({event:'action-timeout',value});return setTimeout(value);};context.on('page',page=>{if(process.env.QA_TRACE_AWAITS){for(const method of ['waitForURL','close']){const original=page[method].bind(page);page[method]=async(...args)=>{log({event:method+'-start'});try{return await original(...args);}finally{log({event:method+'-end'});}};}const locator=page.locator.bind(page);page.locator=(...args)=>{const loc=locator(...args),click=loc.click.bind(loc);loc.click=async(...args)=>{log({event:'click-start',selector:String(args)});try{return await click(...args);}finally{log({event:'click-end'});}};return loc;};}page.on('framenavigated',f=>log({event:'navigation',url:f.url()}));page.on('request',r=>log({event:'request',url:r.url()}));page.on('close',()=>log({event:'page-close'}));});return context;};return b;}}};
 t.after(async()=>{clearInterval(checkpoint);if(evidence&&current)writeFileSync(join(evidence,engine+'-'+mode,'deadline-report.json'),JSON.stringify(current,null,2));for(const b of browsers.values())await b.close();});
 try{
  for(const url of ['/','/wrong','/none']){
   const flow={id:'entry',url,states:['signed-out','signed-in'],steps:[],controls:[{selector:'#out',safe:true,terminal:mode==='terminal',steps:[{action:'handoff',selector:'#out',origin:destination}]},{selector:'#local',safe:true,steps:[{action:'click',selector:'#local'},{action:'text',selector:'output',value:'Ready'}]}],breaks:mode==='break'?[{kind:'double-submit',target:'#out',safe:true,steps:[{action:'handoff',selector:'#out',origin:destination,gesture:'double-click'}]}]:[]};
   const report={cells:[],gaps:[]},terminals=terminalQueue();current=report;log({event:'case-start',case:url});checkpoint=setInterval(()=>{if(evidence)writeFileSync(join(evidence,engine+'-'+mode,'checkpoint.json'),JSON.stringify(report,null,2));},100);await runCell({flow,engine,theme:'light',size:'390x660',state:{id:'signed-out'}},{config:{baseURL:'http://127.0.0.1:'+server.address().port,flows:[flow],actionTimeoutMs:500},report,out,browsers,launches,browserModule:instrumented,terminals});if(mode==='terminal'){log({event:'terminal-start',case:url});await terminals.run({report,config:{baseURL:'http://127.0.0.1:'+server.address().port,flows:[flow],actionTimeoutMs:500},out,browsers,sessions:new Map(),pace:async()=>{}});log({event:'terminal-end',case:url});}clearInterval(checkpoint);log({event:'case-end',case:url});if(evidence)writeFileSync(join(evidence,engine+'-'+mode,'report-'+(url==='/'?'correct':url.slice(1))+'.json'),JSON.stringify(report,null,2));
   const cell=report.cells[0],handoff=mode==='terminal'?report.terminalChecks[0]:mode==='break'?cell.controls.find(c=>c.break==='double-submit'):cell.controls.find(c=>c.selector==='#out');
   assert.equal(handoff.status,url==='/'?'pass':'fail',JSON.stringify(cell));
   if(url==='/'){const receipt=handoff.handoff||handoff.effects[0];assert.equal(receipt.type,'handoff');assert.equal(receipt.host,new URL(destination).host);assert.ok(cell.controls.some(c=>c.selector==='#local'&&c.status==='pass'),'our remaining control still runs');}
   assert.ok(!cell.failures.some(f=>/Foreign defect|duplicate visible id/.test(f)));
  }
  completed=true;
 }finally{clearInterval(checkpoint);for(const b of browsers.values())await b.close();for(const s of [server,foreign,wrong]){s.closeAllConnections();await new Promise(r=>s.close(r));}if(completed)rmSync(out,{recursive:true,force:true});else console.error('Handoff evidence retained at '+evidence);}
});
