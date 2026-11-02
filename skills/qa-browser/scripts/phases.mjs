import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {steps,inspect} from './browser.mjs';
import {trackNavigations} from './navigation.mjs';
import {observeRuntime,verifyIdentity} from './runtime.mjs';
import {redact} from './contract.mjs';

export function servicePacer(intervals={}){
 const next=new Map();
 for(const [key,value]of Object.entries(intervals))if(!Number.isInteger(value)||value<1)throw Error('serviceIntervals.'+key+' must be a positive interval in milliseconds');
 return async(key,{signal}={})=>{
  if(!Object.hasOwn(intervals,key))throw Error('serviceIntervals.'+key+' is required for paced service steps');
  const now=Date.now(),slot=Math.max(now,next.get(key)||0);next.set(key,slot+intervals[key]);
  if(slot>now)await delay(slot-now,undefined,{signal});
 };
}

export async function prepareEngines(tasks,env){
 const {adapter,config,report,browserModule,browsers,launches}=env,sessions=new Map();
 if(!adapter?.prepareEngine)return sessions;
 report.sharedEntry=[];
 for(const engine of new Set(tasks.filter(t=>t.state.id==='signed-in').map(t=>t.engine))){
  let context,timer;
  const record={engine,status:'incomplete',scope:'engine'};report.sharedEntry.push(record);
  try{
   if(!launches.has(engine))launches.set(engine,browserModule[engine].launch().then(b=>{browsers.set(engine,b);return b;}));
   const browser=await launches.get(engine);context=await browser.newContext();context.setDefaultTimeout(10000);
   await Promise.race([
    adapter.prepareEngine({context,engine,config,pace:env.pace}),
    new Promise((_,reject)=>{timer=setTimeout(()=>{context.close().catch(()=>{});reject(Error('shared entry exceeded 60 second cap'));},60000);})
   ]);
   await verifyIdentity(adapter,{context,config,engine,state:'signed-in'},env.identities);
   const storage=await context.storageState();
   if(!storage.cookies.length&&!storage.origins.length)throw Error('shared entry produced no reusable browser session');
   sessions.set(engine,storage);record.status='pass';
  }catch(error){record.error=redact(error.message);report.gaps.push('real shared entry unavailable: '+engine+'; '+record.error);report.blockedAuthEngines||=[];report.blockedAuthEngines.push(engine);}
  finally{clearTimeout(timer);if(context)await context.close();}
 }
 return sessions;
}

export function terminalQueue(){
 const pending=new Map();
 return {
  defer(task,cell,recipe,kind){
   const key=createHash('sha256').update(JSON.stringify([task.engine,task.state.id,kind,{target:recipe.selector||recipe.target,steps:recipe.steps,safe:recipe.safe,destructive:recipe.destructive,isolated:recipe.isolated}])).digest('hex').slice(0,16);
   let item=pending.get(key);
   if(!item){item={id:key,task,recipe,kind,cells:[]};pending.set(key,item);}
   if(!item.cells.includes(cell))item.cells.push(cell);
   cell.gaps.push('terminal check pending: '+key);
   return key;
  },
  async run(env){
   const {report,config,adapter,out,browsers,sessions}=env;report.terminalChecks=[];
   for(const item of pending.values()){
    const {task,recipe,kind,cells,id}=item,{flow,state,engine,theme,size}=task;
    const record={id,scope:'engine',engine,screen:flow.id,kind,target:recipe.selector||recipe.target,cells:cells.map(c=>c.id),status:'incomplete'};report.terminalChecks.push(record);
    let context,timer,entered=false,observer;
    const runtime={screen:flow.id,state:state.id,engine,size,failures:[],gaps:[],diagnostics:[]};
    try{
     if(!recipe.safe||recipe.destructive&&!recipe.isolated)throw Error('terminal control requires declared safe isolated data');
     const [width,height]=size.split('x').map(Number);
     context=await browsers.get(engine).newContext({viewport:{width,height},colorScheme:theme,storageState:state.id==='signed-in'?sessions.get(engine):undefined});context.setDefaultTimeout(10000);
     timer=setTimeout(()=>context.close().catch(()=>{}),60000);
     if(config.themeInit)await context.addInitScript(config.themeInit.replaceAll('THEME',JSON.stringify(theme)));
     await adapter?.authenticate?.({context,state:state.id,config,flow,pace:env.pace});
     if(state.id==='signed-in')await verifyIdentity(adapter,{context,config,flow,state:state.id,engine},env.identities);
     const page=await context.newPage(),root=flow.frame?page.frameLocator(flow.frame):page,navigation=trackNavigations(page);
     observer=observeRuntime(page,runtime,config);
     await adapter?.reset?.({page,flow,state:state.id,config,pace:env.pace});
     await navigation.run(()=>page.goto(new URL(flow.url,config.baseURL).href,{waitUntil:'load'}));
     await adapter?.enter?.({page,flow,state:state.id,pace:env.pace});
     await steps(page,[...state.setup||[],...flow.steps],root,undefined,navigation.run,env.pace);
     await root.locator(recipe.selector||recipe.target).waitFor({state:'attached'});
     entered=true;
     await steps(page,recipe.steps,root,kind==='break'?recipe.target:undefined,navigation.run,env.pace);
     const settled=await observer.settle();
     const failures=await inspect(page);if(failures.length)throw Error(failures.join('; '));
     const path=join(out,'terminal-'+id+'.png');await page.screenshot({path,fullPage:true,mask:config.redactSelectors?.map(s=>root.locator(s))||[]});cells[0].frames.push(path);record.frame=path;
     const gaps=navigation.unclassified();if(gaps.length)throw Error('unclassified cancelled request: '+redact(gaps[0].url()));
     record.status=runtime.failures.length?'fail':settled&&!runtime.gaps.length?'pass':'incomplete';
    }catch(error){record.error=redact(error.message);if(entered){record.status='fail';for(const cell of cells)cell.failures.push('shared terminal expected effect failed: '+record.target+'; '+record.error);}else report.gaps.push('shared terminal check unavailable: '+id+'; '+record.error);}
    finally{if(observer)await observer.settle();clearTimeout(timer);if(context)await context.close().catch(()=>{});if(runtime.failures.length)record.status='fail';else if(runtime.gaps.length)record.status='incomplete';}
    for(const cell of cells){
     cell.failures.push(...runtime.failures);cell.gaps.push(...runtime.gaps);cell.diagnostics||=[];cell.diagnostics.push(...runtime.diagnostics);
     if(['pass','fail'].includes(record.status))cell.gaps=cell.gaps.filter(g=>g!=='terminal check pending: '+id);
     for(const entry of cell.controls.filter(c=>c.terminal===id))entry.status=record.status==='pass'?'shared':record.status;
     cell.complete=cell.gaps.length===0;
    }
   }
  }
 };
}
