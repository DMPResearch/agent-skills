import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {command} from './process.mjs';

test('full fresh-load matrix samples each route control once, counts SDK traffic and stops on overload',{skip:!process.env.QA_PW_PATH,timeout:90000},async()=>{
 let calls=0,sdk=0,status=200;const external=createServer((req,res)=>{res.setHeader('Access-Control-Allow-Origin','*');if(req.url==='/sdk')sdk++;else calls++;res.writeHead(status);res.end('Ready');});await new Promise(r=>external.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+external.address().port;
 const app=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(`<html style="background:white;color:black"><h1>Ready</h1><form method="post" action="${origin}/action" target="service-result"><button id="action" style="width:140px;height:48px">Continue</button></form><iframe hidden name="service-result" onload="try{if(this.contentWindow.location.href==='about:blank')return;}catch{}if(document.querySelector('output'))document.querySelector('output').hidden=false"></iframe><output hidden>Done</output><script>fetch('${origin}/sdk')</script></html>`);});await new Promise(r=>app.listen(0,'127.0.0.1',r));
 const dir=mkdtempSync(join(tmpdir(),'qa-service-cli-'));let complete=false;
 try{
  const flow=id=>({id,entry:'entry.js',main:true,url:'/'+id,states:['signed-out'],steps:[],controls:[{selector:'#action',name:'Continue',role:'button',safe:true,service:true,serviceRequest:{origin,method:'POST'},steps:[{action:'click',selector:'#action'},{action:'visible',selector:'output'}]}],breaks:[]});
  const config={version:1,baseURL:'http://127.0.0.1:'+app.address().port,playwrightPath:process.env.QA_PW_PATH,flows:[flow('a'),flow('b')],servicePhase:{size:'390x660',theme:'light',limiter:'remote',cellLimiter:'cell'},serviceIntervals:{remote:10,cell:10}},path=join(dir,'config.json');writeFileSync(path,JSON.stringify(config));
  const run=async name=>{const out=join(dir,name);const result=await command(process.execPath,[fileURLToPath(new URL('./run.mjs',import.meta.url)),'--config',path,'--out',out,'--capture-only'],{timeout:60000});writeFileSync(join(dir,name+'.log'),result.stdout+'\n'+result.stderr);return JSON.parse(readFileSync(join(out,'report.json')));};
  const good=await run('good');assert.equal(good.expectedCells,80);assert.equal(good.cells.length,80);assert.equal(calls,4,'two engines × two declared route controls × one auth state = 4 explicit calls');assert.equal(good.serviceChecks.length,4);
  assert.ok(good.cells.filter(c=>!c.serviceState).every(c=>c.controls.some(r=>r.servicePhase&&r.status==='shared')&&c.serviceTraffic.total>0),JSON.stringify(good));
  assert.ok(sdk>=40);assert.equal(good.serviceTraffic.total,good.serviceTraffic.contexts.reduce((n,c)=>n+c.total,0));
  status=429;const bad=await run('limited');assert.equal(bad.serviceLimit.status,429);assert.ok(bad.cells.length<40);assert.ok(bad.gaps.some(g=>g.includes('live service stopped after HTTP 429')));assert.notEqual(bad.status,'pass');complete=true;
 }finally{for(const server of [app,external]){server.closeAllConnections();await new Promise(r=>server.close(r));}if(complete)rmSync(dir,{recursive:true,force:true});else console.error('Service CLI evidence retained at '+dir);}
});
