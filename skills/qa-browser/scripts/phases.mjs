import {recordServiceResponses} from './service-replay.mjs';
import {applicableBreak} from './cell.mjs';
import {planServiceStates,captureServiceStates} from './service-states.mjs';
import {serviceAction,ServiceAttributionGap} from './service-action.mjs';
import {observeBuild,compareServedBuild} from './provenance.mjs';
import {observeServiceTraffic} from './service-traffic.mjs';
import {recordDepartures} from './return-path.mjs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {finding} from './findings.mjs';
import {steps,inspectFindings} from './browser.mjs';
import {trackNavigations} from './navigation.mjs';
import {observeRuntime,verifyIdentity} from './runtime.mjs';
import {observeErrors} from './errors.mjs';
import {redact} from './contract.mjs';

export function servicePacer(intervals={}){
 const queues=new Map();
 for(const [key,value]of Object.entries(intervals))if(!Number.isInteger(value)||value<1)throw Error('serviceIntervals.'+key+' must be a positive interval in milliseconds');
 return (key,{signal}={})=>new Promise((resolve,reject)=>{
  if(!Object.hasOwn(intervals,key)){reject(Error('serviceIntervals.'+key+' is required for paced service steps'));return;}
  if(signal?.aborted){reject(signal.reason||new DOMException('Aborted','AbortError'));return;}
  const queue=queues.get(key)||{waiting:[],last:0};queues.set(key,queue);
  const drain=()=>{
   clearTimeout(queue.timer);
   if(!queue.waiting.length)return;
   const wait=queue.last+intervals[key]-Date.now();
   if(wait>0){queue.timer=setTimeout(drain,wait);return;}
   const next=queue.waiting.shift();next.signal?.removeEventListener('abort',next.abort);queue.last=Date.now();next.resolve(queue.last);drain();
  };
  const item={resolve,signal,abort:()=>{const index=queue.waiting.indexOf(item);if(index<0)return;queue.waiting.splice(index,1);reject(signal.reason||new DOMException('Aborted','AbortError'));drain();}};
  queue.waiting.push(item);signal?.addEventListener('abort',item.abort,{once:true});drain();
 });
}

export async function prepareEngines(tasks,env){
 const {adapter,config,report,browserModule,browsers,launches}=env,sessions=new Map();
 if(!adapter?.prepareEngine)return sessions;
 report.sharedEntry=[];
 for(const engine of new Set(tasks.filter(t=>t.state.id==='signed-in').map(t=>t.engine))){
  let context,timer,errors;
  const runtime={screen:'shared-entry',state:'signed-in',engine,size:'shared-entry',failures:[],gaps:[],diagnostics:[]};
  const record={engine,status:'incomplete',scope:'engine'};report.sharedEntry.push(record);
  try{
   if(!launches.has(engine))launches.set(engine,browserModule[engine].launch().then(b=>{browsers.set(engine,b);return b;}));
   const browser=await launches.get(engine);if(config.servicePhase)await env.pace(config.servicePhase.cellLimiter,{signal:env.signal});context=await browser.newContext();context.setDefaultTimeout(10000);
   record.serviceTraffic=observeServiceTraffic(context,report,{baseURL:config.baseURL,phase:'shared-entry',engine,state:'signed-in',onLimit:config.servicePhase?env.onServiceLimit:undefined});
   errors=await observeErrors(context,runtime,runtime.failures,config);errors.phase('shared-entry');
   const closed=new AbortController();context.once('close',()=>closed.abort());const entryPace=key=>env.pace(key,{signal:closed.signal});
   await Promise.race([
    adapter.prepareEngine({context,engine,config,pace:entryPace}),
    new Promise((_,reject)=>{timer=setTimeout(()=>{context.close().catch(()=>{});reject(Error('shared entry exceeded 60 second cap'));},60000);})
   ]);
   await verifyIdentity(adapter,{context,config,engine,state:'signed-in'},env.identities);
   const storage=await context.storageState();
   if(!storage.cookies.length&&!storage.origins.length)throw Error('shared entry produced no reusable browser session');
   sessions.set(engine,storage);record.status='pass';
  }catch(error){errors?.caught(error);record.error=redact(error.message);report.gaps.push('real shared entry unavailable: '+engine+'; '+record.error);report.blockedAuthEngines||=[];report.blockedAuthEngines.push(engine);}
  finally{clearTimeout(timer);await errors?.finish();record.diagnostics=runtime.diagnostics;if(runtime.failures.length){record.status='fail';report.runFailures||=[];report.runFailures.push(...runtime.failures);}if(context)await context.close();}
 }
 return sessions;
}

export function terminalQueue({service=false}={}){
 const prefix=service?'service':'terminal',field=service?'serviceChecks':'terminalChecks';
 const pending=new Map();
 return {
  defer(task,cell,recipe,kind,config){
   if(service){if(!config?.servicePhase)throw Error('servicePhase config is required');task={...task,size:config.servicePhase.size,theme:config.servicePhase.theme};}
   const key=createHash('sha256').update(JSON.stringify([task.engine,task.flow.url,task.state.id,kind,{target:recipe.selector||recipe.target,steps:recipe.steps,safe:recipe.safe,destructive:recipe.destructive,isolated:recipe.isolated},...(service?[task.flow.id,task.state.setup,task.flow.steps]:[])])).digest('hex').slice(0,16);
   let item=pending.get(key);
   if(!item){item={id:key,task,recipe,kind,cells:[]};pending.set(key,item);}
   if(!item.cells.includes(cell))item.cells.push(cell);
   cell.gaps.push(prefix+' check pending: '+key);
   return key;
  },
  async run(env){
   const {report,config,adapter,out,browsers,sessions}=env;report[field]=[];
   const continuations=new Set();
   for(const item of pending.values()){
    if(env.stopping?.())break;
    const {task,recipe,kind,cells,id}=item,{flow,state,engine,theme,size}=task;
    const record={id,scope:service?'product-route-engine-auth-state':'route-engine',route:flow.url,engine,screen:flow.id,kind,target:recipe.selector||recipe.target,cells:cells.map(c=>c.id),status:'incomplete'};report[field].push(record);
    const postState=service?planServiceStates(item,env):undefined;
    let context,timer,entered=false,observer,errors,isolated=false,terminalPace,phaseBuild,responseTape,replaySeed;
    const runtime={screen:flow.id,state:state.id,engine,size,failures:[],gaps:[],diagnostics:[]};
    const sourceBuilds=[];
    const auditBuild=async()=>{if(!phaseBuild)return;record.build=await phaseBuild.finish();record.buildMatches=[];
     for(const [index,cell]of cells.entries()){const expected=sourceBuilds[index],match=compareServedBuild(record.build,expected,config.assetHashes);for(const failure of match.failures)if(!runtime.failures.includes(failure))runtime.failures.push(failure);for(const gap of match.gaps)if(!runtime.gaps.includes(gap))runtime.gaps.push(gap);record.buildMatches.push({cell:cell.id,sourceBuild:expected?.id,phaseBuild:record.build.id,status:match.failures.length?'fail':match.gaps.length?'incomplete':'match'});}
    };

    try{
     const phaseCell=service?cells.find(c=>c.theme===theme&&c.size===size):cells[0];if(!phaseCell)throw Error('service phase size/theme is absent from declared matrix affordance proof');
     if(!recipe.safe||recipe.destructive&&!recipe.isolated)throw Error('terminal control requires declared safe isolated data');
     const [width,height]=size.split('x').map(Number);
     isolated=Boolean(adapter?.prepareTerminal)&&(!service||recipe.terminal||recipe.isolated||recipe.destructive);if(isolated&&!adapter.cleanupTerminal)throw Error('prepareTerminal requires cleanupTerminal for its isolated real session');
     record.isolation=isolated?'adapter-session':'shared-entry';
     if(config.servicePhase)await env.pace(config.servicePhase.cellLimiter,{signal:env.signal});
     context=await browsers.get(engine).newContext({viewport:{width,height},colorScheme:theme,storageState:!isolated&&state.id==='signed-in'?sessions.get(engine):undefined});context.setDefaultTimeout(Math.min(config.actionTimeoutMs||10000,10000));
     if(service){const baseline=await env.buildObserver?.finish();sourceBuilds.push(...cells.map(c=>c.build||baseline));}
     env.buildObserver?.attach(context);if(service){phaseBuild=observeBuild(config.baseURL);phaseBuild.attach(context);}
     record.serviceTraffic=observeServiceTraffic(context,report,{baseURL:config.baseURL,phase:prefix,engine,state:state.id,onLimit:config.servicePhase?env.onServiceLimit:undefined});
     const intentBoundaries=new WeakMap();
     const observationConfig={...config,intentBoundaries,observations:flow.observations??config.observations};
     errors=await observeErrors(context,runtime,runtime.failures,observationConfig);errors.phase('terminal-entry');
     const closed=new AbortController();context.once('close',()=>closed.abort());terminalPace=key=>env.pace(key,{signal:closed.signal});
     timer=setTimeout(()=>context.close().catch(()=>{}),60000);
     if(config.themeInit)await context.addInitScript(config.themeInit.replaceAll('THEME',JSON.stringify(theme)));
     await adapter?.authenticate?.({context,state:state.id,config,flow,pace:terminalPace});
     if(isolated)await adapter.prepareTerminal({context,config,flow,state:state.id,engine,recipe,kind,pace:terminalPace});
     if(state.id==='signed-in')await verifyIdentity(adapter,{context,config,flow,state:state.id,engine},isolated?new Map():env.identities);
     if(service){responseTape=recordServiceResponses(context,config.baseURL);replaySeed={browser:browsers.get(engine),storage:await context.storageState(),flow,state,actions:[]};}
     const page=await context.newPage(),root=flow.frame?page.frameLocator(flow.frame):page,navigation=trackNavigations(page);
     observer=observeRuntime(page,runtime,observationConfig);
     await adapter?.reset?.({page,flow,state:state.id,config,pace:terminalPace});
     await navigation.run(()=>page.goto(new URL(flow.url,config.baseURL).href,{waitUntil:'load'}));
     await adapter?.enter?.({page,flow,state:state.id,pace:terminalPace});
     await steps(page,[...state.setup||[],...flow.steps],root,undefined,navigation.run,terminalPace);
     if(!await observer.settle())throw Error('in-flight entry requests unresolved before terminal action');
     await root.locator(recipe.selector||recipe.target).waitFor({state:'attached'});
     if(service){
      await auditBuild();
      if(runtime.failures.length||runtime.gaps.length)throw Error('service build matching failed');
     }
     if(service)await terminalPace(config.servicePhase.limiter);
     entered=true;errors.phase(prefix+'-action');
     let effects;
     if(service){const activation=await serviceAction(page,root,recipe,{config:observationConfig,mode:'real',baseURL:config.baseURL,runNavigation:navigation.run,pace:terminalPace,onAbort:(p,b)=>intentBoundaries.set(p,b)});record.activation=activation;effects=activation.effects||[];}
     else effects=await steps(page,recipe.steps,root,kind==='break'?recipe.target:undefined,navigation.run,terminalPace);
     for(const cell of cells)recordDepartures(cell,recipe.steps,effects);
     if(effects.some(e=>e.type==='handoff')){record.handoff=effects.find(e=>e.type==='handoff');record.status=runtime.failures.length?'fail':'pass';}
     else{
     if(new URL(page.url()).origin!==new URL(config.baseURL).origin)throw new ServiceAttributionGap('external service navigation requires a declared handoff; provider page not judged');
     const settled=await observer.settle();
     for(const item of await inspectFindings(page))finding(runtime,item.message,{...config,document:item.document,phase:'terminal-inspection'});if(runtime.failures.length)throw Error(runtime.failures.join('; '));
     const captureOptions={config,out,identities:env.identities,terminals:env.terminals,adapter,observer,runtime,errors,pace:terminalPace,onAbort:(p,b)=>intentBoundaries.set(p,b),onReset:p=>intentBoundaries.delete(p),resetDeadline:()=>{clearTimeout(timer);timer=setTimeout(()=>context.close().catch(()=>{}),60000);},remaining:env.remaining};
     captureOptions.continueServices=async(realPage,planned,parentSeed)=>{
      for(const child of [...planned.target.controls,...planned.target.breaks.filter(b=>applicableBreak(b,planned.state))].filter(r=>r.service)){
       const kind=planned.target.controls.includes(child)?'control':'break',childState=planned.result[0].cell.authState;
       const key=createHash('sha256').update(JSON.stringify([engine,planned.target.id,planned.target.url,childState,kind,child])).digest('hex').slice(0,16);
       const dependent=planned.result.filter(r=>!r.plan.recipe).map(r=>r.cell),rows=dependent.flatMap(c=>c.controls.filter(r=>r.selector===(child.selector||child.target)));
       for(const row of rows)row.servicePhase=key;
       if(continuations.has(key)){for(const c of dependent)c.gaps.push('conflicting service continuation needs an isolated real entry: '+key);continue;}continuations.add(key);
       const next={id:key,screen:planned.target.id,route:planned.target.url,engine,kind,target:child.selector||child.target,status:'incomplete',scope:'retained-real-entry',cells:dependent.map(c=>c.id)};report[field].push(next);
       try{
        if(parentSeed?.freshStopped)throw new ServiceAttributionGap('fresh-load layout not proven; service continuation unrun');
        if(!child.safe)throw Error('service continuation safety undeclared');
        if(realPage.isClosed())throw new ServiceAttributionGap('real service continuation entry unavailable');
        const [w,h]=config.servicePhase.size.split('x').map(Number);await realPage.setViewportSize({width:w,height:h});await realPage.emulateMedia({colorScheme:config.servicePhase.theme});
        if(adapter?.applyTheme)await adapter.applyTheme({page:realPage,theme:config.servicePhase.theme,config});else if(config.themeInit)await realPage.evaluate(config.themeInit.replaceAll('THEME',JSON.stringify(config.servicePhase.theme)));
        const root=planned.target.frame?realPage.frameLocator(planned.target.frame):realPage;
        await steps(realPage,planned.target.steps,root);await terminalPace(config.servicePhase.limiter);errors.phase('service-continuation '+key);
        next.activation=await serviceAction(realPage,root,child,{config:{...config,observations:planned.target.observations??config.observations},mode:'real',baseURL:config.baseURL,pace:terminalPace,onAbort:(p,b)=>intentBoundaries.set(p,b)});
        for(const cell of dependent)recordDepartures(cell,child.steps,next.activation.effects||[]);
        if(!await observer.settle())throw new ServiceAttributionGap('service continuation requests unresolved');
        if(next.activation.effects?.some(e=>e.type==='handoff'))next.handoff=next.activation.effects.find(e=>e.type==='handoff');
        else{
         const task={flow:planned.target,state:{id:childState},engine,size:config.servicePhase.size,theme:config.servicePhase.theme};
         const children=planServiceStates({id:key,task,recipe:child,kind,cells:dependent},env);
         const seed={...parentSeed,actions:[...parentSeed.actions,{flow:planned.target,recipe:child,kind}],responses:await responseTape.snapshot(),build:await phaseBuild.finish(),target:children?.target};
         await captureServiceStates(realPage,children,{...captureOptions,seed,report,buildObserver:env.buildObserver});next.postStateCells=children?.result.map(r=>r.cell.id);
         if(children?.result.some(r=>r.cell.failures.length))throw Error('post-service continuation state audit failed');
         if(children?.result.some(r=>r.cell.gaps.length))throw new ServiceAttributionGap('post-service continuation state coverage incomplete');
        }
        next.status='pass';
       }catch(error){next.error=redact(error.message);next.status=error instanceof ServiceAttributionGap?'incomplete':'fail';for(const c of dependent)(next.status==='fail'?c.failures:c.gaps).push('service continuation '+key+': '+next.error);}
       for(const row of rows){row.status=row.intent?.status==='fail'?'fail':row.intent?.status==='incomplete'?'incomplete':next.status==='pass'?'shared':next.status;if(next.status==='pass')row.receipt='service exercised in phase '+key;}
       for(const c of dependent){c.complete=c.gaps.length===0;c.functional=c.failures.length?'fail':c.complete?'pass':'incomplete';}
      }
     };
     if(postState){const seed={...replaySeed,actions:[{flow,recipe,kind}],responses:await responseTape.snapshot(),build:await phaseBuild.finish(),target:postState.target};await captureServiceStates(page,postState,{...captureOptions,seed,report,buildObserver:env.buildObserver});record.postStateCells=postState.result.map(r=>r.cell.id);if(postState.result.some(r=>r.cell.failures.length))runtime.failures.push('post-service state audit failed');if(postState.result.some(r=>r.cell.gaps.length))runtime.gaps.push('post-service state coverage incomplete');}
     else{const path=join(out,'terminal-'+id+'.png');await page.screenshot({path,fullPage:true,mask:config.redactSelectors?.map(s=>root.locator(s))||[]});phaseCell.frames.push(path);record.frame=path;}
     await observer.audit();
     record.status=runtime.failures.length?'fail':settled&&!runtime.gaps.length?'pass':'incomplete';
     }
    }catch(error){errors?.caught(error);record.error=redact(error.message);if(error instanceof ServiceAttributionGap){runtime.gaps.push(error.message);record.status='incomplete';}else if(entered){record.status='fail';for(const cell of cells)cell.failures.push('shared '+prefix+' expected effect failed: '+record.target+'; '+record.error);}else report.gaps.push('shared terminal check unavailable: '+id+'; '+record.error);}
    finally{await auditBuild();if(observer){await observer.settle();await observer.audit();}await errors?.finish();if(isolated&&context)try{await adapter.cleanupTerminal({context,config,flow,state:state.id,engine,recipe,kind,pace:terminalPace});}catch(error){record.status='incomplete';runtime.gaps.push('isolated terminal cleanup failed: '+redact(error.message));}clearTimeout(timer);if(context)await context.close().catch(()=>{});if(runtime.failures.length)record.status='fail';else if(runtime.gaps.length)record.status='incomplete';}
    for(const cell of cells){
     cell.findings||=[];cell.findings.push(...runtime.findings||[]);cell.failures.push(...runtime.failures);cell.gaps.push(...runtime.gaps);cell.diagnostics||=[];cell.diagnostics.push(...runtime.diagnostics);cell.observations||=[];cell.observations.push(...runtime.observations||[]);
     if(['pass','fail'].includes(record.status))cell.gaps=cell.gaps.filter(g=>g!==prefix+' check pending: '+id);
     for(const entry of cell.controls.filter(c=>service?c.servicePhase===id:c.terminal===id)){entry.status=entry.intent?.status==='fail'?'fail':entry.intent?.status==='incomplete'?'incomplete':record.status==='pass'?'shared':record.status;if(service&&record.status==='pass')entry.receipt='service exercised in phase '+id;}
     for(const entry of cell.controls.filter(c=>c.breakIndices))if(cell.controls.some(c=>c.graphState===entry.graphState&&entry.breakIndices.includes(c.index)&&['pass','fail','shared'].includes(c.status)))entry.status='covered-by-break-contract';
     cell.complete=cell.gaps.length===0;cell.functional=cell.failures.length?'fail':cell.complete?'pass':'incomplete';
    }
   }
  }
 };
}
