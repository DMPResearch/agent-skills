import {declareReturnPaths,recordDepartures,resolveReturnPaths} from './return-path.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {command} from './process.mjs';
import {breakKinds,validate} from './contract.mjs';

const readOnly=()=>breakKinds.map(kind=>({kind,notApplicable:true,reason:'Read-only document without input controls'}));
test('CLI return proof must execute the actual callback state and cannot approve a broken callback',{skip:!process.env.QA_PW_PATH,timeout:120000},async()=>{
 const out=mkdtempSync(join(tmpdir(),'qa-return-path-'));let completed=false,broken=true,callbackHits=0;
 const provider=createServer((req,res)=>res.end('External account provider'));
 await new Promise(r=>provider.listen(0,'127.0.0.1',r));
 const origin='http://127.0.0.1:'+provider.address().port;
 const app=createServer((req,res)=>{res.setHeader('Content-Type','text/html');if(req.url==='/callback'){callbackHits++;res.end('<html style="background:white;color:black"><h1 id="result">Returned</h1>'+(broken?'<p id="result">Broken</p><script>throw Error("Callback crashed")</script>':''));}else res.end(`<html style="background:white;color:black"><h1>Entry</h1><a id="go" href="${origin}">Continue</a>`);});
 await new Promise(r=>app.listen(0,'127.0.0.1',r));
 const baseURL='http://127.0.0.1:'+app.address().port;
 try{
  const adapter=join(out,'adapter.mjs');writeFileSync(adapter,`const id=['fixture','identity'].join('-');export async function authenticate({context,state,config}){if(state==='signed-in')await context.addCookies([{name:'identity',value:id,url:config.baseURL}]);}export async function verifySession({context}){const c=(await context.cookies()).find(c=>c.name==='identity');if(c?.value!==id)throw Error('Session missing');return {id:c.value};}export async function buildIdentity(){return 'fixture-build';}`);
  const proof={flow:'callback',state:'signed-out'},handoff={action:'handoff',selector:'#go',origin,returnPath:proof};
  const flow={id:'entry',entry:'entry.js',url:'/',main:true,states:['signed-out','signed-in'],steps:[],controls:[{selector:'#go',safe:true,terminal:true,steps:[handoff]}],breaks:[
   ...readOnly().filter(b=>['empty','invalid'].includes(b.kind)),
   {kind:'double-submit',target:'#go',safe:true,terminal:true,steps:[{...handoff,gesture:'double-click'}]},
   {kind:'refresh',target:'#go',safe:true,steps:[{action:'reload'},{action:'visible',selector:'h1'}]},
   {kind:'back-forward',target:'#go',safe:true,steps:[{action:'back'},{action:'forward'},{action:'visible',selector:'h1'}]},
   ...['signed-out','signed-in'].map(kind=>({kind,target:'body',safe:true,steps:[{action:'visible',selector:'h1'}]}))]};
  const callback={id:'callback',entry:'callback.js',url:'/callback',main:false,states:['signed-out','signed-in'],steps:[{action:'text',selector:'h1',value:'Returned'}],controls:[],breaks:readOnly()};
  const config={version:1,baseURL,playwrightPath:process.env.QA_PW_PATH,adapter,actionTimeoutMs:1000,flows:[flow,callback]},path=join(out,'config.json');
  const run=async name=>{writeFileSync(path,JSON.stringify(config));const dir=join(out,name);mkdirSync(dir);const result=await command(process.execPath,[fileURLToPath(new URL('./run.mjs',import.meta.url)),'--config',path,'--out',dir,'--capture-only'],{timeout:55000});writeFileSync(join(dir,'cli.log'),result.stdout+'\n'+result.stderr);assert.notEqual(result.code,124,result.stderr);return {result,report:JSON.parse(readFileSync(join(dir,'report.json')))};};
  const bad=await run('broken');assert.ok(callbackHits>0);assert.equal(bad.report.cells.length,80);assert.equal(bad.report.status,'fail');
  assert.ok(bad.report.cells.filter(c=>c.screen==='callback').every(c=>c.failures.some(f=>f.includes('duplicate visible id'))&&c.failures.some(f=>f.includes('Callback crashed'))));
  assert.ok(bad.report.cells.filter(c=>c.screen==='entry').every(c=>c.returnPaths.every(p=>p.status==='fail')&&!c.complete),JSON.stringify(bad.report));
  broken=false;const good=await run('fixed');assert.equal(good.report.cells.length,80);
  const entries=good.report.cells.filter(c=>c.screen==='entry');assert.equal(entries.length,40);
  assert.ok(entries.every(c=>c.complete&&!c.failures.length&&c.returnPaths.every(p=>p.status==='proven'&&p.proofCell&&p.route===baseURL+'/callback')),JSON.stringify(good.report));
  assert.equal(good.report.status,'incomplete','capture without visual review never passes');
  const missing=structuredClone(config);missing.flows[0].controls[0].steps[0].returnPath={flow:'absent',state:'signed-out'};assert.throws(()=>validate(missing),/returnPath/);
  completed=true;
 }finally{for(const s of [app,provider]){s.closeAllConnections();await new Promise(r=>s.close(r));}if(completed)rmSync(out,{recursive:true,force:true});else console.error('Return-path reports retained at '+out);}
});

test('return declarations require executed proof in the exact matrix and verified callback state',()=>{
 const step={action:'handoff',selector:'#go',origin:'https://identity.example.org',returnPath:{flow:'callback',state:'signed-in'}},flow={id:'entry',states:['signed-out'],steps:[],controls:[{steps:[step]}],breaks:[]},config={baseURL:'https://app.example.org',flows:[flow,{id:'callback',url:'/callback',states:['signed-in'],steps:[{action:'visible',selector:'h1'}],controls:[],breaks:[]}]};
 const source=()=>{const cell={id:'entry',screen:'entry',state:'signed-out',engine:'chromium',theme:'light',size:'390x660',complete:true,failures:[],gaps:[]};declareReturnPaths(cell,flow,{id:'signed-out'});recordDepartures(cell,[step],[{type:'handoff',origin:step.origin}]);return cell;};
 const proof=()=>({id:'callback',screen:'callback',state:'signed-in',engine:'chromium',theme:'light',size:'390x660',complete:true,failures:[],gaps:[],frames:['callback.png'],entryFrame:'callback.png',sessionVerified:true,returnPathEntry:{verified:true,route:config.baseURL+'/callback'}});
 for(const change of [()=>null,p=>({...p,size:'1440x900'}),p=>({...p,state:'signed-out'}),p=>({...p,sessionVerified:false}),p=>({...p,returnPathEntry:undefined}),p=>({...p,gaps:['callback assertion unrun']})]){const cell=source(),candidate=change(proof());resolveReturnPaths({cells:[cell,...(candidate?[candidate]:[])]},config);assert.equal(cell.complete,false);assert.deepEqual(cell.gaps,['return path not proven: #go']);}
 const cell=source();resolveReturnPaths({cells:[cell,proof()]},config);assert.equal(cell.complete,true);assert.equal(cell.returnPaths[0].status,'proven');
 resolveReturnPaths({cells:[cell]},config);assert.equal(cell.complete,false,'a previous receipt is rechecked against the actual run');
 const imported=source();delete imported.returnPaths;imported.gaps=[];resolveReturnPaths({cells:[imported,proof()]},config);assert.equal(imported.complete,false,'imported capture cannot omit a declared handoff return gap');assert.deepEqual(imported.gaps,['return path not proven: #go']);
});
