import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,chmodSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {command} from './process.mjs';
import {matrix,breakKinds} from './contract.mjs';

test('CLI resumes only failed review work without replaying capture or service setup',{skip:!process.env.QA_PW_PATH,timeout:30000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'qa-resume-')),source=join(dir,'source'),bin=join(dir,'bin'),out=join(dir,'out');mkdirSync(source);mkdirSync(bin);
 const pw=createRequire(process.env.QA_PW_PATH)('playwright'),browser=await pw.chromium.launch();
 const server=createServer((req,res)=>res.end('<html><body>Preferences</body></html>'));await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  execFileSync('git',['init','-q',source]);writeFileSync(join(source,'entry.js'),'export const name="Preferences";');execFileSync('git',['add','.'],{cwd:source});execFileSync('git',['-c','user.name=Test','-c','user.email=test@example.invalid','commit','-qm','Fixture'],{cwd:source});
  const page=await browser.newPage(),originals=new Map();
  for(const size of new Set(matrix().map(c=>c.size))){const [width,height]=size.split('x').map(Number);await page.setViewportSize({width,height});await page.setContent('<body style="color:black;background:white"><h1>Preferences</h1></body>');const path=join(dir,size+'.png');await page.screenshot({path});originals.set(size,path);}await page.close();
  const rows=matrix().map((c,i)=>{const path=join(dir,'frame-'+i+'.png');writeFileSync(path,readFileSync(originals.get(c.size)));return {...c,screen:'entry',path,failures:[]};});
  const capture={summary:{complete:true},results:rows,interactions:[],edges:rows.map(r=>({screen:r.screen,engine:r.engine,theme:r.theme,size:r.size,controls:[],checks:breakKinds.map(kind=>({kind,pass:true}))}))};
  const produced=join(dir,'produced.txt'),raw=join(dir,'capture.json'),producer=join(dir,'produce.mjs');
  writeFileSync(producer,`import {writeFileSync,appendFileSync} from 'node:fs';appendFileSync(${JSON.stringify(produced)},'capture\\n');writeFileSync(${JSON.stringify(raw)},${JSON.stringify(JSON.stringify(capture))});`);
  const imageHashes=rows.map(r=>readFileSync(r.path).toString('base64'));
  const critic=join(bin,'claude'),calls=join(dir,'calls.txt'),retryFlag=join(dir,'first-pass');
  writeFileSync(critic,`#!/usr/bin/env node
import {readFileSync,appendFileSync,existsSync} from 'node:fs';
import {imageEvents} from ${JSON.stringify(fileURLToPath(new URL('./fixtures/critic.mjs',import.meta.url)))};
const prompt=process.argv.at(-1).match(/^Read (.+) and return/)[1],manifest=JSON.parse(readFileSync(prompt,'utf8').split('\\n').at(-1));
appendFileSync(${JSON.stringify(calls)},prompt+'\\n');
if(existsSync(${JSON.stringify(retryFlag)})&&prompt.includes('webkit-dark-1-sheets'))process.exit(124);
const originals=new Set(${JSON.stringify(imageHashes)});
const judgments={frames:manifest.map(f=>{const same=originals.has(readFileSync(f.path).toString('base64'));return {path:f.path,status:same?'pass':'fail',rules:same?[]:['overlapping-controls'],failures:same?[]:['Independent buttons overlap and obscure labels']};})};
for(const event of imageEvents(prompt,judgments.frames))console.log(JSON.stringify(event));
console.log(JSON.stringify(judgments));
`);chmodSync(critic,0o755);writeFileSync(retryFlag,'pending');
  const config={version:1,repoRoot:source,baseURL:`http://127.0.0.1:${server.address().port}`,playwrightPath:process.env.QA_PW_PATH,designRules:[join(source,'entry.js')],references:[rows[0].path],buildProbe:['/'],flows:[{id:'entry',entry:'entry.js',url:'/',main:true,states:['signed-out'],steps:[],controls:[],breaks:[]}],standingCrawl:{command:[process.execPath,producer],useResults:true,report:raw}};
  const configPath=join(dir,'config.json'),script=fileURLToPath(new URL('./run.mjs',import.meta.url));writeFileSync(configPath,JSON.stringify(config));
  const run=flags=>command(process.execPath,[script,'--config',configPath,'--out',out,...flags],{cwd:dir,timeout:25000,env:{...process.env,PATH:bin+':'+process.env.PATH}});
  await run([]);const first=JSON.parse(readFileSync(join(out,'report.json')));assert.equal(first.review.complete,false);
  const count=readFileSync(calls,'utf8').trim().split('\n').length;rmSync(retryFlag);
  const resumed=await run(['--resume-review']);
  assert.equal(readFileSync(produced,'utf8').trim().split('\n').length,1,'capture must not run on review resume');
  assert.equal(readFileSync(calls,'utf8').trim().split('\n').length,count+1,'only the failed batch reruns');
  const result=JSON.parse(readFileSync(join(out,'report.json')));assert.equal(result.review.complete,true);assert.equal(resumed.code,2,'unverified production build cannot pass');
  const checks=join(dir,'identity-checks.txt'),cleanups=join(dir,'cleanup-count.txt'),adapter=join(dir,'build-adapter.mjs');
  const expected=createHash('sha256').update('<html><body>Preferences</body></html>').digest('hex');
  writeFileSync(adapter,`import {appendFileSync} from 'node:fs';import {createHash} from 'node:crypto';
export async function buildIdentity({config}){appendFileSync(${JSON.stringify(checks)},'x');const response=await fetch(config.baseURL);const id=createHash('sha256').update(await response.text()).digest('hex');if(!response.ok||id!==${JSON.stringify(expected)})throw Error('served fixture differs');return {kind:'verified-fixture',id};}
export async function cleanup(){appendFileSync(${JSON.stringify(cleanups)},'x');}`);
  config.adapter=adapter;delete config.buildProbe;writeFileSync(configPath,JSON.stringify(config));
  await run([]);assert.equal(readFileSync(checks).length,1);assert.equal(readFileSync(cleanups).length,1);
  const verified=await run(['--resume-review']);assert.equal(verified.code,0,'buildIdentity adapter must verify served bytes during resume');
  assert.equal(readFileSync(checks).length,2);assert.equal(readFileSync(cleanups).length,1,'resume must not repeat service cleanup');
  assert.equal(readFileSync(produced,'utf8').trim().split('\n').length,2);
  const finalCount=readFileSync(calls,'utf8').trim().split('\n').length;
  writeFileSync(join(source,'entry.js'),'export const name="Changed source";');
  const refused=await run(['--resume-review']);
  const stale=JSON.parse(readFileSync(join(out,'report.json')));
  assert.equal(refused.code,2);assert.equal(stale.cells.length,0);assert.ok(stale.gaps.some(g=>g.includes('matching clean source')));
  assert.equal(readFileSync(calls,'utf8').trim().split('\n').length,finalCount,'changed source cannot reuse or invoke a prior verdict');
 }finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});}
});
