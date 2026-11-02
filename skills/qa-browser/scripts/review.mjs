import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {command} from './process.mjs';
import {redact} from './contract.mjs';

export function reviewBatches(cells,{screensPerBatch=8,framesPerSheet=8,framesPerBatch=7}={}){
 if(!Number.isInteger(screensPerBatch)||screensPerBatch<1||screensPerBatch>8)throw Error('screen group size must be 1..8');
 if(!Number.isInteger(framesPerSheet)||framesPerSheet<1||framesPerSheet>8)throw Error('sheet size must be 1..8');
 if(!Number.isInteger(framesPerBatch)||framesPerBatch<1||framesPerBatch>7)throw Error('batch frame size must be 1..7, reserving a calibration frame');
 const groups=Object.groupBy(cells,c=>c.engine+'/'+c.theme),batches=[],paths=new Set();
 for(const [group,items]of Object.entries(groups)){
  let index=0;
  for(const screen of new Set(items.map(c=>c.screen))){
   const frames=items.filter(c=>c.screen===screen).flatMap(c=>c.frames.map(path=>({path,isEntry:path===c.entryFrame,cell:c.id,screen:c.screen,engine:c.engine,theme:c.theme,size:c.size,repro:c.repro||[]})));
   for(const f of frames){if(paths.has(f.path))throw Error('duplicate capture path: '+f.path);paths.add(f.path);}
   for(let n=0;n<frames.length;n+=framesPerBatch){
    const selected=frames.slice(n,n+framesPerBatch),sheets=[];
    for(let i=0;i<selected.length;i+=framesPerSheet)sheets.push(selected.slice(i,i+framesPerSheet));
    batches.push({id:group.replace('/','-')+'-'+(++index),screens:[screen],frames:selected,sheets});
   }
  }
 }
 return batches;
}

export function applyBatch(batch,parsed){
 if(!Array.isArray(parsed.frames)||parsed.frames.length!==batch.frames.length)throw Error('critic coverage missing or duplicated');
 const judgments=batch.frames.map(f=>parsed.frames.filter(j=>j.path===f.path));
 if(judgments.some(j=>j.length!==1||!['pass','fail','inspect'].includes(j[0].status)||!Array.isArray(j[0].failures)||j[0].failures.some(x=>typeof x!=='string')))throw Error('invalid critic coverage');
 const frames=judgments.map(j=>j[0]);
 const flaggedScreens=[...new Set(batch.frames.filter((f,i)=>frames[i].status!=='pass'||frames[i].failures.length).map(f=>f.screen))];
 return {status:flaggedScreens.length?'flagged':'pass',frames,flaggedScreens};
}

export async function renderSheets(batch,out,browser){
 const page=await browser.newPage({viewport:{width:1800,height:1000}}),paths=[];
 try{for(const [index,frames]of batch.sheets.entries()){
  const caption=f=>`${f.screen}${f.isEntry?' (entry)':''} | ${f.engine} ${f.theme} ${f.size}`.replace(/[<>&]/g,'');
  await page.setContent('<html><body style="margin:0;background:#fff;color:#111;font:18px sans-serif;display:grid;grid-template-columns:repeat(4,1fr)">'+frames.map(f=>`<figure style="margin:8px"><figcaption>${caption(f)}</figcaption><img style="width:100%;height:700px;object-fit:contain;object-position:top" src="data:image/png;base64,${readFileSync(f.path).toString('base64')}"></figure>`).join('')+'</body></html>');
  await page.locator('img').evaluateAll(es=>Promise.all(es.map(e=>e.decode())));
  const path=join(out,`sheet-${batch.id}-${index+1}.png`);await page.screenshot({path,fullPage:true});paths.push(path);
 }}finally{await page.close();}
 return paths;
}

function parseOutput(stdout){
 let text=stdout.trim();
 try{const wrapper=JSON.parse(text);if(typeof wrapper.result==='string')text=wrapper.result;}catch{}
 return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g,''));
}

async function calibration(out,key,browser){
 const path=join(out,'review-check-'+key+'.png'),page=await browser.newPage({viewport:{width:390,height:660}});
 try{
  await page.setContent('<html style="background:white;color:black;font:24px sans-serif"><body><h1>Preferences</h1><p>Choose an action</p><button style="position:absolute;top:180px;left:30px;width:270px;height:100px;font:32px sans-serif">Continue</button><button style="position:absolute;top:205px;left:60px;width:270px;height:100px;font:32px sans-serif">Cancel</button></body></html>');
  await page.screenshot({path});
 }finally{await page.close();}
 return {path,screen:'Supplementary frame',size:'390x660',isEntry:false};
}

function digest(value){return createHash('sha256').update(value).digest('hex');}
function evidence(paths){return paths.map(path=>[path,existsSync(path)?digest(readFileSync(path)):'missing']);}
function receipt(stdout,frames){
 // Preserve exact public artifact paths while redacting account data in model prose.
 let result=stdout;const markers=frames.map((f,i)=>['FRAMEIDENTITY'+i+'END',f.path]);
 for(const [marker,path]of markers)result=result.replaceAll(path,marker);
 result=redact(result);
 for(const [marker,path]of markers)result=result.replaceAll(marker,path);
 return result;
}

export async function runReview(report,config,out,cwd,browser,{invoke=command}={}){
 const batches=reviewBatches(report.cells,config.review),deadline=Date.now()+(config.reviewTimeoutMs||7200000);
 const priorPath=join(out,'review-ledger.json');
 let previous;
 if(config.review?.resume&&existsSync(priorPath))previous=JSON.parse(readFileSync(priorPath,'utf8'));
 const identity=digest(JSON.stringify({head:report.head,build:report.build,servedBuild:report.servedBuild?.id,
  rules:evidence(config.designRules||[]),references:evidence(config.references||[]),chrome:config.prototypeChrome||[],version:2}));
 let halted=false;
 for(const c of report.cells){delete c.critic;delete c.visualFailures;}
 report.gaps=report.gaps.filter(g=>!g.startsWith('critic batch incomplete')&&!g.startsWith('some frames lack')&&!g.startsWith('Opus quota unavailable')&&!g.startsWith('critic calibration missed'));
 const owner=join(process.env.HOME,'.claude','AGENTS.md');
 const credentialRule=existsSync(owner)?readFileSync(owner,'utf8').split('\n').find(l=>l.startsWith('- When an agent looks for a credential'))||'':'';
 const policy=`Screenshot lane: Opus-only visual critique; independent code critique belongs to the orchestrator under cross-review. Declared prototype chrome is excluded from product judgment: ${JSON.stringify(config.prototypeChrome||[])}. Its hidden/masked regions are not product blank-space defects. A frame with isEntry:true shows the initial screen before any control or break action; judge later frames as the resulting states.
Read ${owner} section 0 and these repo rules: ${(config.designRules||[]).join(', ')}. ${credentialRule}\nDo not edit, run commands, access accounts or services. Judge all no-slop rules: duplicated/overlapping controls, fake device chrome, clipping, images, contrast, hierarchy, template composition, generic filler. Approved references: ${(config.references||[]).join(', ')||'none supplied; do not invent an approved reference'}.`;
 report.review={identity,visualCritic:'Opus-only',codeCritic:'external cross-review required',batches:[],complete:false};
 const checkpoint=()=>writeFileSync(priorPath,JSON.stringify(report.review,null,2));
 async function call(batch,mode){
  const key=batch.id+'-'+mode,signature=digest(identity+JSON.stringify(evidence(batch.frames.map(f=>f.path)))+mode+policy);
  const cached=previous?.identity===identity&&previous.batches.find(b=>b.id===key&&b.signature===signature&&['pass','flagged'].includes(b.status)&&b.canary?.status==='caught');
  if(cached){
   try{const judgment=applyBatch(batch,{frames:cached.judgments});if(mode!=='sheets'&&judgment.frames.some(f=>f.status==='inspect'))throw Error('unresolved cached verdict');report.review.batches.push({...cached,reused:true});checkpoint();return judgment;}catch{}
  }
  const control=await calibration(out,key,browser),frames=[...batch.frames,control];
  const sheets=mode==='sheets'?await renderSheets({...batch,sheets:Array.from({length:Math.ceil(frames.length/(config.review?.framesPerSheet||8))},(_,i)=>frames.slice(i*(config.review?.framesPerSheet||8),(i+1)*(config.review?.framesPerSheet||8)))},out,browser):[];
  report.sheets||=[];report.sheets.push(...sheets);
  const promptPath=join(out,key+'.prompt.md'),manifest=frames.map(f=>({path:f.path,screen:f.screen,size:f.size,isEntry:f.isEntry}));
  const instruction=mode==='sheets'?`Read ONLY these contact sheets first: ${sheets.join(', ')}. Each caption maps to a frame below. Judge every frame. Use inspect when text/details are too small or any defect is suspected; flagged screens receive full-size follow-up.`:`Read EVERY full-size frame below. Resolve the flagged observations. Give a definite pass or fail for each; do not return inspect.`;
  writeFileSync(promptPath,`${policy}\n${instruction}\nOutput only JSON {"frames":[{"path":"exact manifest path","status":"pass|fail|inspect","failures":["specific observation"]}]}. Exactly one entry per manifest path, no omitted or extra frames.\n${JSON.stringify(manifest)}`);
  const entry={id:key,signature,mode,screens:batch.screens,frames:batch.frames.map(f=>f.path),sheets,attempts:[],status:'incomplete',canary:{status:'unrun'}};report.review.batches.push(entry);checkpoint();
  for(let attempt=0;attempt<2;attempt++){
   if(Date.now()>=deadline)break;
   const started=Date.now();
   const result=await invoke('claude',['-p','--model','opus','--permission-mode','dontAsk','--tools','Read','--allowedTools','Read','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--no-session-persistence','--output-format','json','--',`Read ${promptPath} and return the required JSON after reviewing its images.`],{cwd,timeout:Math.min(config.criticTimeoutMs||600000,600000,deadline-Date.now()),env:{...process.env,CLAUDE_CONFIG_DIR:join(process.env.HOME,'.claude-b')}});
   writeFileSync(join(out,`${key}-attempt${attempt+1}.txt`),receipt(result.stdout,frames));
   writeFileSync(join(out,`${key}-attempt${attempt+1}.stderr.txt`),redact(result.stderr||''));
   const record={attempt:attempt+1,exit:result.code,elapsedMs:Date.now()-started};entry.attempts.push(record);
   let envelope;try{envelope=JSON.parse(result.stdout);}catch{}
   const quotaText=(result.stderr||'')+(result.code!==0||envelope?.is_error?result.stdout:'');
   if(/rate.limit|rate_limit|usage limit|hit your limit|out of.{0,20}usage/i.test(quotaText)){
    halted=true;record.reason='Reviewer quota unavailable; no retry before reset';entry.status='blocked';report.gaps.push('Opus quota unavailable; review stopped without fallback');checkpoint();return null;
   }
   try{
    if(result.code!==0)throw Error('critic process failed or timed out');
    const all=applyBatch({frames},parseOutput(result.stdout)),check=all.frames.find(f=>f.path===control.path);
    if(check.status!=='fail'||!check.failures.some(f=>/overlap|occlud|obscur|cover|clip/i.test(f))){
     halted=true;entry.canary.status='missed';record.reason='generated overlapping controls were not detected';report.gaps.push('critic calibration missed; no visual verdict');checkpoint();return null;
    }
    entry.canary.status='caught';
    const judgment=applyBatch(batch,{frames:all.frames.filter(f=>f.path!==control.path)});
    if(mode!=='sheets'&&judgment.frames.some(f=>f.status==='inspect'))throw Error('full-size review did not resolve verdict');
    entry.status=judgment.status;entry.judgments=judgment.frames;checkpoint();return judgment;
   }catch(error){record.reason=redact(error.message);checkpoint();}
  }
  report.gaps.push('critic batch incomplete after one retry: '+key);return null;
 }
 const resolved=new Map(),flagged=new Set();
 for(const batch of batches){
  if(halted)break;
  const initial=await call(batch,'sheets');if(!initial)continue;
  for(const f of initial.frames)resolved.set(f.path,f);
  for(const screen of initial.flaggedScreens)flagged.add(batch.frames[0].engine+'/'+batch.frames[0].theme+'/'+screen);
 }
 // A flag rechecks the entire screen in bounded full-size chunks, including neighboring batches.
 for(const batch of batches){
  if(halted)break;
  const group=batch.frames[0].engine+'/'+batch.frames[0].theme+'/'+batch.screens[0];
  if(!flagged.has(group))continue;
  for(const f of batch.frames)resolved.delete(f.path);
  const full=await call({...batch,id:batch.id+'-follow'},'full');
  if(full)for(const f of full.frames)resolved.set(f.path,f);
 }
 for(const c of report.cells){
  const judgments=c.frames.map(path=>resolved.get(path));
  if(!judgments.length||judgments.some(j=>!j||j.status==='inspect'))continue;
  c.critic=judgments.some(j=>j.status==='fail'||j.failures.length)?'fail':'pass';c.visualFailures=judgments.flatMap(j=>j.failures).map(redact);
 }
 report.review.complete=report.cells.every(c=>c.frames.length&&['pass','fail'].includes(c.critic));checkpoint();
 if(!report.review.complete)report.gaps.push('some frames lack a completed visual verdict');
}
