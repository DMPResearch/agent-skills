import {importCrawl} from './external.mjs';
import {observeRuntime,verifyIdentity} from './runtime.mjs';
import {observeErrors} from './errors.mjs';
import {redact} from './contract.mjs';

export async function captureStanding(tasks,env){
 const {config,report,adapter,browsers,out,pace,terminals}=env;report.standingEntry=[];
 const claimedPaths=new Set(report.cells.flatMap(c=>c.frames));
 const groups=Object.groupBy(tasks,t=>JSON.stringify([t.engine,t.flow.id,t.state.id]));
 for(const group of Object.values(groups)){
  const {flow,state,engine}=group[0],record={screen:flow.id,state:state.id,engine,status:'incomplete',cells:0};report.standingEntry.push(record);
  let context,timer,cellTimer,observer,errors;
  const runtime={screen:flow.id,state:state.id,engine,size:'standing-entry',failures:[],gaps:[],diagnostics:[],observations:[]};
  try{
   if(!adapter?.captureStanding)throw Error('capture:standing requires adapter.captureStanding; no entry is replayed');
   if(env.stopping?.()||env.remaining?.()<=0)throw Error('capture budget exhausted before standing entry');
   if(report.blockedAuthEngines?.includes(engine)&&state.id==='signed-in')throw Error('shared authentication unavailable');
   if(!env.launches.has(engine))env.launches.set(engine,env.browserModule[engine].launch().then(b=>{browsers.set(engine,b);return b;}));
   const browser=await env.launches.get(engine);context=await browser.newContext({storageState:state.id==='signed-in'?env.sessions.get(engine):undefined});context.setDefaultTimeout(10000);
   const closed=new AbortController();context.once('close',()=>closed.abort());const runPace=key=>pace(key,{signal:closed.signal});
   errors=await observeErrors(context,runtime);errors.phase('standing-entry');observer=observeRuntime(context,runtime,{...config,observations:flow.observations});env.buildObserver?.attach(context);
   let rejectCell;const cellDeadline=new Promise((_,reject)=>{rejectCell=reject;});const cellLimit=Math.max(1,Math.min(config.cellTimeoutMs||60000,60000));
   const arm=label=>{clearTimeout(cellTimer);cellTimer=setTimeout(()=>{const message='standing '+label+' exceeded '+cellLimit+' ms cell cap';runtime.gaps.push(message);context.close().catch(()=>{});rejectCell(Error(message));},cellLimit);};
   const wanted=new Set(group.map(t=>t.theme+'/'+t.size)),begun=new Set();
   const beginCell=async({theme,size})=>{
    closed.signal.throwIfAborted();const key=theme+'/'+size;if(!wanted.has(key)||begun.has(key))throw Error('unexpected or duplicate standing cell: '+key);
    arm('cell '+key);runtime.size=size;runtime.theme=theme;errors.phase('standing-cell '+theme+' '+size);if(!await observer.settle())throw Error('standing cell has unresolved requests before next cell');
    if(state.id==='signed-in')await verifyIdentity(adapter,{context,config,flow,state:state.id,engine},env.identities);
    begun.add(key);
   };
   arm('entry');
   const data=await Promise.race([cellDeadline,
    (async()=>{await adapter.authenticate?.({context,config,flow,state:state.id,pace:runPace});return adapter.captureStanding({context,config,flow,state,engine,out,pace:runPace,beginCell,matrix:group.map(({theme,size})=>({engine,theme,size}))});})(),
    new Promise((_,reject)=>{timer=setTimeout(()=>{context.close().catch(()=>{});reject(Error('standing capture budget exhausted'));},Math.max(1,Math.min(env.remaining?.()||1800000,group.length*60000)));})
   ]);
   await observer.settle();await errors.finish();clearTimeout(cellTimer);
   if(begun.size!==wanted.size)throw Error('standing provider omitted beginCell coverage: '+[...wanted].filter(k=>!begun.has(k)).join(', '));
   for(const row of data.results||[])if(row.state!==state.id)throw Error('standing result state does not match declared state');
   const terminalControls=flow.controls.filter(c=>c.terminal),terminalBreaks=flow.breaks.filter(b=>b.terminal&&(!b.state||b.state===state.id));
   const imported=importCrawl(data,{expected:group.map(t=>({...t,screen:flow.id,state:state.id})),deferred:{controls:terminalControls,breaks:terminalBreaks}});
   for(const cell of imported.cells){
    for(const path of cell.frames){if(claimedPaths.has(path))throw Error('duplicate standing frame path: '+path);claimedPaths.add(path);}
    cell.gaps=cell.gaps.filter(g=>g!=='terminal evidence deferred; standing terminal phase required');cell.complete=cell.gaps.length===0;
    cell.failures.push(...runtime.failures);cell.gaps.push(...runtime.gaps,...imported.gaps);cell.diagnostics=runtime.diagnostics;cell.observations=runtime.observations;cell.complete&&=runtime.gaps.length===0;
    for(const [kind,recipes]of [['control',terminalControls],['break',terminalBreaks]])for(const recipe of recipes){
     const evidence=kind==='control'?cell.controls.some(c=>c.deferred&&c.selector===recipe.selector):data.edges.find(e=>e.screen===cell.screen&&e.engine===engine&&e.theme===cell.theme&&(e.size||e.width+'x'+e.height)===cell.size)?.checks?.some(c=>c.deferred&&c.kind===recipe.kind&&c.target===recipe.target);
     if(!evidence){cell.gaps.push('standing terminal lacks deferred evidence: '+(recipe.selector||recipe.target));cell.complete=false;continue;}
     const id=terminals.defer({...group[0],theme:cell.theme,size:cell.size},cell,recipe,kind);cell.controls.push({selector:recipe.selector,break:recipe.kind,index:kind==='break'?flow.breaks.indexOf(recipe):undefined,terminal:id,status:'deferred'});
    }
    cell.complete=cell.gaps.length===0;cell.functional=cell.failures.length?'fail':cell.complete?'pass':'incomplete';
   }
   report.cells.push(...imported.cells);report.gaps.push(...imported.gaps);report.runFailures||=[];report.runFailures.push(...imported.runFailures);report.runtimeDiagnostics||=[];report.runtimeDiagnostics.push(...imported.runtimeDiagnostics);record.cells=imported.cells.length;record.status=imported.cells.some(c=>c.failures.length)?'fail':imported.gaps.length||imported.cells.some(c=>c.gaps.some(g=>!g.startsWith('terminal check pending: ')))?'incomplete':'pass';
   if(data.summary?.provenance)record.provenance=data.summary.provenance;
  }catch(error){errors?.caught(error);record.error=redact(error.message);report.gaps.push('standing entry unavailable: '+flow.id+' '+engine+'; '+record.error);}
  finally{clearTimeout(timer);clearTimeout(cellTimer);record.diagnostics=runtime.diagnostics;record.observations=runtime.observations;if(!record.cells&&runtime.failures.length){report.runFailures||=[];report.runFailures.push(...runtime.failures);}if(context)await context.close().catch(()=>{});}
 }
}
