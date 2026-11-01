import test from 'node:test';
import assert from 'node:assert/strict';
import {selectScope,matrix} from './contract.mjs';
const flows=[{id:'home',entry:'src/home.ts',main:true},{id:'settings',entry:'src/settings.ts',main:true}];
test('scope never downgrades fallback for later globals, in either order',()=>{
 for(const changed of [['src/unknown.ts','tokens.css'],['tokens.css','src/unknown.ts']]){const selected=selectScope(flows,{changed,head:{},base:{}},['tokens.css']);assert.deepEqual(selected.map(s=>s.tier),['fallback','fallback']);assert.ok(selected.every(s=>matrix(s.tier).length===48));}
});
test('non UI changes select nothing, unknown source falls back and imported config selects its UI',()=>{
 for(const file of ['README.md','docs/guide.ts','src/home.test.ts','tests/home.ts','vite.config.ts','.github/workflows/ci.yml','config/unused.json'])assert.deepEqual(selectScope(flows,{changed:[file],head:{},base:{}}),[],file);
 for(const file of ['src/unknown.ts','src/article.mdx'])assert.equal(selectScope(flows,{changed:[file],head:{},base:{}})[0].tier,'fallback');
 assert.equal(selectScope(flows,{changed:['config/read.json'],head:{'src/home.ts':['config/read.json']},base:{}})[0].flow.id,'home');
});

test('CLI skips non UI PR changes without touching a browser or app',async()=>{
 const {mkdtempSync,writeFileSync,readFileSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {execFileSync}=await import('node:child_process');const {command}=await import('./process.mjs');const {fileURLToPath}=await import('node:url');
 const dir=mkdtempSync(join(tmpdir(),'qa-skip-'));const git=(...a)=>execFileSync('git',a,{cwd:dir,encoding:'utf8'}).trim();
 try{git('init','-q');writeFileSync(join(dir,'app.js'),'export {}');git('add','app.js');git('-c','user.name=Test','-c','user.email=test@example.invalid','commit','-qm','Base');const base=git('rev-parse','HEAD');writeFileSync(join(dir,'README.md'),'Changed documentation');git('add','README.md');git('-c','user.name=Test','-c','user.email=test@example.invalid','commit','-qm','Docs');const head=git('rev-parse','HEAD');
 writeFileSync(join(dir,'graph.json'),JSON.stringify({head,base,complete:true,headImports:{'app.js':[]},baseImports:{'app.js':[]}}));
 const config={version:1,baseURL:'http://127.0.0.1:1',graph:'graph.json',flows:[{...flows[0],url:'/',states:['signed-out'],steps:[],controls:[],breaks:[]}]};writeFileSync(join(dir,'qa-browser.json'),JSON.stringify(config));
 const result=await command(process.execPath,[fileURLToPath(new URL('./run.mjs',import.meta.url)),'--config',join(dir,'qa-browser.json'),'--out',join(dir,'out'),'--pr-base',base],{cwd:dir,timeout:10000});
 const report=JSON.parse(readFileSync(join(dir,'out/report.json')));assert.equal(result.code,0);assert.equal(report.status,'not-applicable');assert.equal(report.cells.length,0);assert.deepEqual(report.scope,[]);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
