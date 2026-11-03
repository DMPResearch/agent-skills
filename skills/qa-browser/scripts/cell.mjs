import {matrixContext} from './service-boundary.mjs';
import {captureState} from './capture-state.mjs';
import {serviceAction,prepareServiceAction,ServiceAttributionGap} from './service-action.mjs';
import {observeBuild} from './provenance.mjs';
import {observeServiceTraffic} from './service-traffic.mjs';
import {serviceAffordance} from './service.mjs';
import {declareReturnPaths,recordDepartures,recordReturnEntry} from './return-path.mjs';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {redact,breakKinds} from './contract.mjs';
import {observeRuntime,verifyIdentity} from './runtime.mjs';
import {observeErrors} from './errors.mjs';
import {trackNavigations} from './navigation.mjs';
import {finding,documentOf} from './findings.mjs';
import {inspectFindings,inventory,steps,withPrototypeChrome,NoEffectIncompleteError} from './browser.mjs';

export async function runCell(t,{config,report,out,browserModule,browsers,launches,adapter,buildObserver,sessions,terminals,services,pace,signal,onServiceLimit,identities=new Map()}){
 const {flow,engine,theme,size,state}=t;
 const id=`${flow.id}-${state.id}-${engine}-${theme}-${size}`.replace(/[^a-z0-9.-]/gi,'_');
 const cell={id,screen:flow.id,state:state.id,engine,theme,size,complete:false,frames:[],failures:[],gaps:[],controls:[],repro:[`Open ${redact(new URL(flow.url,config.baseURL))}`,`Use ${engine}, ${size}, ${theme}, state ${state.id}`]};report.cells.push(cell);declareReturnPaths(cell,flow,state);
 let context,cellTimer,navigation,runtime,errors,cellBuild;const observed=[];
 try{
  if(report.blockedAuthStates?.includes(state.id)||state.id==='signed-in'&&report.blockedAuthEngines?.includes(engine)){cell.gaps.push('authentication unavailable; cell not attempted');return;}
  if(!launches.has(engine))launches.set(engine,browserModule[engine].launch().then(b=>{browsers.set(engine,b);return b;}));
  if(config.servicePhase?.cellLimiter){if(!pace)throw Error('live service cell admission requires pacing');await pace(config.servicePhase.cellLimiter,{signal});}
  const browser=await launches.get(engine);cell.browserVersion=browser.version();
  const [width,height]=size.split('x').map(Number);
  context=await matrixContext(browser,{viewport:{width,height},colorScheme:theme,deviceScaleFactor:1,storageState:state.id==='signed-in'?sessions?.get(engine):undefined},{config,cell});
  cell.serviceTraffic=observeServiceTraffic(context,report,{baseURL:config.baseURL,phase:'matrix',cell:id,engine,state:state.id,onLimit:config.servicePhase?onServiceLimit:undefined});
  const intentBoundaries=new WeakMap();
  const closed=new AbortController();context.once('close',()=>closed.abort());
  if(pace){const runPace=pace;pace=key=>runPace(key,{signal:closed.signal});}
  const observationConfig={...config,intentBoundaries,observations:flow.observations??config.observations};
  errors=await observeErrors(context,cell,observed,observationConfig);
  buildObserver?.attach(context);cellBuild=observeBuild(config.baseURL);cellBuild.attach(context);
  cellTimer=setTimeout(()=>{cell.gaps.push('cell exceeded 60 second cap');context.close().catch(()=>{});},Math.min(config.cellTimeoutMs||60000,60000));
  context.setDefaultTimeout(Math.min(config.actionTimeoutMs||10000,10000));
  errors.phase('theme-init');
  if(config.themeInit)await context.addInitScript(config.themeInit.replaceAll('THEME',JSON.stringify(theme)));
  if(state.id==='signed-in'&&!adapter?.authenticate&&!sessions?.has(engine))cell.gaps.push('signed-in state requires real authentication adapter');
  errors.phase('authentication');
  if(adapter?.authenticate){
   try{await adapter.authenticate({context,state:state.id,config,flow,pace});}
   catch(error){errors.caught(error);report.blockedAuthStates||=[];report.blockedAuthStates.push(state.id);cell.gaps.push('real authentication failed: '+redact(error.message)+'; later cells in this state blocked');return;}
  }
  errors.phase('session-verification');
  if(state.id==='signed-in'){
   try{await verifyIdentity(adapter,{context,config,flow,state:state.id,engine},identities);cell.sessionVerified=true;}
   catch(error){errors.caught(error);cell.gaps.push('signed-in session identity unavailable: '+redact(error.message));return;}
  }
  let page,surface;
  const open=async()=>{page=await context.newPage();surface=flow.frame?page.frameLocator(flow.frame):page;runtime=observeRuntime(page,cell,observationConfig,observed);navigation=trackNavigations(page);};
  await open();
  const act=async(items,target)=>{const effects=await steps(page,items,surface,target,navigation.run,pace);recordDepartures(cell,items,effects);return effects;};
  let entryBinding;
  const reset=async()=>{
   errors.phase('entry');
   if(page.isClosed()){await runtime.audit();await open();}
   if(!await runtime.settle())throw Error('in-flight requests unresolved before replay');
   if(adapter?.reset)await adapter.reset({page,flow,state:state.id,config,pace});
   await navigation.run(()=>page.goto(new URL(flow.url,config.baseURL).href,{waitUntil:'load'}));
   if(adapter?.enter)await adapter.enter({page,flow,state:state.id,pace});
   await act(state.setup||[]);
   await act(flow.steps);
   const binding=JSON.stringify(await withPrototypeChrome(page,config.prototypeChrome,()=>inventory(surface,flow.controls.map(c=>c.selector))));
   if(entryBinding!==undefined&&entryBinding!==binding){cell.gaps.push('entry control inventory changes between resets: dynamic accessible names or control structure');throw Error('entry cannot be replayed consistently');}
   entryBinding=binding;
  };
  const snap=suffix=>captureState(page,surface,cell,{config,out,id,suffix});
  await reset();recordReturnEntry(cell,page,flow,state,config);await snap('entry');cell.entryFrame=cell.frames[0];
  // Replay from the entry for each edge. Contracts own safe actions and their expectations.
  const queue=[[]],seen=new Set(),breakPlans=[],planned=new Set();let states=0;const reachedForms=new Set(),reachedInputs=new Set(),reachedControls=new Set();
  while(queue.length){
   const path=queue.shift();await reset();for(const c of path)await act(c.steps);
   const controls=await withPrototypeChrome(page,config.prototypeChrome,()=>inventory(surface,flow.controls.map(c=>c.selector)));
   for(const target of await surface.locator('form').evaluateAll(es=>es.map((e,i)=>e.id?'#'+e.id:'form:nth-of-type('+(i+1)+')')))reachedForms.add(target);
   const bindings=await Promise.all(controls.map(async item=>({item,loc:await matchingControl(surface,item,flow.controls),breaks:await matchingBreaks(surface,item,flow.breaks,state.id)})));
   for(const item of controls.filter(c=>['input','textarea','select'].includes(c.tag)))reachedInputs.add(item.id?'#'+item.id:item.name);
   const fingerprint=await surface.locator('body').evaluate(e=>JSON.stringify({text:e.innerText,controls:[...e.querySelectorAll('input,select,textarea,button,[role=button],[role=radio],[role=switch],a[href],summary')].map(x=>[x.id,x.type,x.checked,x.value,x.disabled,x.hidden,...['aria-pressed','aria-checked','aria-selected','aria-expanded','aria-disabled'].map(a=>x.getAttribute(a))]),dialogs:[...e.querySelectorAll('[role=dialog],dialog[open]')].map(x=>x.innerText)}));
   const key=createHash('sha256').update(page.url()+fingerprint+JSON.stringify(controls)).digest('hex');
   if(seen.has(key))continue;seen.add(key);states++;
   if(states>(config.maxStates||100)){cell.gaps.push('state traversal limit reached');break;}
   if(path.length)await snap(`state-${states}`);
   for(const [index,b]of flow.breaks.entries()){
    if(!applicableBreak(b,state.id)||!b.target||b.notApplicable)continue;
    if(b.coverageTarget&&!bindings.some(x=>x.breaks.includes(b)))continue;
    if(!await surface.locator(b.target).count())continue;
    breakPlans.push({index,b,path:[...path],graphState:key,number:states});planned.add(index);
   }
   for(const {item,loc,breaks}of bindings){
    const input=['input','textarea','select'].includes(item.tag),kinds=input?['empty','invalid','double-submit','refresh']:loc&&!item.disabled?['double-submit','refresh','back-forward']:[];
    for(const kind of kinds)if(!breaks.some(b=>b.kind===kind))cell.gaps.push('missing '+kind+' expected outcome for '+redact(input?(item.id?'#'+item.id:item.name):loc.selector)+' at reached state '+states);
   }
   for(const target of await surface.locator('form').evaluateAll(es=>es.map((e,i)=>e.id?'#'+e.id:'form:nth-of-type('+(i+1)+')'))){
    const bound=await matchingBreaks(surface,{path:target,tag:'form',name:target},flow.breaks,state.id);
    for(const kind of ['empty','invalid','double-submit','refresh'])if(!bound.some(b=>b.kind===kind))cell.gaps.push('missing '+kind+' expected outcome for '+redact(target)+' at reached state '+states);
   }
   for(const {item,loc,breaks} of bindings){
    if(!loc&&['input','textarea','select'].includes(item.tag)&&breaks.length){cell.controls.push({tag:item.tag,target:item.id?'#'+item.id:item.name,breakIndices:breaks.map(b=>flow.breaks.indexOf(b)),graphState:key,status:'break-contract-pending'});continue;}
    if(item.disabled&&!loc?.service){cell.controls.push({selector:loc?.selector,tag:item.tag,status:'disabled'});continue;}
    if(loc){
     reachedControls.add(loc.selector);
     const edgeKey=key+loc.selector;
     if(seen.has(edgeKey))continue;seen.add(edgeKey);
     if(loc.destructive&&!loc.isolated){cell.gaps.push('destructive control lacks isolated real sandbox data');continue;}
     if(!loc.safe){cell.gaps.push('control safety undeclared: '+redact(loc.selector));continue;}
     if(loc.service){
      try{await reset();for(const control of path)await act(control.steps);const prepared=await prepareServiceAction(page,surface,loc,{config:observationConfig,baseURL:config.baseURL,runNavigation:navigation.run,pace,onAbort:(p,b)=>intentBoundaries.set(p,b)});const affordance=await serviceAffordance(page,surface,loc);if(!services)throw Error('service phase unavailable');const servicePhase=services.defer(t,cell,loc,'control',config),entry={selector:loc.selector,status:'deferred',servicePhase,affordance};cell.controls.push(entry);try{entry.intent=await serviceAction(page,surface,prepared,{config:observationConfig,baseURL:config.baseURL,runNavigation:navigation.run,pace,onAbort:(p,b)=>intentBoundaries.set(p,b)});}catch(error){entry.intent={status:error instanceof ServiceAttributionGap?'incomplete':'fail',reason:error.message};if(error instanceof ServiceAttributionGap)cell.gaps.push(error.message);else cell.failures.push(error.message);}}catch(error){cell.failures.push('service affordance failed: '+redact(error.message));}continue;
     }
     if(loc.terminal){
      if(!terminals){cell.gaps.push('terminal phase unavailable: '+redact(loc.selector));continue;}
      const terminal=terminals.defer(t,cell,loc,'control');cell.controls.push({selector:loc.selector,status:'deferred',scope:'engine',terminal});continue;
     }
     await reset();for(const c of path)await act(c.steps);
     try{errors.phase('control '+loc.selector);const before=observed.length,effects=await act(loc.steps);if(effects.some(e=>e.type==='handoff')){cell.controls.push({selector:loc.selector,status:observed.length>before?'fail':'pass',effects});continue;}const settled=await runtime.settle();await snap(`control-${cell.controls.length}`);cell.controls.push({selector:loc.selector,status:!settled?'incomplete':observed.length>before?'fail':'pass',effects,steps:loc.steps.map(s=>({action:s.action,selector:s.selector,expected:['visible','hidden','text','url','count','value'].includes(s.action)?redact(s.env?'[environment]':s.value??s.action):undefined}))});if(settled&&observed.length===before)queue.push([...path,loc]);}
     catch(error){
      errors.caught(error);
      if(error instanceof NoEffectIncompleteError){cell.gaps.push(error.message+': '+redact(loc.selector));cell.controls.push({selector:loc.selector,status:'incomplete'});}
      else{cell.failures.push('control expected effect failed: '+redact(loc.selector)+'; '+redact(error.message));cell.controls.push({selector:loc.selector,status:'fail'});}
     }
    }else if(item.tag==='a'&&item.href){
     const url=new URL(item.href,page.url());
     if(url.origin!==new URL(config.baseURL).origin){cell.gaps.push('external navigation not declared');continue;}
     if(!config.flows.some(f=>new URL(f.url,config.baseURL).href===url.href))cell.gaps.push('reachable route missing flows ownership: '+redact(url.href));
     cell.gaps.push('link lacks expected outcome: '+redact(item.href));
    }else cell.gaps.push('unmapped visible control: '+redact(item.tag+' '+item.name));
   }
  }
  // Every form/control needs explicit expected outcomes. Never infer a valid service result.
  for(const control of flow.controls)if(!cell.controls.some(c=>c.selector===control.selector))cell.gaps.push('declared control not exercised: '+redact(control.selector));
  const required=breakKinds;
  for(const kind of required)if(!flow.breaks.some(b=>b.kind===kind)&&!flow.authCounterparts?.[kind])cell.gaps.push('missing break contract: '+kind);
  for(const auth of ['signed-out','signed-in'])if(!flow.states.some(s=>(typeof s==='string'?s:s.id)===auth))cell.gaps.push(flow.authCounterparts?.[auth]?'auth counterpart pending: '+auth:'missing real auth state: '+auth);
  for(const [index,b]of flow.breaks.entries()){
   if(b.state&&b.state!==state.id){cell.controls.push({break:b.kind,index,status:'unrun',scope:b.state,reason:'declared for another auth state'});continue;}
   if(applicableBreak(b,state.id)&&!b.notApplicable&&!planned.has(index))cell.gaps.push('break target or alias never reached: '+b.kind+' '+redact(b.coverageTarget||b.target||'[missing target]'));
  }
  for(const {index:breakIndex,b,path,graphState,number}of breakPlans){
   if(b.notApplicable&&b.reason&&!reachedForms.size&&!reachedInputs.size&&(b.kind!=='double-submit'||!reachedControls.size)&&['empty','invalid','double-submit'].includes(b.kind))continue;
   if(!b.safe){cell.gaps.push('break safety undeclared: '+b.kind);continue;}
   if(!['visible','hidden','text','url','count','value','handoff'].includes(b.steps?.at(-1)?.action)){cell.gaps.push('break has no expected outcome: '+b.kind);continue;}
   const actions=b.steps.map(s=>s.action);
   const validAction=b.kind==='empty'?b.steps.some(s=>s.action==='fill'&&s.value===''):b.kind==='invalid'?b.steps.some(s=>s.action==='fill'&&(s.env||s.value)):b.kind==='double-submit'?(actions.includes('double-click')||b.steps.some(s=>s.action==='handoff'&&s.gesture==='double-click')):b.kind==='refresh'?actions.includes('reload'):b.kind==='back-forward'?actions.includes('back')&&actions.includes('forward'):true;
   if(!validAction){cell.gaps.push('break does not exercise '+b.kind);continue;}
   if(['signed-out','signed-in'].includes(b.kind)&&state.id!==b.kind)continue;
   if(b.service){
    try{await reset();for(const control of path)await act(control.steps);const prepared=await prepareServiceAction(page,surface,b,{config:observationConfig,baseURL:config.baseURL,runNavigation:navigation.run,pace,onAbort:(p,boundary)=>intentBoundaries.set(p,boundary)});const affordance=await serviceAffordance(page,surface,b);if(!services)throw Error('service phase unavailable');const servicePhase=services.defer(t,cell,b,'break',config),entry={break:b.kind,target:b.target,index:breakIndex,graphState,status:'deferred',servicePhase,affordance};cell.controls.push(entry);try{entry.intent=await serviceAction(page,surface,prepared,{config:observationConfig,baseURL:config.baseURL,runNavigation:navigation.run,pace,onAbort:(p,boundary)=>intentBoundaries.set(p,boundary)});}catch(error){entry.intent={status:error instanceof ServiceAttributionGap?'incomplete':'fail',reason:error.message};if(error instanceof ServiceAttributionGap)cell.gaps.push(error.message);else cell.failures.push(error.message);}}catch(error){cell.failures.push('service break affordance failed: '+redact(error.message));}continue;
   }
   if(b.terminal){
    if(!terminals){cell.gaps.push('terminal phase unavailable: '+b.kind);continue;}
    const terminal=terminals.defer(t,cell,b,'break');cell.controls.push({break:b.kind,target:b.target,index:breakIndex,graphState,status:'deferred',scope:'engine',terminal});continue;
   }
   try{await reset();for(const control of path)await act(control.steps);if(b.coverageTarget){const current=await inventory(surface);const matched=await Promise.all(current.map(async item=>(await matchingBreaks(surface,item,[b],state.id)).length));if(!matched.some(Boolean))throw Error('break alias no longer binds its reached input');}if(!b.target)throw Error('break target required');await surface.locator(b.target).waitFor({state:'attached'});errors.phase('break '+b.kind+' '+breakIndex);const effects=['empty','invalid'].includes(b.kind)?(await serviceAction(page,surface,b,{config:observationConfig,mode:'local',onViolation:message=>cell.failures.push(message),baseURL:config.baseURL,runNavigation:navigation.run,pace,onAbort:(p,boundary)=>intentBoundaries.set(p,boundary)}),[]):await act(b.steps,b.target);if(effects.some(e=>e.type==='handoff')){cell.controls.push({break:b.kind,target:b.target,index:breakIndex,graphState,status:'pass',effects});continue;}const settled=await runtime.settle();await snap('break-'+b.kind+'-'+breakIndex+'-state'+number+'-'+createHash('sha256').update(b.target).digest('hex').slice(0,10));cell.controls.push({break:b.kind,target:b.target,coverageTarget:b.coverageTarget||b.target,index:breakIndex,graphState,statePath:path.map(c=>c.selector),status:settled?'pass':'incomplete'});}
   catch(error){errors.caught(error);cell.failures.push('break failed: '+b.kind+' on '+redact(b.target)+'; '+redact(error.message));cell.controls.push({break:b.kind,target:b.target,coverageTarget:b.coverageTarget||b.target,index:breakIndex,graphState,statePath:path.map(c=>c.selector),status:'fail'});cell.repro.push('Run '+b.kind+' on '+redact(b.target),...b.steps.map(s=>redact(s.action+' '+(s.selector||'page')+' '+(s.env?'[environment]':s.value??''))));}
  }
  for(const entry of cell.controls.filter(c=>c.status==='break-contract-pending'))entry.status=cell.controls.some(c=>c.graphState===entry.graphState&&entry.breakIndices.includes(c.index)&&['pass','fail','shared'].includes(c.status))?'covered-by-break-contract':'incomplete';
  await runtime.settle();
  await runtime.audit();
  cell.failures=[...new Set(cell.failures)];cell.gaps=[...new Set(cell.gaps)];
  cell.complete=cell.gaps.length===0;
 }catch(error){const detail=errors?.caught(error);cell.gaps.push('cell failed during '+(detail?.phase||'context')+': '+redact(error.message));}
 finally{
  if(runtime)await runtime.settle();
  await errors?.finish();
  await runtime?.audit();
  cell.gaps=[...new Set(cell.gaps)];if(cell.gaps.length)cell.complete=false;
  cell.failures=[...new Set([...cell.failures,...observed])];clearTimeout(cellTimer);
  if(cellBuild)cell.build=await cellBuild.finish();
  await buildObserver?.finish();if(context)await context.close().catch(()=>{});
  writeFileSync(join(out,'checkpoint.json'),JSON.stringify({...report,running:true},null,2));
 }
}
export async function matchingControl(page,item,declared){
 for(const c of declared){
  const match=await page.locator(c.selector).evaluateAll((els,path)=>els.some(e=>e===document.querySelector(path)),item.path);
  if(match)return c;
 }
}

export function applicableBreak(b,state){return (!b.state||b.state===state)&&(!['signed-out','signed-in'].includes(b.kind)||b.kind===state);}

export async function matchingBreaks(page,item,declared,state){
 const matches=[];
 for(const b of declared){
  if(!b.target||b.notApplicable||!applicableBreak(b,state))continue;
  if(b.coverageTarget&&!([item.name,item.id?'#'+item.id:undefined].includes(b.coverageTarget)))continue;
  if(await page.locator(b.target).evaluateAll((els,path)=>els.some(e=>e===document.querySelector(path)),item.path))matches.push(b);
 }
 return matches;
}
