import {replayServiceEntry} from './service-entry.mjs';
import {matchingControl,matchingBreaks,applicableBreak} from './cell.mjs';
import {declareReturnPaths,recordReturnEntry} from './return-path.mjs';
import {verifyIdentity} from './runtime.mjs';
import {createHash} from 'node:crypto';
import {steps,inventory} from './browser.mjs';
import {captureState} from './capture-state.mjs';
import {serviceAffordance} from './service.mjs';
import {serviceAction,prepareServiceAction,ServiceAttributionGap} from './service-action.mjs';

export function planServiceStates(item,env){
 const {recipe,task,cells,id}=item;if(recipe.steps.some(s=>s.action==='handoff'))return;
 const {flow,state,engine}=task,spec=recipe.postState,target=spec?env.config.flows?.find(f=>f.id===spec.flow):flow;
 if(!target)throw Error('postState names an unavailable flow');
 const dataState=spec?.state||state.id+':service:'+item.kind+':'+(recipe.selector||recipe.target);
 const candidates=env.tasks?.filter(t=>t.flow.id===(spec?target.id:flow.id)&&t.state.id===(spec?spec.state:state.id)&&t.engine===engine)||cells;
 const views=[...new Map(candidates.map(c=>[c.theme+'/'+c.size,{theme:c.theme,size:c.size}])).values()];
 const local=(spec?target.breaks:[]).filter(b=>applicableBreak(b,spec.state)&&['empty','invalid'].includes(b.kind)&&!b.service&&!b.terminal&&!b.notApplicable);
 const plans=[{state:dataState,checks:recipe.steps.filter(s=>['visible','hidden','text','value','url','count'].includes(s.action))},...local.map((b,i)=>({state:dataState+':'+b.kind+'-'+i,recipe:b,checks:b.steps.filter(s=>['visible','hidden','text','value','url','count'].includes(s.action))}))];
 const result=[];for(const plan of plans)for(const view of views){const cell={id:'service-state-'+id+'-'+createHash('sha256').update(plan.state+view.theme+view.size).digest('hex').slice(0,12),screen:target.id,state:plan.state,authState:spec?.state||state.id,engine,...view,serviceState:true,servicePhase:id,complete:false,frames:[],controls:[],failures:[],gaps:['service state not reached'],repro:['Real service phase '+id,'Resize to '+view.size+' and apply '+view.theme]};if(spec)declareReturnPaths(cell,target,{id:spec.state});result.push({cell,plan});env.report.cells.push(cell);}
 env.report.expectedCells=(env.report.expectedCells??env.report.cells.length-result.length)+result.length;
 return {target,plans,result,explicit:!!spec,state:spec?.state||state.id};
}
export async function captureServiceStates(livePage,planned,{config,out,adapter,observer,pace,resetDeadline,onAbort,remaining,runtime,errors,onReset,continueServices,identities,terminals,engine,seed,report,buildObserver}){
 if(!planned)return;const original={observer,runtime,errors,onAbort,onReset};let fresh,currentCell,freshFailures=0,page=livePage,root=planned.target.frame?livePage.frameLocator(planned.target.frame):livePage;const observationConfig={...config,observations:planned.target.observations??config.observations};
 const open=async()=>{try{fresh=await replayServiceEntry(seed,currentCell,{config,adapter,pace,report,buildObserver});({page,observer,runtime,errors,onAbort,onReset}=fresh);root=planned.target.frame?page.frameLocator(planned.target.frame):page;}catch(error){freshFailures++;if(freshFailures>=2)seed.freshStopped=true;throw error;}};
 const restore=async release=>{if(fresh){await fresh.close();fresh=undefined;await open();return;}if(adapter?.restoreServiceState)await adapter.restoreServiceState({page,flow:planned.target,config,pace});else await page.goto(new URL(planned.target.url,config.baseURL).href,{waitUntil:'load'});await release?.();await steps(page,planned.target.steps,root);};
 for(const plan of planned.plans){
  for(const {cell}of planned.result.filter(r=>r.plan===plan)){
   currentCell=cell;({observer,runtime,errors,onAbort,onReset}=original);page=livePage;root=planned.target.frame?page.frameLocator(planned.target.frame):page;
   if(seed&&!seed.freshStopped){try{await open();}catch(error){cell.gaps.push('fresh-load layout not proven: '+error.message);}}
   if(!fresh){cell.captureSource='resized from a live page';cell.gaps.push('fresh-load layout not proven');}
   resetDeadline();if(runtime){runtime.screen=cell.screen;runtime.state=cell.state;runtime.size=cell.size;}errors?.phase('post-service '+cell.id);const failuresBefore=runtime?.failures.length||0,gapsBefore=runtime?.gaps.length||0;
   try{
    if(page.isClosed()||remaining?.()<=0)throw Error('post-service state no longer available');
    await pace?.(config.servicePhase.cellLimiter);
    if(!fresh){
     const [width,height]=cell.size.split('x').map(Number);await page.setViewportSize({width,height});await page.emulateMedia({colorScheme:cell.theme});
     if(adapter?.applyTheme)await adapter.applyTheme({page,theme:cell.theme,config});
     else if(config.themeInit)await page.evaluate(config.themeInit.replaceAll('THEME',JSON.stringify(cell.theme)));
    }
    if(!await observer.settle())throw Error('post-service state has unresolved requests');
    if(cell.authState==='signed-in'){await verifyIdentity(adapter,{context:page.context(),page,config,flow:planned.target,state:cell.authState,engine:cell.engine},identities);cell.sessionVerified=true;}
    let localFailed=false;if(plan.recipe&&!fresh){localFailed=true;cell.gaps.push('post-service local break unrun on resized-only fallback: '+plan.recipe.kind);}if(plan.recipe&&fresh){if(!plan.recipe.safe)throw Error('post-service local break safety undeclared');try{cell.localProof=await serviceAction(page,root,plan.recipe,{config:observationConfig,mode:'local',onViolation:message=>cell.failures.push(message),baseURL:config.baseURL,pace,onAbort});}catch(error){if(page.isClosed())throw error;cell.failures.push('post-service local '+plan.recipe.kind+' expected effect failed: '+error.message);localFailed=true;}}
    if(!localFailed)await steps(page,plan.checks,root);await steps(page,planned.target.steps.filter(s=>['visible','hidden','text','value','url','count'].includes(s.action)),root);
    cell.gaps=cell.gaps.filter(g=>g!=='service state not reached');cell.inventory=await inventory(root,planned.target.controls.map(c=>c.selector));
    for(const control of planned.target.controls){if(await root.locator(control.selector).count())cell.controls.push({selector:control.selector,status:await root.locator(control.selector).isVisible()?'visible':'hidden',role:control.role,name:control.name});}
    const inputs=cell.inventory.filter(c=>['input','textarea','select'].includes(c.tag));
    if(planned.explicit){
     for(const item of cell.inventory){const declared=await matchingControl(root,item,planned.target.controls),bound=await matchingBreaks(root,item,planned.target.breaks,planned.state);
      if(['input','textarea','select'].includes(item.tag)){for(const kind of ['empty','invalid'])if(!bound.some(b=>b.kind===kind))cell.gaps.push('missing '+kind+' expected outcome for '+(item.id?'#'+item.id:item.name));}
      else if(!declared)cell.gaps.push('unmapped visible control: '+item.tag+' '+item.name);
     }
    }else if(inputs.length)cell.gaps.push('post-service input contracts require a declared postState flow');
    if(!plan.recipe)recordReturnEntry(cell,page,planned.target,{id:planned.state},config);
    if(plan.recipe)cell.controls.push({break:plan.recipe.kind,index:planned.target.breaks.indexOf(plan.recipe),target:plan.recipe.target,status:!fresh?'unrun':localFailed?'fail':'pass'});
    await captureState(page,root,cell,{config,out,suffix:'entry'});cell.entryFrame=cell.frames[0];
    if(planned.explicit&&!plan.recipe&&fresh)for(const recipe of [...planned.target.controls,...planned.target.breaks.filter(b=>applicableBreak(b,planned.state))].filter(r=>r.service)){
     const row={selector:recipe.selector||recipe.target,status:'deferred'};cell.controls.push(row);let release;
     try{const prepared=await prepareServiceAction(page,root,recipe,{config:observationConfig,baseURL:config.baseURL,pace,onAbort});row.affordance=await serviceAffordance(page,root,recipe);row.intent=await serviceAction(page,root,prepared,{config:observationConfig,baseURL:config.baseURL,pace,onAbort,retain:true,onReset,onGuardReady:value=>release=value});}
     catch(error){row.intent={status:error instanceof ServiceAttributionGap?'incomplete':'fail',reason:error.message};(error instanceof ServiceAttributionGap?cell.gaps:cell.failures).push(error.message);}
     finally{if(release)await restore(release);}
    }
    if(planned.explicit&&!plan.recipe&&fresh){
     for(const recipe of planned.target.controls.filter(r=>!r.service&&r.steps?.length)){
      const row={selector:recipe.selector,status:'incomplete'};cell.controls.push(row);
      if(recipe.terminal&&terminals){row.terminal=terminals.defer({flow:planned.target,state:{id:cell.authState},engine:cell.engine,theme:cell.theme,size:cell.size},cell,recipe,'control');row.status='deferred';continue;}
      if(!recipe.safe){cell.gaps.push('post-service control safety undeclared: '+recipe.selector);continue;}
      try{await serviceAction(page,root,{...recipe,target:undefined},{config:observationConfig,mode:'local',allowOwnMutations:true,baseURL:config.baseURL,pace,onAbort,onViolation:message=>cell.failures.push(message)});row.status='pass';await captureState(page,root,cell,{config,out,suffix:'control-'+cell.controls.indexOf(row)});await restore();}
      catch(error){row.status='fail';cell.failures.push('post-service local control failed: '+recipe.selector+'; '+error.message);if(page.isClosed())throw error;}
     }
     for(const [index,b]of planned.target.breaks.entries())if(applicableBreak(b,planned.state)&&!b.service&&!b.notApplicable&&!['empty','invalid'].includes(b.kind))cell.gaps.push('post-service break unrun: '+b.kind+' '+index);
    }
    if(!fresh&&planned.target.controls.length)cell.gaps.push('post-service controls unrun on resized-only fallback');
    await errors?.finish();await observer.audit();if(runtime){cell.failures.push(...runtime.failures.slice(failuresBefore));cell.gaps.push(...runtime.gaps.slice(gapsBefore));}cell.complete=!cell.gaps.length;
   }catch(error){cell.gaps.push('post-service state capture incomplete: '+error.message);}
   finally{if(fresh){await fresh.close();fresh=undefined;}cell.failures=[...new Set(cell.failures)];cell.gaps=[...new Set(cell.gaps)];cell.complete=cell.gaps.length===0;}
   cell.functional=cell.failures.length?'fail':cell.complete?'pass':'incomplete';
  }
 }
 if(planned.explicit&&continueServices)await continueServices(livePage,planned,seed);
}
