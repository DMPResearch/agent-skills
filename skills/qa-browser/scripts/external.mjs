import {readFileSync,existsSync} from 'node:fs';
import {redact} from './contract.mjs';

const key=r=>[r.screen,r.engine,r.theme,r.size||`${r.width}x${r.height}`].join('/');
export function importCrawl(data,{expected,checkFiles=true}){
 const rows=new Map(),paths=new Set();
 for(const r of data.results||[]){
  if(rows.has(key(r))||paths.has(r.path))throw Error('duplicate capture key or frame path: '+key(r));
  rows.set(key(r),r);paths.add(r.path);
 }
 const wanted=new Set(expected.map(key));
 const unexpected=[...rows.keys()].filter(k=>!wanted.has(k));
 if(unexpected.length)throw Error('unexpected capture cells outside declared scope: '+unexpected.join(', '));
 const missing=expected.filter(e=>!rows.has(key(e)));
 if(missing.length)throw Error('missing capture cells: '+missing.map(key).join(', '));
 const screens=new Set(expected.map(e=>e.screen));
 const runtime=[...(data.summary?.firstPartyErrors||[]),...(data.summary?.unattributedErrors||[])].map(error=>{
  let screen=null;
  if(error.screen)screen=screens.has(error.screen)?error.screen:null;
  else try{const url=new URL(error.url);const hash=decodeURIComponent(url.hash.slice(1));if(screens.has(hash))screen=hash;else{const matches=[...url.searchParams].map(([k,v])=>k+'='+v).filter(s=>screens.has(s));if(matches.length===1)screen=matches[0];}}catch{}
  return {...error,screen};
 });
 const runFailures=runtime.filter(e=>!e.screen).map(e=>'Unattributed runtime error: '+redact(e.type||'unknown'));
 const cells=expected.map(e=>{
  const r=rows.get(key(e)),failures=(r.failures||[]).map(f=>redact(typeof f==='string'?f:JSON.stringify(f))),gaps=[];
  const id=key(e).replace(/[^a-z0-9.-]/gi,'_');
  if(checkFiles){
   if(!existsSync(r.path))gaps.push('frame file missing');
   else{
    const png=readFileSync(r.path),[w,h]=e.size.split('x').map(Number),dpr=data.summary?.dpr||1;
    if(png.length<24||png.toString('hex',0,8)!=='89504e470d0a1a0a'||png.readUInt32BE(16)!==w*dpr||png.readUInt32BE(20)!==h*dpr)gaps.push('frame dimensions do not match required viewport');
   }
  }
  const edge=(data.edges||[]).find(x=>key(x)===key(e));
  const controls=(data.interactions||[]).filter(x=>x.type!=='navigation-recovery'&&key(x)===key(e));
  const functionalFailures=[];
  for(const check of edge?.checks||[])if(!check.pass)functionalFailures.push('break check failed: '+check.kind);
  if(!edge)functionalFailures.push('no control/flow evidence supplied for this entry');
  else if(edge.controls.length&&!controls.length)functionalFailures.push('no inventoried controls were exercised');
  for(const c of controls){
   if(c.error)functionalFailures.push('control failed: '+redact(c.label||String(c.index)));
   else if(c.changed===false)functionalFailures.push('control has no verified state or navigation effect: '+redact(c.label||String(c.index)));
  }
  if(r.failures?.some(f=>f.type==='crawl-error'))functionalFailures.push('screen traversal did not complete');
  for(const error of runtime){
   if(error.screen===e.screen&&error.engine===e.engine&&error.theme===e.theme&&error.width===Number(e.size.split('x')[0])&&(!error.height||error.height===Number(e.size.split('x')[1])))failures.push('runtime error: '+redact(error.type||'unknown'));
  }
  failures.push(...functionalFailures.map(f=>'functional: '+f));
  const extra=controls.map(c=>r.path.replace(/\.png$/,`-control-${c.index}.png`)).filter(p=>checkFiles&&existsSync(p));
  return {id,screen:e.screen,state:e.state||r.state||'unspecified',engine:e.engine,browserVersion:r.browserVersion||data.summary?.browserVersions?.[e.engine]||'unknown',theme:e.theme,size:e.size,complete:!gaps.length,frames:gaps.length?[]:[r.path,...extra],failures:[...new Set(failures)],gaps,controls,functional:failures.length?'fail':'pass',functionalFailures,repro:[`Open the served entry for ${e.screen}`,`Use ${e.engine}, ${e.theme}, ${e.size}`,...controls.filter(c=>c.error||c.changed===false).map(c=>'Activate '+redact(c.label||String(c.index)))]};
 });
 return {cells,expectedCells:expected.length,runFailures,runtimeDiagnostics:runtime.map(e=>({screen:e.screen,engine:e.engine,theme:e.theme,width:e.width,height:e.height,type:e.type,message:redact(e.message||'')})),gaps:data.summary?.complete?[]:['external crawl did not complete; inspect its fatal/cleanup evidence']};
}
