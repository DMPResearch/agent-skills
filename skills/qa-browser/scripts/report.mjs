import {join} from 'node:path';
import {writeFileSync,existsSync} from 'node:fs';
import {runReview} from './review.mjs';
export {command} from './process.mjs';
import {redact,verdict} from './contract.mjs';


export async function critique(report,config,out,cwd,browser){
 const cells=report.cells.filter(c=>c.frames.length);
 if(cells.some(c=>c.frames.some(p=>!existsSync(p)))){report.gaps.push('missing frame file; critic cannot approve');return;}
 if(!cells.length){report.gaps.push('no readable frames for critic');return;}
 if(!config.designRules?.length){report.gaps.push('missing design rules');return;}
 if(!browser){report.gaps.push('review browser unavailable');return;}
 if(!config.references?.length)report.gaps.push('approved visual references missing; diagnostic review cannot approve a product');
 await runReview(report,config,out,cwd,browser);
}

export function save(report,out){
 report.status=report.runFailures?.length?'fail':verdict(report.cells,report.gaps);
 report.issues=report.cells.flatMap(c=>[...c.failures,...(c.visualFailures||[])].map(failure=>({rule:/image/.test(failure)?'TEST-016':/console|HTTP|request|page error/.test(failure)?'proposed:repo-browser-runtime':'TEST-007',severity:'major',screen:c.screen,browser:c.engine,browserVersion:c.browserVersion||'unknown',size:c.size,theme:c.theme,state:c.state,repro:c.repro,expected:'Real flow outcome and readable, unobstructed rendered UI',actual:failure,frames:c.frames})));
 const byScreen=Object.groupBy(report.cells,c=>c.screen);
 report.screens=Object.entries(byScreen).map(([screen,cells])=>({screen,status:verdict(cells,[]),functional:cells.every(c=>(c.functional||(!c.failures.length&&c.complete?'pass':'fail'))==='pass')?'pass':'fail',slop:cells.some(c=>c.critic==='fail')?'fail':cells.every(c=>c.critic==='pass')?'pass':'incomplete',cells:cells.length,frames:cells.flatMap(c=>c.frames)}));
 writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2));
 const lines=['# Browser QA',`Status: ${report.status}`,`Head: ${report.head||'unrecorded'}; build: ${report.build||'unverified'}`,...report.gaps.map(g=>'Incomplete: '+redact(g)),...(report.runFailures||[]).map(f=>'Failure: '+redact(f))];
 for(const s of report.screens){lines.push(`\n## ${s.screen}: ${s.status}`,`Functional: ${s.functional}; no-slop: ${s.slop}`);for(const c of byScreen[s.screen]){
  lines.push(`\n${c.id}: ${verdict([c],[])}; critic ${c.critic||'unrun'}`,...c.repro.map((s,i)=>`${i+1}. ${redact(s)}`),...c.failures.map(f=>'- '+redact(f)),...(c.visualFailures||[]).map(f=>'- Visual: '+f),...c.frames.map(f=>'Frame: '+f),...c.gaps.map(g=>'Incomplete: '+redact(g)));
 }}
 writeFileSync(join(out,'report.md'),lines.join('\n')+'\n');
 return report.status==='pass'?0:report.status==='fail'?1:2;
}
