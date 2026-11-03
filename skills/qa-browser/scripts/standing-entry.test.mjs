import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {command} from './process.mjs';

test('CLI keeps one pending entry through every standing cell and isolates conflicting terminals',{skip:!process.env.QA_PW_PATH,timeout:45000},async()=>{
 const directory=mkdtempSync(join(tmpdir(),'qa-standing-')),sessions=new Set(),events=[];let signins=0,preparations=0,cleanups=0,reads=0;
 const server=createServer((req,res)=>{
  const sid=req.headers.cookie?.match(/fixture_session=(\d+)/)?.[1];
  if(req.url==='/login'){sessions.add(String(++signins));events.push('login');res.setHeader('Set-Cookie',`fixture_session=${signins}; Path=/; HttpOnly`);res.end('Ready');return;}
  if(req.url==='/identity'){if(!sessions.has(sid)){res.writeHead(401);res.end();}else res.end(JSON.stringify({id:'fixture-user'}));return;}
  if(req.url==='/prepare'){preparations++;events.push('prepare');res.end('Ready');return;}
  if(req.url==='/cleanup'){cleanups++;sessions.delete(sid);res.end();return;}
  if(req.url==='/exit'){sessions.delete(sid);events.push('exit');res.end('<body>Signed out</body>');return;}
  res.setHeader('Content-Type','text/html');
  if(['/a','/b'].includes(req.url)){if(!sessions.has(sid)){res.writeHead(401);res.end('No session');return;}reads++;events.push('protected');res.end('<html style="background:white;color:black"><body>Private<a id="exit" href="/exit">End session</a></body></html>');return;}
  res.end('<html style="background:white;color:black"><body>Pending entry</body></html>');
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  const adapter=join(directory,'adapter.mjs');writeFileSync(adapter,`
import {join} from 'node:path';
export async function prepareEngine({context,config,pace}){await pace('entry');await context.request.post(config.baseURL+'/login');}
export async function authenticate(){}
export async function verifySession({context,config}){const r=await context.request.get(config.baseURL+'/identity');if(!r.ok())throw Error('inactive session');return r.json();}
export async function prepareTerminal({context,config,pace}){await pace('entry');await context.request.post(config.baseURL+'/login');}
export async function cleanupTerminal({context,config}){await context.request.post(config.baseURL+'/cleanup');}
export async function captureStanding({context,flow,state,engine,matrix,config,out,pace,beginCell}){
 await pace('entry');await context.request.post(config.baseURL+'/prepare');const page=await context.newPage();await page.goto(config.baseURL+'/code');
 const data={summary:{complete:true},results:[],edges:[],interactions:[]};
 for(const cell of matrix){await beginCell(cell);const [width,height]=cell.size.split('x').map(Number);await page.setViewportSize({width,height});await page.emulateMedia({colorScheme:cell.theme});await page.getByText('Pending entry',{exact:true}).waitFor();const path=join(out,flow.id+'-'+engine+'-'+cell.theme+'-'+cell.size+'.png');await page.screenshot({path});const identity={screen:flow.id,engine,theme:cell.theme,size:cell.size,state:state.id};data.results.push({...identity,path,failures:[]});data.edges.push({...identity,width,height,controls:[],checks:['empty','invalid','double-submit','refresh','back-forward','signed-out','signed-in'].map(kind=>({kind,pass:true}))});}
 if(config.fixtureMissing)data.results.pop();return data;
}`);
  const common={entry:'entry.js',main:true,steps:[],breaks:[]};
  const flows=[{...common,id:'pending',url:'/code',states:['signed-out'],capture:'standing',controls:[]},...['a','b'].map(id=>({...common,id,url:'/'+id,states:['signed-in'],controls:[{selector:'#exit',safe:true,terminal:true,steps:[{action:'click',selector:'#exit'},{action:'text',selector:'body',value:'Signed out'}]}]}))];
  const config={version:1,baseURL:`http://127.0.0.1:${server.address().port}`,playwrightPath:process.env.QA_PW_PATH,adapter,serviceIntervals:{entry:100},flows};
  const file=join(directory,'config.json'),out=join(directory,'out');writeFileSync(file,JSON.stringify(config));
  const result=await command(process.execPath,[fileURLToPath(new URL('./run.mjs',import.meta.url)),'--config',file,'--out',out],{cwd:directory,timeout:35000});const report=JSON.parse(readFileSync(join(out,'report.json'),'utf8'));
  assert.equal(preparations,2,'pending entry must be prepared once per engine');assert.equal(report.cells.length,60);assert.equal(report.standingEntry.length,2);assert.ok(report.standingEntry.every(r=>r.status==='pass'&&r.cells===10));
  assert.equal(signins,6,'two shared entries and four explicit isolated terminal sessions');assert.equal(cleanups,4);assert.equal(report.terminalChecks.length,4);assert.ok(report.terminalChecks.every(r=>r.status==='pass'&&r.isolation==='adapter-session'));
  assert.ok(reads>=20);assert.ok(events.slice(0,events.indexOf('exit')).filter(e=>e==='protected').length>=20);assert.ok(report.cells.every(c=>!c.failures.some(f=>f.includes('HTTP 401'))));assert.equal(result.code,2,'missing critique is no verdict');
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));rmSync(directory,{recursive:true,force:true});}
});

test('standing entry refuses missing and duplicate coverage without replaying preparation',{skip:!process.env.QA_PW_PATH,timeout:12000},async()=>{
 const {createRequire}=await import('node:module');const {captureStanding}=await import('./standing.mjs');
 const pw=createRequire(process.env.QA_PW_PATH)('playwright'),out=mkdtempSync(join(tmpdir(),'qa-standing-negative-')),browsers=new Map(),launches=new Map();
 try{for(const variant of ['missing-begin','duplicate-begin','missing-result','missing-terminal']){
  let preparations=0;const flow={id:variant,url:'/',steps:[],states:['signed-out'],breaks:[],controls:variant==='missing-terminal'?[{selector:'#exit',terminal:true,safe:true,steps:[]}]:[]};
  const tasks=['390x660','1440x900'].map(size=>({flow,state:{id:'signed-out'},engine:'chromium',theme:'light',size})),report={cells:[],gaps:[]};
  const adapter={captureStanding:async({context,beginCell,matrix})=>{
   preparations++;const page=await context.newPage();await page.setContent('<html style="background:white;color:black"><body>Pending</body></html>');
   const data={summary:{complete:true},results:[],edges:[],interactions:[]};
   for(const [index,cell]of matrix.entries()){
    if(variant!=='missing-begin'||index===0)await beginCell(cell);if(variant==='duplicate-begin')await beginCell(cell);
    const [width,height]=cell.size.split('x').map(Number);await page.setViewportSize({width,height});const path=join(out,variant+'-'+cell.size+'.png');await page.screenshot({path});
    const row={...cell,screen:flow.id,state:'signed-out',path,failures:[]};data.results.push(row);data.edges.push({...row,controls:[],checks:['empty','invalid','double-submit','refresh','back-forward','signed-out','signed-in'].map(kind=>({kind,pass:true}))});
   }if(variant==='missing-result')data.results.pop();return data;
  }};
  await captureStanding(tasks,{config:{baseURL:'https://app.example.invalid'},report,adapter,browsers,launches,browserModule:pw,out,pace:async()=>{},sessions:new Map(),terminals:{defer(){throw Error('unbound terminal must not run');}}});
  assert.equal(preparations,1);assert.ok(report.gaps.length||report.cells.some(c=>c.gaps.length),variant);assert.ok(report.cells.every(c=>!c.complete),variant+' borrowed incomplete coverage');
 }}finally{for(const browser of browsers.values())await browser.close();rmSync(out,{recursive:true,force:true});}
});
