import {matrixContext} from './service-boundary.mjs';
import {serviceAction,prepareServiceAction,ServiceAttributionGap} from './service-action.mjs';
import {observeBuild} from './provenance.mjs';
import {observeServiceTraffic} from './service-traffic.mjs';
import {serviceAffordance} from './service.mjs';
import {declareReturnPaths} from './return-path.mjs';
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
  let context,timer,cellTimer,observer,errors,standingBuild;
  const runtime={screen:flow.id,state:state.id,engine,size:'standing-entry',failures:[],gaps:[],diagnostics:[],observations:[]};
  try{
   if(!adapter?.captureStanding)throw Error('capture:standing requires adapter.captureStanding; no entry is replayed');
   if(env.stopping?.()||env.remaining?.()<=0)throw Error('capture budget exhausted before standing entry');
   if(report.blockedAuthEngines?.includes(engine)&&state.id==='signed-in')throw Error('shared authentication unavailable');
   if(!env.launches.has(engine))env.launches.set(engine,env.browserModule[engine].launch().then(b=>{browsers.set(engine,b);return b;}));
   const browser=await env.launches.get(engine);context=await matrixContext(browser,{storageState:state.id==='signed-in'?env.sessions.get(engine):undefined},{config,cell:runtime});context.setDefaultTimeout(10000);
   record.serviceTraffic=observeServiceTraffic(context,report,{baseURL:config.baseURL,phase:'standing',engine,state:state.id,onLimit:config.servicePhase?env.onServiceLimit:undefined});
   const closed=new AbortController();context.once('close',()=>closed.abort());const runPace=key=>pace(key,{signal:closed.signal});
   const intentBoundaries=new WeakMap();const observationConfig={...config,intentBoundaries,observations:flow.observations??config.observations};
   errors=await observeErrors(context,runtime,runtime.failures,observationConfig);errors.phase('standing-entry');observer=observeRuntime(context,runtime,observationConfig);env.buildObserver?.attach(context);standingBuild=observeBuild(config.baseURL);standingBuild.attach(context);
   let rejectCell;const cellDeadline=new Promise((_,reject)=>{rejectCell=reject;});const cellLimit=Math.max(1,Math.min(config.cellTimeoutMs||60000,60000));
   const arm=label=>{clearTimeout(cellTimer);cellTimer=setTimeout(()=>{const message='standing '+label+' exceeded '+cellLimit+' ms cell cap';runtime.gaps.push(message);context.close().catch(()=>{});rejectCell(Error(message));},cellLimit);};
   const cellTraffic=new Map();let trafficCell,trafficStart;
   const closeTraffic=()=>{if(trafficCell)cellTraffic.set(trafficCell,{total:record.serviceTraffic.total-trafficStart.total,origins:Object.fromEntries(Object.entries(record.serviceTraffic.origins).map(([origin,count])=>[origin,count-(trafficStart.origins[origin]||0)]))});};
   const cellPages=new Map(),usedPages=new WeakSet();
   const serviceProofs=new Map();
   const providerFlow={...flow,controls:flow.controls.map(r=>r.service?{...r,terminal:true}:r),breaks:flow.breaks.map(r=>r.service?{...r,terminal:true}:r)};
   const checkService=async({page,recipe,kind,theme,size})=>{
    const key=theme+'/'+size;if(!begun.has(key)||config.servicePhase&&cellPages.get(key)!==page||!(kind==='control'?flow.controls:flow.breaks).includes(recipe))throw Error('service affordance must bind a declared recipe in a begun standing cell');
    const root=flow.frame?page.frameLocator(flow.frame):page;const prepared=await prepareServiceAction(page,root,recipe,{config:observationConfig,baseURL:config.baseURL,pace:runPace,onAbort:(p,b)=>intentBoundaries.set(p,b)});const proof=await serviceAffordance(page,root,recipe);let intent;try{intent=await serviceAction(page,root,prepared,{config:observationConfig,baseURL:config.baseURL,pace:runPace,onAbort:(p,b)=>intentBoundaries.set(p,b)});}catch(error){intent={status:error instanceof ServiceAttributionGap?'incomplete':'fail',reason:error.message};}const list=serviceProofs.get(key)||[];list.push({recipe,kind,proof,intent});serviceProofs.set(key,list);return proof;
   };
   const wanted=new Set(group.map(t=>t.theme+'/'+t.size)),begun=new Set();
   const beginCell=async({theme,size,page})=>{
    closed.signal.throwIfAborted();const key=theme+'/'+size;if(!wanted.has(key)||begun.has(key))throw Error('unexpected or duplicate standing cell: '+key);
    if(config.servicePhase){if(!page||page.context()!==context||page.url()!=='about:blank'||usedPages.has(page))throw Error('live service standing cell requires a fresh blank page before admission');usedPages.add(page);cellPages.set(key,page);await runPace(config.servicePhase.cellLimiter);if(config.themeInit)await page.addInitScript(config.themeInit.replaceAll('THEME',JSON.stringify(theme)));}
    closeTraffic();trafficCell=key;trafficStart={total:record.serviceTraffic.total,origins:{...record.serviceTraffic.origins}};arm('cell '+key);runtime.size=size;runtime.theme=theme;errors.phase('standing-cell '+theme+' '+size);if(!await observer.settle())throw Error('standing cell has unresolved requests before next cell');
    if(state.id==='signed-in')await verifyIdentity(adapter,{context,config,flow,state:state.id,engine},env.identities);
    begun.add(key);
   };
   arm('entry');
   const data=await Promise.race([cellDeadline,
    (async()=>{await adapter.authenticate?.({context,config,flow,state:state.id,pace:runPace});return adapter.captureStanding({context,config,flow:providerFlow,serviceRecipes:{controls:flow.controls.filter(r=>r.service),breaks:flow.breaks.filter(r=>r.service)},checkService,state,engine,out,pace:runPace,beginCell,matrix:group.map(({theme,size})=>({engine,theme,size}))});})(),
    new Promise((_,reject)=>{timer=setTimeout(()=>{context.close().catch(()=>{});reject(Error('standing capture budget exhausted'));},Math.max(1,Math.min(env.remaining?.()||1800000,group.length*60000)));})
   ]);
   await observer.settle();await observer.audit();await errors.finish();closeTraffic();record.build=await standingBuild.finish();clearTimeout(cellTimer);
   if(begun.size!==wanted.size)throw Error('standing provider omitted beginCell coverage: '+[...wanted].filter(k=>!begun.has(k)).join(', '));
   for(const row of data.results||[])if(row.state!==state.id)throw Error('standing result state does not match declared state');
   const terminalControls=flow.controls.filter(c=>c.terminal||c.service),terminalBreaks=flow.breaks.filter(b=>(b.terminal||b.service)&&(!b.state||b.state===state.id));
   const imported=importCrawl(data,{expected:group.map(t=>({...t,screen:flow.id,state:state.id})),deferred:{controls:terminalControls,breaks:terminalBreaks}});
   for(const cell of imported.cells){
    cell.build=record.build;
    cell.serviceTraffic=cellTraffic.get(cell.theme+'/'+cell.size);
    declareReturnPaths(cell,flow,state);
    for(const path of cell.frames){if(claimedPaths.has(path))throw Error('duplicate standing frame path: '+path);claimedPaths.add(path);}
    cell.gaps=cell.gaps.filter(g=>g!=='terminal evidence deferred; standing terminal phase required');cell.complete=cell.gaps.length===0;
    cell.findings=runtime.findings||[];cell.failures.push(...runtime.failures);cell.gaps.push(...runtime.gaps,...imported.gaps);cell.diagnostics=runtime.diagnostics;cell.observations=runtime.observations;cell.complete&&=runtime.gaps.length===0;
    for(const [kind,recipes]of [['control',terminalControls],['break',terminalBreaks]])for(const recipe of recipes){
     const evidence=kind==='control'?cell.controls.some(c=>c.deferred&&c.selector===recipe.selector):data.edges.find(e=>e.screen===cell.screen&&e.engine===engine&&e.theme===cell.theme&&(e.size||e.width+'x'+e.height)===cell.size)?.checks?.some(c=>c.deferred&&c.kind===recipe.kind&&c.target===recipe.target);
     if(!evidence){cell.gaps.push('standing terminal lacks deferred evidence: '+(recipe.selector||recipe.target));cell.complete=false;continue;}
     const task={...group[0],theme:cell.theme,size:cell.size};
     if(recipe.service){const proof=serviceProofs.get(cell.theme+'/'+cell.size)?.find(p=>p.recipe===recipe&&p.kind===kind);if(!proof||!env.services){cell.gaps.push('standing service affordance unproven: '+(recipe.selector||recipe.target));continue;}if(proof.intent?.status==='fail')cell.failures.push(proof.intent.reason);else if(proof.intent?.status!=='pass')cell.gaps.push(proof.intent?.reason||'standing service intent unproven');const servicePhase=env.services.defer(task,cell,recipe,kind,config);cell.controls.push({selector:recipe.selector,break:recipe.kind,index:kind==='break'?flow.breaks.indexOf(recipe):undefined,servicePhase,affordance:proof.proof,intent:proof.intent,status:'deferred'});}
     else{const id=terminals.defer(task,cell,recipe,kind);cell.controls.push({selector:recipe.selector,break:recipe.kind,index:kind==='break'?flow.breaks.indexOf(recipe):undefined,terminal:id,status:'deferred'});}
    }
    cell.complete=cell.gaps.length===0;cell.functional=cell.failures.length?'fail':cell.complete?'pass':'incomplete';
   }
   report.cells.push(...imported.cells);report.gaps.push(...imported.gaps);report.runFailures||=[];report.runFailures.push(...imported.runFailures);report.runtimeDiagnostics||=[];report.runtimeDiagnostics.push(...imported.runtimeDiagnostics);record.cells=imported.cells.length;record.status=imported.cells.some(c=>c.failures.length)?'fail':imported.gaps.length||imported.cells.some(c=>c.gaps.some(g=>!g.startsWith('terminal check pending: ')))?'incomplete':'pass';
   if(data.summary?.provenance)record.provenance=data.summary.provenance;
  }catch(error){errors?.caught(error);record.error=redact(error.message);report.gaps.push('standing entry unavailable: '+flow.id+' '+engine+'; '+record.error);}
  finally{clearTimeout(timer);clearTimeout(cellTimer);record.diagnostics=runtime.diagnostics;record.observations=runtime.observations;if(!record.cells&&runtime.failures.length){report.runFailures||=[];report.runFailures.push(...runtime.failures);}if(context)await context.close().catch(()=>{});}
 }
}
