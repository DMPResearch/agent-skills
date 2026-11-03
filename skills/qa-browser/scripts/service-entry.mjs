import {matrixContext,matrixBoundary} from './service-boundary.mjs';
import {replayServiceResponses} from './service-replay.mjs';
import {observeServiceTraffic} from './service-traffic.mjs';
import {observeErrors} from './errors.mjs';
import {observeRuntime} from './runtime.mjs';
import {observeBuild,compareServedBuild} from './provenance.mjs';
import {steps} from './browser.mjs';
export async function replayServiceEntry(seed,cell,{config,adapter,pace,report,buildObserver}){
 const runtime={screen:cell.screen,state:cell.state,engine:cell.engine,size:cell.size,failures:[],gaps:[]},[width,height]=cell.size.split('x').map(Number);
 await pace?.(config.servicePhase.cellLimiter);
 const context=await matrixContext(seed.browser,{viewport:{width,height},colorScheme:cell.theme,storageState:seed.storage},{config,cell:runtime});
 const boundary=await matrixBoundary(context),intentBoundaries=new WeakMap(),observationConfig={...config,intentBoundaries,observations:seed.target.observations??config.observations};
 const traffic=observeServiceTraffic(context,report,{baseURL:config.baseURL,phase:'matrix-replay',cell:cell.id,engine:cell.engine,state:cell.authState});cell.serviceTraffic||=[];cell.serviceTraffic.push(traffic);
 const errors=await observeErrors(context,runtime,runtime.failures,observationConfig),build=observeBuild(config.baseURL);build.attach(context);buildObserver?.attach(context);
 const auditBuild=async()=>{const actual=await build.finish(),match=compareServedBuild(actual,seed.build,config.assetHashes);cell.build=actual;cell.failures.push(...match.failures);cell.gaps.push(...match.gaps);return match;};
 const requireBuild=async()=>{const match=await auditBuild();if(match.failures.length||match.gaps.length)throw Error([...match.failures,...match.gaps].join('; '));};
 const replay=replayServiceResponses(boundary,context,seed.responses,{cell,phase:cell.servicePhase,baseURL:config.baseURL,beforeReplay:requireBuild});
 let page,observer,closed=false;const timer=setTimeout(()=>context.close().catch(()=>{}),Math.min(config.cellTimeoutMs||60000,60000));
 const close=async()=>{
  if(closed)return;closed=true;
  try{await observer?.settle();await errors.finish();await observer?.audit();await auditBuild();}
  finally{clearTimeout(timer);await context.close();cell.failures.push(...runtime.failures);cell.gaps.push(...runtime.gaps);for(const key of ['diagnostics','findings','observations']){cell[key]||=[];cell[key].push(...runtime[key]||[]);}}
 };
 try{
  context.setDefaultTimeout(Math.min(config.actionTimeoutMs||10000,10000));
  if(config.themeInit)await context.addInitScript(config.themeInit.replaceAll('THEME',JSON.stringify(cell.theme)));
  page=await context.newPage();observer=observeRuntime(page,runtime,observationConfig);errors.phase('service response replay entry');
  await page.goto(new URL(seed.flow.url,config.baseURL).href,{waitUntil:'load'});await requireBuild();
  // The recorded engine phase supplies entry responses; trusted adapters may do local entry work, never preparation.
  await adapter?.enter?.({page,flow:seed.flow,state:seed.state.id,pace:async()=>{}});
  const unpaced=items=>items.map(step=>({...step,service:undefined}));
  await steps(page,unpaced([...seed.state.setup||[],...seed.flow.steps]),seed.flow.frame?page.frameLocator(seed.flow.frame):page,undefined,replay.navigation);
  for(const action of seed.actions)await steps(page,unpaced(action.recipe.steps),action.flow.frame?page.frameLocator(action.flow.frame):page,action.kind==='break'?action.recipe.target:undefined,replay.navigation);
  await steps(page,seed.target.steps.filter(s=>['visible','hidden','text','value','url','count'].includes(s.action)),seed.target.frame?page.frameLocator(seed.target.frame):page);
  if(!await observer.settle())throw Error('replayed service entry did not settle');
  return {page,observer,errors,runtime,close,onAbort:(p,b)=>intentBoundaries.set(p,b),onReset:p=>intentBoundaries.delete(p)};
 }catch(error){await close();throw error;}
}
