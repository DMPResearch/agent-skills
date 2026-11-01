#!/usr/bin/env node
import {readFileSync,mkdirSync,existsSync,writeFileSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
import {validate,selectScope,matrix,redact} from './contract.mjs';
import {runCell} from './cell.mjs';
import {command,contactSheet,critique,save} from './report.mjs';

const args=process.argv.slice(2),option=name=>args[args.indexOf(name)+1];
if(!args.includes('--config')){console.error('Usage: run.mjs --config /repo/qa-browser.json --out /evidence [--pr-base REF]');process.exit(2);}
const configPath=resolve(option('--config')),root=dirname(configPath),out=resolve(args.includes('--out')?option('--out'):join(root,'.qa-browser'));
mkdirSync(out,{recursive:true});
const report={version:1,status:'incomplete',started:new Date().toISOString(),cells:[],gaps:[],scope:[],sheets:[],unrun:['native Safari and Android Chrome are separate verify-live lanes']};
let config,browserModule,adapter,startedServer,deadline,timer,stopping=false;
const stop=()=>{stopping=true;report.gaps.push('QA run cancelled; remainder unrun');for(const b of browsers.values())b.close().catch(()=>{});};
process.once('SIGTERM',stop);process.once('SIGINT',stop);
const browsers=new Map(), launches=new Map();
const json=path=>JSON.parse(readFileSync(resolve(root,path),'utf8'));
const git=(...a)=>execFileSync('git',a,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
try{
 config=json(configPath);
 if(typeof config.flows==='string')config.flows=json(config.flows);
 validate(config);
 try{report.head=git('rev-parse','HEAD');const dirty=git('status','--porcelain');if(dirty)report.gaps.push('working tree differs from recorded head');}
 catch{report.gaps.push('git head unavailable');if(args.includes('--pr-base'))throw Error('PR mode requires a git checkout');}
 deadline=Date.now()+Math.min(config.timeoutMs||1800000,1800000);
 timer=setTimeout(()=>{report.gaps.push('30-minute run cap reached');for(const b of browsers.values())b.close().catch(()=>{});},deadline-Date.now());
 if(config.adapter)adapter=await import(pathToFileURL(resolve(root,config.adapter)));
 let graph;
 if(args.includes('--pr-base')){
  const base=git('merge-base',option('--pr-base'),'HEAD');report.base=base;
  if(!config.graph){report.gaps.push('missing compiler/bundler base/head graph; all main flows selected');graph={changed:['[missing graph]'],head:{},base:{}};}
  else{
   const data=json(config.graph);
   const changed=git('diff','--name-only','--no-renames',base,'HEAD').split('\n').filter(Boolean);
   if(data.head!==report.head||data.base!==base||data.complete!==true){report.gaps.push('graph identity or completeness unverified; all main flows selected');graph={changed:['[unverified graph]'],head:{},base:{}};}
   else graph={changed,head:data.headImports,base:data.baseImports};
  }
 }
 const scope=selectScope(config.flows,graph,config.globals);
 if(!scope.length)report.gaps.push('no flows selected; verify change ownership');
 report.scope=scope.map(s=>({id:s.flow.id,tier:s.tier,reason:s.reason}));
 const toolchain=resolve(root,config.playwrightPath||'package.json'),req=createRequire(toolchain);
 for(const name of ['playwright','@playwright/test']){try{browserModule=req(name);break;}catch{}}
 if(!browserModule)throw Error('Playwright missing from target repo or configured playwrightPath; nothing installed');
 if(config.start){
  if(config.baseURL)throw Error('choose existing baseURL or owned start command, not both');
  if(!Array.isArray(config.start.command)||!config.start.url)throw Error('start needs command argv and url');
  startedServer=spawn(config.start.command[0],config.start.command.slice(1),{cwd:root,stdio:'ignore'});
  startedServer.on('error',()=>report.gaps.push('owned start command failed'));
  config.baseURL=config.start.url;
 }
 const health=new URL(config.healthPath||'/',config.baseURL);
 let healthy=false;for(let i=0;i<(startedServer?30:1);i++){
  try{const r=await fetch(health,{signal:AbortSignal.timeout(3000)});if(r.ok){healthy=true;break;}}catch{}
  if(startedServer)await new Promise(r=>setTimeout(r,500));
 }
 if(!healthy)throw Error('served app unavailable; no server restarted');
 if(adapter?.buildIdentity)report.build=await adapter.buildIdentity({config,root});
 else if(config.buildManifest){
  const manifest=json(config.buildManifest);config.assetHashes=manifest.assets;let mismatch=false;
  if(!manifest.head||manifest.head!==report.head){report.gaps.push('production manifest does not match current git head');mismatch=true;}
  for(const [path,expected]of Object.entries(manifest.assets||{})){
   const response=await fetch(new URL(path,config.baseURL));
   const hash=createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex');
   if(!response.ok||hash!==expected)mismatch=true;
  }
  if(!Object.keys(manifest.assets||{}).length||mismatch)report.gaps.push('production asset hashes missing or mismatched');else report.build=manifest.id;
 }else report.gaps.push('production build identity and matching HTML/JS/CSS not verified');
 if(config.standingCrawl){
  const s=config.standingCrawl;
  const result=await command(s.command[0],s.command.slice(1),{cwd:root,timeout:Math.max(1,deadline-Date.now()),env:{...process.env,...s.env}});
  writeFileSync(join(out,'standing-crawl.log'),redact(result.stdout+'\n'+result.stderr));
  report.standing={exit:result.code,report:s.report};
  if(result.code!==0)report.gaps.push('standing crawl failed or incomplete; see external report');
 }
 if(adapter?.setup)await adapter.setup({config,root});
 const tasks=scope.flatMap(s=>matrix(s.tier).flatMap(cell=>(s.tier==='global'?s.flow.states.slice(0,1):s.flow.states).map(state=>({...s,...cell,state:typeof state==='string'?{id:state}:state}))));
 report.expectedCells=tasks.length;
 let next=0;
 await Promise.all([0,1].map(async()=>{
  while(next<tasks.length&&!stopping&&Date.now()<deadline){const t=tasks[next++];await runCell(t,{config,report,out,browserModule,browsers,launches,adapter});}
 }));
 if(report.cells.length!==tasks.length)report.gaps.push(`unrun cells: ${tasks.length-report.cells.length}`);
 const b=await browserModule.chromium.launch();
 try{report.sheets=await contactSheet(report.cells,out,b);}finally{await b.close();}
 if(!stopping&&Date.now()<deadline)await critique(report,{...config,criticTimeoutMs:Math.min(config.criticTimeoutMs||300000,deadline-Date.now())},out,root);
 else report.gaps.push('critic unrun: run cap exhausted');
}catch(error){report.gaps.push(redact(error.message));}
finally{
 clearTimeout(timer);process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);
 for(const b of browsers.values())await b.close().catch(()=>{});
 try{await adapter?.cleanup?.({config,root});}catch{report.gaps.push('adapter cleanup failed; safe test data requires cleanup');}
 if(startedServer)startedServer.kill('SIGTERM');
 report.finished=new Date().toISOString();
 const exit=save(report,out);console.log(JSON.stringify({status:report.status,cells:report.cells.length,report:join(out,'report.json')}));process.exitCode=exit;
}
