import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtempSync,writeFileSync,readFileSync,copyFileSync,rmSync} from 'node:fs';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {command} from './process.mjs';
import {execFileSync} from 'node:child_process';
import {matrix} from './contract.mjs';

test('CLI imports a fresh completed failed capture and rejects a stale report',{skip:!process.env.QA_PW_PATH},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'qa-provider-')),pw=createRequire(process.env.QA_PW_PATH)('playwright');
 const browser=await pw.chromium.launch(),page=await browser.newPage();
 let served='Ready';const server=createServer((req,res)=>res.end('<html><body>'+served+'</body></html>'));await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  await page.setContent('<h1>Ready</h1>');
  const originals=new Map();
  for(const size of [...new Set(matrix().map(c=>c.size))]){const [width,height]=size.split('x').map(Number);await page.setViewportSize({width,height});const path=join(dir,size+'.png');await page.screenshot({path});originals.set(size,path);}
  const results=matrix().map((c,i)=>{const path=join(dir,'frame-'+i+'.png');copyFileSync(originals.get(c.size),path);return {...c,screen:'home',path,failures:i===0?['Intentional fixture defect']:[]};});
  const edges=results.map(r=>({screen:r.screen,engine:r.engine,theme:r.theme,width:Number(r.size.split('x')[0]),height:Number(r.size.split('x')[1]),controls:[]}));
  const raw=join(dir,'capture.json'),producer=join(dir,'produce.mjs');
  writeFileSync(producer,`import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(join(dir,'received-scope.json'))},process.env.QA_BROWSER_SCOPE);writeFileSync(${JSON.stringify(raw)},${JSON.stringify(JSON.stringify({summary:{complete:true},results,edges,interactions:[]}))});process.exitCode=1;`);
  execFileSync('git',['init','-q',dir]);writeFileSync(join(dir,'source.txt'),'fixture');execFileSync('git',['add','source.txt'],{cwd:dir});execFileSync('git',['-c','user.name=Test','-c','user.email=test@example.invalid','commit','-qm','Fixture'],{cwd:dir});
  const head=execFileSync('git',['rev-parse','HEAD'],{cwd:dir,encoding:'utf8'}).trim();
  const config={version:1,repoRoot:dir,buildProbe:['/'],baseURL:`http://127.0.0.1:${server.address().port}`,playwrightPath:process.env.QA_PW_PATH,flows:[{id:'home',url:'/',entry:'home.js',main:true,states:['signed-out'],steps:[],controls:[],breaks:[]}],standingCrawl:{command:[process.execPath,producer],useResults:true,report:raw}};
  const file=join(dir,'qa-browser.json');writeFileSync(file,JSON.stringify(config));
  const script=fileURLToPath(new URL('./run.mjs',import.meta.url)),out=join(dir,'result');
  await command(process.execPath,[script,'--config',file,'--out',out],{cwd:dir,timeout:30000});
  const fresh=JSON.parse(readFileSync(join(out,'report.json')));
  const received=JSON.parse(readFileSync(join(dir,'received-scope.json')));assert.equal(received[0].screen,'home');assert.equal(received[0].matrix.length,20);
  assert.equal(fresh.head,head);assert.ok(fresh.build?.id);assert.equal(fresh.build.kind,'served-content');assert.ok(fresh.build.assets[0].sha256);
  served='Changed served asset';
  await command(process.execPath,[script,'--config',file,'--out',join(dir,'changed')],{cwd:dir,timeout:30000});
  const changed=JSON.parse(readFileSync(join(dir,'changed','report.json')));assert.notEqual(changed.build.id,fresh.build.id);
  assert.equal(fresh.cells.length,20);assert.equal(fresh.status,'fail');assert.ok(!fresh.gaps.some(g=>g.includes('standing crawl failed')));
  config.standingCrawl.command=[process.execPath,'-e','process.exit(0)'];writeFileSync(file,JSON.stringify(config));
  await command(process.execPath,[script,'--config',file,'--out',join(dir,'stale')],{cwd:dir,timeout:30000});
  const stale=JSON.parse(readFileSync(join(dir,'stale','report.json')));
  assert.equal(stale.cells.length,0);assert.ok(stale.gaps.some(g=>g.includes('stale')));
 }finally{await browser.close();await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});}
});
