import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {command} from './process.mjs';

async function sharedProof(secondary=false){
 const directory=mkdtempSync(join(tmpdir(),'qa-shared-'));let signins=0,signouts=0,protectedReads=0;
 const sessions=new Set(),events=[],paced=[];
 const server=createServer((req,res)=>{
  if(req.url==='/identity'){const sid=req.headers.cookie?.match(/fixture_session=(\d+)/)?.[1];if(!sessions.has(sid)){res.writeHead(401);res.end();}else res.end(JSON.stringify({id:'fixture-user'}));return;}
  if(req.url==='/paced'){paced.push(Date.now());res.end('Ready');return;}
  if(req.url==='/login'){
   const session=String(++signins);sessions.add(session);events.push('login');res.setHeader('Set-Cookie',`fixture_session=${session}; Path=/; HttpOnly; SameSite=Lax`);res.end('Ready');return;
  }
  const session=req.headers.cookie?.match(/fixture_session=(\d+)/)?.[1];
  if(req.url==='/exit'){
   sessions.delete(session);signouts++;events.push('exit');res.end('<body>Signed out</body>');return;
  }
  if(req.url==='/protected'||req.url==='/alternate'){
   res.setHeader('Content-Type','text/html');
   if(!sessions.has(session)){res.writeHead(401);res.end('No session');return;}
   protectedReads++;events.push('protected');res.end('<html style="background:white;color:black"><body><p>Private content</p><button id="probe" onclick="fetch(\'/paced\').then(()=>document.querySelector(\'output\').setAttribute(\'data-ready\',\'true\'))">Probe</button><output>Response</output><a id="exit" href="/exit">End session</a></body></html>');return;
  }
  res.end('Healthy');
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  const adapter=join(directory,'adapter.mjs');
  writeFileSync(adapter,`export async function prepareEngine({context,config}){const page=await context.newPage();await page.goto(config.baseURL+'/login');await page.close();} export async function authenticate() {} export async function verifySession({context,config}){const result=await context.request.get(config.baseURL+'/identity');if(!result.ok())throw Error('session unavailable');return result.json();}`);
  const flow={id:'private',entry:'private.js',main:true,url:'/protected',states:['signed-in'],steps:[{action:'text',selector:'body',value:'Private content'},{action:'click',selector:'#probe',service:'probe'},{action:'visible',selector:'output[data-ready]'}],controls:[{selector:'#exit',safe:true,terminal:true,steps:[{action:'click',selector:'#exit'},{action:'text',selector:'body',value:'Signed out'}]}],breaks:[]};
  const config={version:1,baseURL:`http://127.0.0.1:${server.address().port}`,playwrightPath:process.env.QA_PW_PATH,adapter,serviceIntervals:{probe:100},flows:secondary?[flow,{...flow,id:'alternate',url:'/alternate'}]:[flow]};
  const file=join(directory,'config.json'),out=join(directory,'out');writeFileSync(file,JSON.stringify(config));
  const result=await command(process.execPath,[fileURLToPath(new URL('./run.mjs',import.meta.url)),'--config',file,'--out',out],{cwd:directory,timeout:30000});
  const report=JSON.parse(readFileSync(join(out,'report.json'),'utf8'));
  assert.equal(report.cells.length,secondary?40:20);assert.equal(signins,2,'one real service session per engine');assert.equal(signouts,2,'terminal action runs once per engine');
  assert.equal(report.terminalChecks.length,secondary?4:2,'each route has an independent engine check');
  assert.ok(paced.length>=20);for(let i=1;!secondary&&i<paced.length;i++)assert.ok(paced[i]-paced[i-1]>=70,'requests must be paced rather than burst');
  assert.ok(protectedReads>=20);assert.equal(events.slice(0,events.indexOf('exit')).filter(e=>e==='protected').length>=20,true,'terminal actions must follow all normal cells');
  assert.ok(report.cells.every(c=>!c.failures.some(f=>f.includes('HTTP 401'))));
  assert.equal(report.terminalChecks.length,secondary?4:2,'each route has an independent engine check');
  assert.equal(report.sharedEntry.length,2);assert.ok(report.terminalChecks.every(c=>c.scope==='route-engine'));
  if(secondary){assert.ok(report.terminalChecks.filter(c=>c.route==='/alternate').every(c=>c.status==='incomplete'));assert.ok(report.cells.filter(c=>c.screen==='alternate').every(c=>c.gaps.length&&!c.controls.some(x=>x.status==='shared')));}
  else assert.ok(report.terminalChecks.every(c=>c.status==='pass'),JSON.stringify({checks:report.terminalChecks,failures:report.cells.flatMap(c=>c.failures),gaps:report.cells.flatMap(c=>c.gaps.filter(g=>/request/.test(g)))}));
  assert.equal(result.code,2,'no critic/design rules cannot give a pass');
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));rmSync(directory,{recursive:true,force:true});}
}

test('CLI seeds real fixture sessions once per engine and schedules terminal work after captures',{skip:!process.env.QA_PW_PATH},()=>sharedProof());
test('each route keeps its own terminal result after shared-session revocation',{skip:!process.env.QA_PW_PATH},()=>sharedProof(true));
