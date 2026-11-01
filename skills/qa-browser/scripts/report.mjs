import {writeFileSync,readFileSync,existsSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {join} from 'node:path';
import {redact,verdict} from './contract.mjs';

export function command(file,args,{cwd,timeout=300000,env=process.env}={}){
 return new Promise(resolve=>{
  let stdout='',stderr='',timedOut=false;
  const child=spawn(file,args,{cwd,env,stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',d=>{stdout+=d;if(stdout.length>4000000)child.kill('SIGKILL');});
  child.stderr.on('data',d=>{stderr+=d;if(stderr.length>4000000)child.kill('SIGKILL');});
  const timer=setTimeout(()=>{timedOut=true;child.kill('SIGTERM');setTimeout(()=>child.kill('SIGKILL'),1000).unref();},timeout);
  child.on('error',()=>{clearTimeout(timer);resolve({code:2,stdout:'',stderr:'command unavailable'});});
  child.on('close',code=>{clearTimeout(timer);resolve({code:timedOut?124:code,stdout,stderr});});
 });
}

export async function contactSheet(cells,out,browser){
 const frames=cells.flatMap(c=>c.frames.map(path=>({id:c.id,path}))).filter(f=>existsSync(f.path));
 const sheets=[];
 const page=await browser.newPage({viewport:{width:1400,height:1000}});
 try{for(let i=0;i<frames.length;i+=24){
  const batch=frames.slice(i,i+24);
  await page.setContent('<html><body style="margin:0;background:white;color:black;font:14px sans-serif;display:grid;grid-template-columns:repeat(4,1fr)">'+batch.map(f=>`<figure style="margin:8px;overflow:hidden"><figcaption>${f.id.replace(/[<>&]/g,'')}</figcaption><img style="width:100%;height:320px;object-fit:contain;object-position:top" src="data:image/png;base64,${readFileSync(f.path).toString('base64')}"></figure>`).join('')+'</body></html>');
  await page.locator('img').evaluateAll(els=>Promise.all(els.map(e=>e.decode())));
  const path=join(out,`sheet-${sheets.length+1}.png`);await page.screenshot({path,fullPage:true});sheets.push(path);
 }}finally{await page.close();}
 return sheets;
}

export async function critique(report,config,out,cwd){
 const cells=report.cells.filter(c=>c.frames.length);
 if(cells.some(c=>c.frames.some(p=>!existsSync(p)))){report.gaps.push('missing frame file; critic cannot approve');return;}
 if(!cells.length){report.gaps.push('no readable frames for critic');return;}
 if(!config.designRules?.length||!config.references?.length){report.gaps.push('missing design rules or approved references');return;}
 const promptPath=join(out,'critic-prompt.md');
 const prompt=`Read ~/.claude/AGENTS.md section 0, and these design rules: ${config.designRules.join(', ')}. Read these approved visual references: ${config.references.join(', ')}. Inspect EVERY frame at its intended viewport size, not only contact sheets. Do not edit files, run commands, touch credentials or services. Judge duplicate/overlapping content, device chrome, contrast, clipping, image distortion, theme leaks, hierarchy and all no-AI-slop rules. List concrete defects with steps and frame paths. Output only JSON {"frames":[{"path":"absolute PNG path","status":"pass|fail","failures":["specific defect"]}]}. Include exactly one entry per supplied frame. Missing or unreadable images must fail. Manifest:\n${JSON.stringify(cells.map(c=>({id:c.id,size:c.size,theme:c.theme,frames:c.frames,repro:c.repro})))}`;
 writeFileSync(promptPath,prompt);
 // Prompt is a path to avoid ARG_MAX on large crawls; stdin is explicitly closed.
 const result=await command('claude',['-p','--model','opus','--permission-mode','plan','--allowedTools','Read','--',`Read ${promptPath} and perform that screenshot review. Return only the requested JSON.`],{cwd,timeout:config.criticTimeoutMs||300000,env:{...process.env,CLAUDE_CONFIG_DIR:join(process.env.HOME,'.claude-b')}});
 writeFileSync(join(out,'critic-output.txt'),redact(result.stdout));
 if(result.code!==0){report.gaps.push('Opus critic unavailable or timed out');return;}
 applyCritique(report,result.stdout);
}

export function applyCritique(report,raw){
 let parsed;
 try{parsed=JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g,''));}
 catch{report.gaps.push('invalid Opus critic output');return;}
 if(!Array.isArray(parsed.frames)){report.gaps.push('missing per-frame critique');return;}
 for(const c of report.cells.filter(c=>c.frames.length)){
  const judgments=c.frames.map(path=>parsed.frames.filter(f=>f.path===path));
  const valid=judgments.every(j=>j.length===1&&['pass','fail'].includes(j[0].status)&&Array.isArray(j[0].failures)&&j[0].failures.every(f=>typeof f==='string'));
  if(!valid){report.gaps.push('missing or invalid per-frame critique: '+c.id);continue;}
  c.critic=judgments.some(j=>j[0].status==='fail'||j[0].failures.length)?'fail':'pass';
  c.visualFailures=judgments.flatMap(j=>j[0].failures).map(redact);
 }

}

export function save(report,out){
 report.status=verdict(report.cells,report.gaps);
 report.issues=report.cells.flatMap(c=>[...c.failures,...(c.visualFailures||[])].map(failure=>({rule:/image/.test(failure)?'TEST-016':/console|HTTP|request|page error/.test(failure)?'proposed:repo-browser-runtime':'TEST-007',severity:'major',screen:c.screen,browser:c.engine,size:c.size,theme:c.theme,state:c.state,repro:c.repro,expected:'Real flow outcome and readable, unobstructed rendered UI',actual:failure,frames:c.frames})));
 const byScreen=Object.groupBy(report.cells,c=>c.screen);
 report.screens=Object.entries(byScreen).map(([screen,cells])=>({screen,status:verdict(cells,[]),cells:cells.length,frames:cells.flatMap(c=>c.frames)}));
 writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2));
 const lines=['# Browser QA',`Status: ${report.status}`,`Head: ${report.head||'unrecorded'}; build: ${report.build||'unverified'}`,...report.gaps.map(g=>'Incomplete: '+redact(g))];
 for(const s of report.screens){lines.push(`\n## ${s.screen}: ${s.status}`);for(const c of byScreen[s.screen]){
  lines.push(`\n${c.id}: ${verdict([c],[])}; critic ${c.critic||'unrun'}`,...c.repro.map((s,i)=>`${i+1}. ${redact(s)}`),...c.failures.map(f=>'- '+redact(f)),...(c.visualFailures||[]).map(f=>'- Visual: '+f),...c.frames.map(f=>'Frame: '+f),...c.gaps.map(g=>'Incomplete: '+redact(g)));
 }}
 writeFileSync(join(out,'report.md'),lines.join('\n')+'\n');
 return report.status==='pass'?0:report.status==='fail'?1:2;
}
