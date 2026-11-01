import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {command} from './process.mjs';
import {redact} from './contract.mjs';

export function reviewBatches(cells,{screensPerBatch=8,framesPerSheet=8}={}){
 if(!Number.isInteger(screensPerBatch)||screensPerBatch<1||screensPerBatch>8)throw Error('screen group size must be 1..8');
 if(!Number.isInteger(framesPerSheet)||framesPerSheet<1||framesPerSheet>8)throw Error('sheet size must be 1..8');
 const groups=Object.groupBy(cells,c=>c.engine+'/'+c.theme),batches=[];
 for(const [group,items]of Object.entries(groups)){
  const screens=[...new Set(items.map(c=>c.screen))];
  for(let i=0;i<screens.length;i+=screensPerBatch){
   const selected=screens.slice(i,i+screensPerBatch);
   const frames=items.filter(c=>selected.includes(c.screen)).flatMap(c=>c.frames.map(path=>({path,cell:c.id,screen:c.screen,engine:c.engine,theme:c.theme,size:c.size,repro:c.repro||[]})));
   if(!frames.length)continue;
   const sheets=[];for(let n=0;n<frames.length;n+=framesPerSheet)sheets.push(frames.slice(n,n+framesPerSheet));
   batches.push({id:group.replace('/','-')+'-'+(i/screensPerBatch+1),screens:selected,frames,sheets});
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
  const caption=f=>`${f.screen} | ${f.engine} ${f.theme} ${f.size}`.replace(/[<>&]/g,'');
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

export async function runReview(report,config,out,cwd,browser,{invoke=command}={}){
 const batches=reviewBatches(report.cells,config.review),deadline=Date.now()+(config.reviewTimeoutMs||7200000);
 let quotaBlocked=false;
 for(const c of report.cells){delete c.critic;delete c.visualFailures;}
 const owner=join(process.env.HOME,'.claude','AGENTS.md');
 const credentialRule=existsSync(owner)?readFileSync(owner,'utf8').split('\n').find(l=>l.startsWith('- When an agent looks for a credential'))||'':'';
 const policy=`Read ${owner} section 0 and these repo rules: ${(config.designRules||[]).join(', ')}. ${credentialRule}\nDo not edit, run commands, access accounts or services. Judge all no-slop rules: duplicated/overlapping controls, fake device chrome, clipping, images, contrast, hierarchy, template composition, generic filler. Approved references: ${(config.references||[]).join(', ')||'none supplied; do not invent an approved reference'}.`;
 report.review={batches:[],complete:false};
 const checkpoint=()=>writeFileSync(join(out,'review-ledger.json'),JSON.stringify(report.review,null,2));
 async function call(batch,mode,sheets=[]){
  const key=batch.id+'-'+mode,promptPath=join(out,key+'.prompt.md');
  const manifest=batch.frames.map(f=>({path:f.path,screen:f.screen,size:f.size}));
  const instruction=mode==='sheets'?`Read ONLY these contact sheets first: ${sheets.join(', ')}. Each caption maps to a frame below. Judge every frame. Use inspect when text/details are too small or any defect is suspected; flagged frames receive full-size follow-up.`:`Read EVERY full-size frame below. Resolve the flagged observations. Give a definite pass or fail for each; do not return inspect.`;
  writeFileSync(promptPath,`${policy}\n${instruction}\nOutput only JSON {"frames":[{"path":"exact manifest path","status":"pass|fail|inspect","failures":["specific observation"]}]}. Exactly one entry per manifest path, no omitted or extra frames.\n${JSON.stringify(manifest)}`);
  const entry={id:key,mode,screens:batch.screens,frames:batch.frames.map(f=>f.path),sheets,attempts:[],status:'incomplete'};report.review.batches.push(entry);checkpoint();
  for(let attempt=0;attempt<2;attempt++){
   if(Date.now()>=deadline)break;
   const result=await invoke('claude',['-p','--model','opus','--permission-mode','dontAsk','--tools','Read','--allowedTools','Read','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--no-session-persistence','--output-format','json','--',`Read ${promptPath} and return the required JSON after reviewing its images.`],{cwd,timeout:Math.min(config.criticTimeoutMs||600000,deadline-Date.now()),env:{...process.env,CLAUDE_CONFIG_DIR:join(process.env.HOME,'.claude-b')}});
   writeFileSync(join(out,`${key}-attempt${attempt+1}.txt`),redact(result.stdout));
   writeFileSync(join(out,`${key}-attempt${attempt+1}.stderr.txt`),redact(result.stderr||''));
   const record={attempt:attempt+1,exit:result.code};entry.attempts.push(record);
   let envelope;try{envelope=JSON.parse(result.stdout);}catch{}
   const quotaText=(result.stderr||'')+(result.code!==0||envelope?.is_error?result.stdout:'');
   if(/rate.limit|rate_limit|usage limit|hit your limit|out of.{0,20}usage/i.test(quotaText)){
    quotaBlocked=true;record.reason='Reviewer quota unavailable; no retry before reset';entry.status='blocked';report.gaps.push('Opus quota unavailable; review stopped without fallback');checkpoint();return null;
   }
   try{
    if(result.code!==0)throw Error('critic process failed or timed out');
    const judgment=applyBatch(batch,parseOutput(result.stdout));
    if(mode!=='sheets'&&judgment.frames.some(f=>f.status==='inspect'))throw Error('full-size review did not resolve verdict');
    entry.status=judgment.status;entry.judgments=judgment.frames;checkpoint();return judgment;
   }catch(error){record.reason=redact(error.message);checkpoint();}
  }
  report.gaps.push('critic batch incomplete after one retry: '+key);return null;
 }
 for(const batch of batches){
  if(quotaBlocked)break;
  const sheets=await renderSheets(batch,out,browser);report.sheets||=[];report.sheets.push(...sheets);
  const initial=await call(batch,'sheets',sheets);if(!initial)continue;
  const resolved=new Map(initial.frames.filter(f=>f.status==='pass'&&!f.failures.length).map(f=>[f.path,f]));
  const flagged=batch.frames.filter(f=>initial.flaggedScreens.includes(f.screen));
  // A flag on a screen rechecks all its frames in this engine/theme, including initially passing neighbors.
  for(let i=0;i<flagged.length;i+=8){
   if(quotaBlocked)break;
   const frames=flagged.slice(i,i+8),follow={...batch,id:batch.id+'-follow'+(i/8+1),frames,screens:[...new Set(frames.map(f=>f.screen))]};
   const verdict=await call(follow,'full');
   for(const f of frames)resolved.delete(f.path);
   if(verdict)for(const f of verdict.frames)resolved.set(f.path,f);
  }
  for(const c of report.cells.filter(c=>batch.frames.some(f=>f.cell===c.id))){
   const judgments=c.frames.map(path=>resolved.get(path));
   if(judgments.some(j=>!j)){c.critic=undefined;continue;}
   c.critic=judgments.some(j=>j.status==='fail'||j.failures.length)?'fail':'pass';
   c.visualFailures=judgments.flatMap(j=>j.failures).map(redact);
  }
  checkpoint();
 }
 report.review.complete=report.cells.every(c=>c.frames.length&&['pass','fail'].includes(c.critic));checkpoint();
 if(!report.review.complete)report.gaps.push('some frames lack a completed visual verdict');
}
