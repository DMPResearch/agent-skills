import {readFileSync,writeFileSync,existsSync,copyFileSync,mkdirSync} from 'node:fs';
import {createHash,randomUUID,randomInt} from 'node:crypto';
import {join,basename} from 'node:path';
import {command} from './process.mjs';
import {reviewBatches,reviewPlan,frameGroup} from './review-plan.mjs';
import {redact} from './contract.mjs';

export {reviewBatches,reviewPlan} from './review-plan.mjs';

export function applyBatch(batch,parsed){
 if(!Array.isArray(parsed.frames)||parsed.frames.length!==batch.frames.length)throw Error('critic coverage missing or duplicated');
 const judgments=batch.frames.map(f=>parsed.frames.filter(j=>j.path===f.path));
 if(judgments.some(j=>j.length!==1||!['pass','fail','inspect'].includes(j[0].status)||!Array.isArray(j[0].failures)||j[0].failures.some(x=>typeof x!=='string')||j[0].rules!==undefined&&(!Array.isArray(j[0].rules)||j[0].rules.some(x=>typeof x!=='string'))))throw Error('invalid critic coverage');
 const frames=judgments.map(j=>j[0]);
 const flaggedScreens=[...new Set(batch.frames.filter((f,i)=>frames[i].status!=='pass'||frames[i].failures.length||frames[i].rules?.length).map(f=>f.screen))];
 return {status:flaggedScreens.length?'flagged':'pass',frames,flaggedScreens,flaggedGroups:[...new Set(batch.frames.filter((f,i)=>frames[i].status!=='pass'||frames[i].failures.length||frames[i].rules?.length).map(frameGroup))]};
}

export async function renderSheets(batch,out,browser){
 const page=await browser.newPage({viewport:{width:1800,height:1000}}),paths=[];
 try{for(const [index,frames]of batch.sheets.entries()){
  const caption=f=>`${basename(f.path)} | ${f.screen} ${f.state}${f.isEntry?' (entry)':''} | ${f.engine} ${f.theme} ${f.size}`.replace(/[<>&]/g,'');
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

async function reviewInputs(batch,out,key,browser){
 const dir=join(out,'review-inputs',key);mkdirSync(dir,{recursive:true});
 const frames=batch.frames.map(f=>{const path=join(dir,randomUUID()+'.png');copyFileSync(f.path,path);return {...f,path,source:f.path};});
 const sample=batch.frames[randomInt(batch.frames.length)],path=join(dir,randomUUID()+'.png');
 const [width,height]=sample.size.split('x').map(Number),page=await browser.newPage({viewport:{width,height}});
 try{
  await page.setContent('<html style="background:white;color:black;font:24px sans-serif"><body><h1>Preferences</h1><p>Choose an action</p><button style="position:absolute;top:180px;left:30px;width:270px;height:100px;font:32px sans-serif">Continue</button><button style="position:absolute;top:205px;left:60px;width:270px;height:100px;font:32px sans-serif">Cancel</button></body></html>');
  await page.screenshot({path});
 }finally{await page.close();}
 frames.push({...sample,path,source:undefined});
 for(let i=frames.length-1;i>0;i--){const j=randomInt(i+1);[frames[i],frames[j]]=[frames[j],frames[i]];}
 return {frames,control:path};
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
 for(const c of report.cells){delete c.critic;delete c.visualFailures;}
 delete report.review;
 const plan=reviewPlan(report.cells,config.review),deadline=Date.now()+Math.min(config.reviewTimeoutMs||7200000,7200000);
 const priorPath=join(out,'review-ledger.json');
 let previous;
 if(config.review?.resume&&existsSync(priorPath))previous=JSON.parse(readFileSync(priorPath,'utf8'));
 const owner=join(process.env.HOME,'.claude','AGENTS.md');
 const identity=digest(JSON.stringify({tool:digest(readFileSync(new URL('./review.mjs',import.meta.url))),plan:digest(readFileSync(new URL('./review-plan.mjs',import.meta.url))),owner:evidence([owner]),head:report.head,build:typeof report.build==='object'?{kind:report.build.kind,id:report.build.id}:report.build,servedBuild:report.servedBuild?.id,
  rules:evidence(config.designRules||[]),references:evidence(config.references||[]),chrome:config.prototypeChrome||[],version:3}));
 let halted=false;
 report.gaps=report.gaps.filter(g=>!g.startsWith('critic batch incomplete')&&!g.startsWith('some frames lack')&&!g.startsWith('Opus quota unavailable')&&!g.startsWith('critic calibration missed')&&!g.startsWith('review budget exhausted'));
 const credentialRule=existsSync(owner)?readFileSync(owner,'utf8').split('\n').find(l=>l.startsWith('- When an agent looks for a credential'))||'':'';
 const policy=`Screenshot lane: Opus-only visual critique; independent code critique belongs to the orchestrator under cross-review. Declared prototype chrome is excluded from product judgment: ${JSON.stringify(config.prototypeChrome||[])}. Its hidden/masked regions are not product blank-space defects. A frame with isEntry:true shows the initial screen before any control or break action; judge later frames as the resulting states.
Use rule id overlapping-controls for independent controls whose rendered rectangles overlap, reference-mismatch for differences from an approved screen, unreadable-detail for details too small to resolve, and other for other defects. Multiple rule ids are allowed.
Read ${owner} section 0 and these repo rules: ${(config.designRules||[]).join(', ')}. ${credentialRule}\nDo not edit, run commands, access accounts or services. Judge all no-slop rules: duplicated/overlapping controls, fake device chrome, clipping, images, contrast, hierarchy, template composition, generic filler. Approved references: ${(config.references||[]).join(', ')||'none supplied; do not invent an approved reference'}.`;
 report.gaps=report.gaps.filter(g=>!g.startsWith('mandatory shortest-phone')&&!g.startsWith('mandatory widest-desktop'));report.gaps.push(...plan.gaps);
 report.review={identity,mandatoryFrames:plan.mandatory.flatMap(b=>b.frames.map(f=>f.path)),visualCritic:'Opus-only',codeCritic:'external cross-review required',batches:previous?.identity===identity?previous.batches.map(b=>({...b,retained:true})):[],complete:false};
 const recordBatch=entry=>{const i=report.review.batches.findIndex(b=>b.id===entry.id);if(i<0)report.review.batches.push(entry);else report.review.batches[i]=entry;};
 const checkpoint=()=>writeFileSync(priorPath,JSON.stringify(report.review,null,2));
 async function call(batch,mode){
  const key=batch.id+'-'+mode,signature=digest(identity+JSON.stringify(evidence(batch.frames.map(f=>f.path)))+JSON.stringify(batch.frames.map(({path,cell,screen,state,size,isEntry})=>({path,cell,screen,state,size,isEntry})))+mode+policy);
  const cached=previous?.identity===identity&&previous.batches.find(b=>b.id===key&&b.signature===signature&&['pass','flagged'].includes(b.status)&&b.canary?.status==='caught');
  if(cached){
   try{const judgment=applyBatch(batch,{frames:cached.judgments});if(mode!=='sheets'&&judgment.frames.some(f=>f.status==='inspect'))throw Error('unresolved cached verdict');recordBatch({...cached,reused:true,retained:false});checkpoint();return judgment;}catch{}
  }
  const earlier=previous?.identity===identity&&previous.batches.find(b=>b.id===key);
  if(config.review?.splitTimedOut&&batch.frames.length>7&&(earlier?.split||earlier?.attempts?.some(a=>a.exit===124))){
   const middle=Math.ceil(batch.frames.length/2),entry={id:key,signature,mode,screens:batch.screens,frames:batch.frames.map(f=>f.path),attempts:earlier.attempts||[],status:'incomplete',split:true,children:[],canary:{status:'unrun',via:'children'}};
   recordBatch(entry);checkpoint();const judgments=[];
   for(const [index,frames]of [batch.frames.slice(0,middle),batch.frames.slice(middle)].entries()){
    if(halted)break;
    const child={...batch,id:batch.id+'-part'+(index+1),frames};entry.children.push(child.id+'-'+mode);
    const result=await call(child,mode);if(result)judgments.push(...result.frames);
   }
   if(judgments.length!==batch.frames.length){checkpoint();return null;}
   const result=applyBatch(batch,{frames:judgments});entry.status=result.status;entry.judgments=result.frames;entry.canary.status='caught';checkpoint();return result;
  }
  if(Date.now()>=deadline){halted=true;report.gaps.push('review budget exhausted; resume unfinished batches');checkpoint();return null;}
  const {frames,control}=await reviewInputs(batch,out,key,browser);
  const sheets=mode==='sheets'?await renderSheets({...batch,sheets:Array.from({length:Math.ceil(frames.length/(config.review?.framesPerSheet||8))},(_,i)=>frames.slice(i*(config.review?.framesPerSheet||8),(i+1)*(config.review?.framesPerSheet||8)))},out,browser):[];
  report.sheets||=[];report.sheets.push(...sheets);
  const promptPath=join(out,key+'.prompt.md'),manifest=frames.map(f=>({path:f.path,screen:f.screen,state:f.state,size:f.size,isEntry:f.isEntry}));
  const instruction=mode==='sheets'?`Read ONLY these contact sheets first: ${sheets.join(', ')}. Each caption maps to a frame below. Judge every frame. Use inspect when text/details are too small or any defect is suspected; flagged screens receive full-size follow-up.`:`Read EVERY full-size frame below. Resolve the flagged observations. Give a definite pass or fail for each; do not return inspect.`;
  writeFileSync(promptPath,`${policy}\n${instruction}\nOutput only JSON {"frames":[{"path":"exact manifest path","status":"pass|fail|inspect","rules":["specific rule id, e.g. overlapping-controls"],"failures":["specific observation"]}]}. Exactly one entry per manifest path, no omitted or extra frames.\n${JSON.stringify(manifest)}`);
  const entry={id:key,signature,mode,screens:batch.screens,frames:batch.frames.map(f=>f.path),sheets,attempts:[],status:'incomplete',canary:{status:'unrun',expectedRule:'overlapping-controls'}};recordBatch(entry);checkpoint();
  for(let attempt=0;attempt<(config.review?.attempts||2);attempt++){
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
    const all=applyBatch({frames},parseOutput(result.stdout)),check=all.frames.find(f=>f.path===control);
    if(!['fail','inspect'].includes(check.status)||!check.rules?.includes(entry.canary.expectedRule)){
     halted=true;entry.canary.status='missed';record.reason='generated overlapping controls were not detected';report.gaps.push('critic calibration missed; no visual verdict');checkpoint();return null;
    }
    entry.canary.status='caught';
    const judgment=applyBatch(batch,{frames:all.frames.filter(f=>f.path!==control).map(f=>({...f,path:frames.find(x=>x.path===f.path).source}))});
    if(mode!=='sheets'&&judgment.frames.some(f=>f.status==='inspect'))throw Error('full-size review did not resolve verdict');
    entry.status=judgment.status;entry.judgments=judgment.frames;checkpoint();return judgment;
   }catch(error){record.reason=redact(error.message);checkpoint();}
  }
  report.gaps.push('critic batch incomplete after '+entry.attempts.length+' attempt(s): '+key);return null;
 }
 const resolved=new Map(),flagged=new Set(),mandatoryPaths=new Set(plan.mandatory.flatMap(b=>b.frames.map(f=>f.path)));
 for(const batch of plan.mandatory){
  if(halted)break;
  const judgment=await call({...batch,id:batch.id+'-mandatory'},'full');if(!judgment)continue;
  for(const frame of judgment.frames)resolved.set(frame.path,frame);
  for(const group of judgment.flaggedGroups)flagged.add(group);
 }
 for(const batch of plan.sheets){
  if(halted)break;
  const judgment=await call(batch,'sheets');if(!judgment)continue;
  for(const frame of judgment.frames)resolved.set(frame.path,frame);
  for(const group of judgment.flaggedGroups)flagged.add(group);
 }
 const followCells=report.cells.filter(c=>flagged.has(frameGroup(c))).map(c=>({...c,frames:c.frames.filter(path=>!mandatoryPaths.has(path))}));
 for(const cell of followCells)for(const path of cell.frames)resolved.delete(path);
 for(const batch of reviewBatches(followCells,config.review)){
  if(halted)break;
  const judgment=await call({...batch,id:batch.id+'-follow'},'full');
  if(judgment)for(const frame of judgment.frames)resolved.set(frame.path,frame);
 }
 for(const c of report.cells){
  const judgments=c.frames.map(path=>resolved.get(path));
  if(!judgments.length||judgments.some(j=>!j||j.status==='inspect'))continue;
  if(plan.missingGroups.includes(frameGroup(c))&&!judgments.some(j=>j.status==='fail'||j.failures.length||j.rules?.length))continue;
  c.critic=judgments.some(j=>j.status==='fail'||j.failures.length||j.rules?.length)?'fail':'pass';c.visualFailures=judgments.flatMap(j=>j.failures.length?j.failures:(j.rules||[]).map(rule=>'critic rule: '+rule)).map(redact);
 }
 report.review.complete=!plan.gaps.length&&report.cells.length>0&&report.cells.every(c=>c.frames.length&&['pass','fail'].includes(c.critic));checkpoint();
 if(!report.review.complete)report.gaps.push('some frames lack a completed visual verdict');
}
