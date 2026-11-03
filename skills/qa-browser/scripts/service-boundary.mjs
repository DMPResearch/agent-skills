import {redact} from './contract.mjs';
const contexts=new WeakMap();
export async function matrixBoundary(context,{config,cell,nonPhase=true}={}){
 if(contexts.has(context))return contexts.get(context);
 const ids=new WeakMap(),routed=new WeakSet(),tasks=new Set(),waiting=new Set(),actions=new Set(),sockets=new Set(),guardedPages=new WeakSet(),closingPages=new WeakSet();let nextId=0,draining,closing=false;
 const checkpoint=(event,request)=>{if(!cell)return;cell.diagnostics||=[];cell.diagnostics.push({kind:'service-boundary',event,at:performance.now(),pending:tasks.size,waiting:waiting.size,actions:actions.size,sockets:sockets.size,...request?{request:ids.get(request),method:request.method(),url:redact(request.url())}:{}});};
 const admitted=new WeakSet();let active,replay,quarantined=false;
 const fail=(message,url)=>{
  quarantined=true;const detail=redact('unexpected service '+message+': '+url);
  if(cell){cell.failures.push(detail);cell.observations||=[];cell.observations.push({kind:'service-egress-blocked',message:detail,affectsVerdict:true});}
  active?.fail(Error(detail));
 };
 context.on('request',request=>{
  if(!ids.has(request))ids.set(request,++nextId);if(!routed.has(request))waiting.add(request);checkpoint('request-observed',request);
  let page;try{page=request.frame().page();}catch{}
  if(cell&&(closing||page&&closingPages.has(page))&&new URL(request.url()).origin!==new URL(config.baseURL).origin){cell.observations||=[];cell.observations.push({kind:'service-teardown-request',classId:'service-boundary',outcome:'observed',method:request.method(),url:redact(request.url()),reason:'external request observed during teardown; keepalive status unavailable',affectsVerdict:false});}
 });
 context.on('requestfailed',request=>{waiting.delete(request);checkpoint('request-failed',request);});context.on('requestfinished',request=>{waiting.delete(request);checkpoint('request-finished',request);});
 const guardPage=page=>{
  if(guardedPages.has(page))return;guardedPages.add(page);
  page.once('close',()=>checkpoint('page-closed'));
  const close=page.close.bind(page);page.close=async options=>{closingPages.add(page);checkpoint('page-close-requested');await boundary.drain();checkpoint('page-close-dispatched');return close(options);};
 };
 context.on('page',guardPage);context.once('close',()=>checkpoint('context-closed'));
 const boundary={checkpoint,beginClose(page){closingPages.add(page);checkpoint('intent-close-requested');},
  track(operation){actions.add(operation);operation.finally(()=>{actions.delete(operation);checkpoint('action-settled');}).catch(()=>{});},
  async drain(){
   if(draining)return draining;
   draining=(async()=>{
    checkpoint('drain-start');const deadline=performance.now()+2000;let forced=false;
    const pending=()=>waiting.size+tasks.size+actions.size+sockets.size;
    while(performance.now()<deadline){
     if(!pending()){await new Promise(resolve=>setTimeout(resolve,25));if(!pending()){checkpoint('drain-complete');return;}}
     if(!forced&&performance.now()>deadline-500){
      forced=true;
      for(const task of [...tasks])if(!task.started){
       if(cell)cell.failures.push('pending interception required abort at teardown: '+redact(task.request.method()+' '+task.request.url()));
       task.forced=true;task.abort().catch(()=>{});
      }
     }
     await new Promise(resolve=>setTimeout(resolve,5));
    }
    const message='pending interception/action unresolved after 2000 ms; close refused';if(cell)cell.failures.push(message);checkpoint('drain-failed');throw Error(message);
   })();
   try{return await draining;}finally{draining=undefined;}
  },admit:page=>admitted.add(page),fail,replay:handler=>{replay=handler;},next:route=>replay&&new URL(route.request().url()).origin!==new URL(config.baseURL).origin?replay(route):route.fallback(),
  action(route,reject){const next={route,fail:reject};active=next;return ()=>{if(active===next)active=undefined;};}
 };
 contexts.set(context,boundary);
 for(const page of context.pages())guardPage(page);
 const close=context.close.bind(context);context.close=async options=>{closing=true;checkpoint('context-close-requested');await boundary.drain();checkpoint('context-close-dispatched');return close(options);};
 await context.route('**/*',async route=>{
  const request=route.request();if(!ids.has(request))ids.set(request,++nextId);routed.add(request);waiting.delete(request);checkpoint('http-route-enter',request);const task={request,started:false,forced:false};tasks.add(task);
  const decide=(action,args)=>{
   if(task.forced&&task.started)return task.ack;
   task.started=true;checkpoint(action+'-requested',request);
   task.ack=route[action](...args).then(value=>{tasks.delete(task);checkpoint(action+'-acknowledged',request);return value;},error=>{if(cell)cell.failures.push('interception decision failed: '+redact(error.message));throw error;});
   return task.ack;
  };
  task.abort=()=>decide('abort',['aborted']);
  const guarded=new Proxy(route,{get(target,key){if(['abort','fulfill','fallback','continue'].includes(key))return (...args)=>decide(key,args);const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
  try{
  const url=new URL(request.url());let page;try{page=request.frame().page();}catch{}
  if(quarantined&&url.origin!==new URL(config.baseURL).origin){await guarded.abort('aborted');return;}
  if(url.origin!==new URL(config.baseURL).origin&&(!page||!admitted.has(page))){fail('request from an unadmitted page',url.href);await guarded.abort('aborted');return;}
  if(active)return await active.route(guarded);
  if(replay&&url.origin!==new URL(config.baseURL).origin)return await replay(guarded);
  return await guarded.fallback();
  }catch(error){if(!task.forced)throw error;}finally{if(!task.started){fail('interception ended without a network decision',request.url());await guarded.abort('aborted');}checkpoint('http-route-exit',request);}
 });
 await context.routeWebSocket('**/*',async socket=>{const token={};sockets.add(token);try{
  const url=new URL(socket.url()),own=new URL(config.baseURL);url.protocol=url.protocol==='wss:'?'https:':'http:';
  if(url.origin!==own.origin&&(nonPhase||active)){checkpoint('websocket-rejected');fail('WebSocket attempt',socket.url());await socket.close();checkpoint('websocket-close-ack');}
  else socket.connectToServer();
 }finally{sockets.delete(token);}
 });
 return boundary;
}
export async function matrixContext(browser,options,{config,cell}){
 const context=await browser.newContext({...options,serviceWorkers:'block'}),boundary=await matrixBoundary(context,{config,cell});
 const newPage=context.newPage.bind(context);context.newPage=async()=>{const page=await newPage();boundary.admit(page);return page;};
 cell.serviceWorkerPolicy='blocked; phase coverage only';
 return context;
}
