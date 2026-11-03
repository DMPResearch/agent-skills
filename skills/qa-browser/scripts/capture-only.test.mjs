import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,chmodSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {command} from './process.mjs';
import {breakKinds} from './contract.mjs';

test('capture-only CLI runs the native matrix and functional checks without any critic',{skip:!process.env.QA_PW_PATH,timeout:60000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'qa-capture-only-')),source=join(dir,'source'),bin=join(dir,'bin');mkdirSync(source);mkdirSync(bin);
 let complete=false,html='<html style="background:white;color:black"><body><h1>Preferences</h1></body></html>';
 const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(html);});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  execFileSync('git',['init','-q',source]);writeFileSync(join(source,'entry.js'),'export const name="Preferences";');execFileSync('git',['add','.'],{cwd:source});execFileSync('git',['-c','user.name=Test','-c','user.email=test@example.invalid','commit','-qm','Fixture'],{cwd:source});
  const calls=join(dir,'critic-calls'),critic=join(bin,'claude');
  writeFileSync(critic,`#!/usr/bin/env node\nimport {appendFileSync} from 'node:fs';appendFileSync(${JSON.stringify(calls)},'called\\n');process.exitCode=1;`);chmodSync(critic,0o755);
  const head=execFileSync('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8'}).trim(),manifest=join(dir,'manifest.json');
  writeFileSync(manifest,JSON.stringify({head,id:'fixture-build',assets:{'/':createHash('sha256').update(html).digest('hex')}}));
  const adapter=join(dir,'adapter.mjs');
  writeFileSync(adapter,`import {randomUUID} from 'node:crypto';
const id='fixture-'+randomUUID();
export async function authenticate({context,state,config}){if(state==='signed-in')await context.addCookies([{name:'fixture_identity',value:id,url:config.baseURL}]);}
export async function verifySession({context,config}){const cookie=(await context.cookies(config.baseURL)).find(c=>c.name==='fixture_identity');if(cookie?.value!==id)throw Error('fixture identity unavailable');return {id:cookie.value};}`);
  const config={version:1,repoRoot:source,baseURL:`http://127.0.0.1:${server.address().port}`,playwrightPath:process.env.QA_PW_PATH,adapter,buildManifest:manifest,designRules:[join(source,'entry.js')],references:[join(source,'entry.js')],flows:[{id:'entry',entry:'entry.js',url:'/',main:true,states:['signed-out','signed-in'],steps:[{action:'text',selector:'h1',value:'Preferences'}],controls:[],breaks:breakKinds.map(kind=>({kind,notApplicable:'Read-only page without controls'}))}]};
  const path=join(dir,'config.json'),script=fileURLToPath(new URL('./run.mjs',import.meta.url));
  const run=async(name,flags=[])=>{writeFileSync(path,JSON.stringify(config));const out=join(dir,name);const result=await command(process.execPath,[script,'--config',path,'--out',out,'--capture-only',...flags],{cwd:dir,timeout:25000,env:{...process.env,PATH:bin+':'+process.env.PATH}});return {...result,report:JSON.parse(readFileSync(join(out,'report.json'))),markdown:readFileSync(join(out,'report.md'),'utf8')};};
  const good=await run('good');
  assert.equal(existsSync(calls),false,'capture-only must never call a critic');
  assert.equal(good.code,2);assert.equal(good.report.status,'incomplete');
  assert.equal(good.report.cells.length,40);assert.equal(good.report.expectedCells,40);
  assert.equal(good.report.cells.filter(c=>c.state==='signed-in'&&c.sessionVerified).length,20);
  assert.equal(good.report.screens[0].functional,'pass');
  assert.ok(good.report.cells.every(c=>c.complete&&!c.failures.length&&c.frames.length>0&&c.critic!=='pass'),JSON.stringify(good.report.cells));
  assert.deepEqual(good.report.gaps,['visual review not run']);assert.match(good.markdown,/visual review not run/);
  html=html.replace('</body>','<script>console.error("Intentional fixture failure")</script></body>');
  writeFileSync(manifest,JSON.stringify({head,id:'fixture-build',assets:{'/':createHash('sha256').update(html).digest('hex')}}));
  const bad=await run('bad');assert.equal(bad.code,1);assert.equal(bad.report.status,'fail');
  assert.equal(bad.report.cells.length,40);assert.ok(bad.report.cells.every(c=>c.failures.some(f=>f.includes('Intentional fixture failure'))));
  assert.ok(bad.report.gaps.includes('visual review not run'));assert.equal(existsSync(calls),false);
  const conflict=await run('conflict',['--resume']);assert.equal(conflict.code,2);assert.equal(conflict.report.cells.length,0);
  assert.ok(conflict.report.gaps.some(g=>g.includes('cannot combine')));assert.equal(existsSync(calls),false);
  writeFileSync(join(source,'README.md'),'Documentation only');execFileSync('git',['add','.'],{cwd:source});execFileSync('git',['-c','user.name=Test','-c','user.email=test@example.invalid','commit','-qm','Document fixture'],{cwd:source});
  const nextHead=execFileSync('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8'}).trim();config.graph=join(dir,'graph.json');
  writeFileSync(config.graph,JSON.stringify({base:head,head:nextHead,complete:true,baseImports:{},headImports:{}}));
  const nonUI=await run('non-ui',['--pr-base',head]);assert.equal(nonUI.report.notApplicable,true);
  assert.equal(nonUI.code,2);assert.equal(nonUI.report.status,'incomplete');assert.ok(nonUI.report.gaps.includes('visual review not run'));
  complete=true;
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));if(complete)rmSync(dir,{recursive:true,force:true});else console.error('Fixture reports retained at '+dir);}
});
