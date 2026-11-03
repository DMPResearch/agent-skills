import {matrixBoundary} from './service-boundary.mjs';
import {requestObservation} from './observations.mjs';
import {serviceRequestTraffic} from './service-traffic.mjs';
import {trackNavigations} from './navigation.mjs';
import {randomUUID} from 'node:crypto';
import {steps,closeBoundaryPage} from './browser.mjs';
export class ServiceAttributionGap extends Error {}
const localGuards=new WeakMap();
const mutations=new Set(['click','double-click','handoff','press','fill','select','check']);
export async function serviceAction(page,root,recipe,{mode='intent',baseURL,runNavigation,pace,onAbort=()=>{},retain=false,onGuardReady=()=>{},onReset=()=>{},onViolation=()=>{},allowOwnMutations=false,config}={}){
 const expected=recipe.serviceRequest;
 if(mode!=='local'&&(!expected?.origin||!expected.method))throw new ServiceAttributionGap('serviceRequest needs exact origin and method before activation');
 const loc=root.locator(recipe.selector||recipe.target),context=page.context(),events=[],network=[];
 const navigation=trackNavigations(page),generation=navigation.identity(page.mainFrame()).generation;
 const binding='qaIntent'+randomUUID().replaceAll('-','');let session,timer,rejectNetwork,resolveNetwork,matched=false,aborted=false;
 const outcome=new Promise((resolve,reject)=>{resolveNetwork=resolve;rejectNetwork=reject;});outcome.catch(()=>{});
 const handlers=await loc.evaluate(e=>[e.onclick,e.oninput,e.onchange,e.form?.onsubmit].filter(Boolean).map(f=>f.name));
 await page.exposeBinding(binding,({frame},event)=>events.push({...event,frameURL:frame.url()}));
 await loc.evaluate((element,binding)=>{
  const view=element.ownerDocument.defaultView;
  for(const kind of ['click','submit','input','change'])view.addEventListener(kind,event=>{
   if(!event.isTrusted||!(element===event.target||element.contains(event.target)||event.type==='submit'&&element.form===event.target))return;
   const anchor=element.closest('a[href]'),form=element.form||element.closest('form');
   view[binding]({at:Date.now(),kind,prevented:event.defaultPrevented,href:anchor?.href,action:form?new URL(Element.prototype.getAttribute.call(form,'action')||location.href,element.baseURI).href:undefined,method:form?(Element.prototype.getAttribute.call(form,'method')||'get').toUpperCase():undefined}).catch(()=>{});
  });
 },binding);
 if(context.browser()?.browserType().name()==='chromium'){
  session=await context.newCDPSession(page);session.on('Network.requestWillBeSent',event=>network.push(event));await session.send('Network.enable');
 }
 const causal=async request=>{
  const deadline=Date.now()+150;let event,info;
  do{event=events.at(-1);info=network.findLast(e=>e.request.url===request.url()&&e.request.method===request.method());if(event&&(!session||info))break;await new Promise(r=>setTimeout(r,5));}while(Date.now()<deadline);
  const started=info?.wallTime?info.wallTime*1000:Date.now();
  if(!event||started<event.at-5||started-event.at>500)return false;
  if(request.isNavigationRequest()&&!event.prevented){const target=event.href||event.action;if(target){const actual=new URL(request.url()),declared=new URL(target);if(actual.origin===declared.origin&&actual.pathname===declared.pathname&&request.method()===(event.href?'GET':event.method))return true;}}
  let attributed=false;for(let stack=info?.initiator?.stack;stack;stack=stack.parent){if(/timer|timeout|interval/i.test(stack.description||''))return false;if(stack.callFrames?.some(f=>handlers.includes(f.functionName)&&f.url===event.frameURL))attributed=true;}
  return attributed;
 };
 const localReceipt={status:'pass',outcome:'local validation sent no request'};
 const route=async route=>{
  const fallback=()=>boundary?boundary.next(route):route.fallback();
  const request=route.request(),url=new URL(request.url());let owner;try{owner=request.frame().page();}catch{}
  if(url.origin===new URL(baseURL).origin&&!(mode==='local'&&!allowOwnMutations&&!['GET','HEAD','OPTIONS'].includes(request.method())))return fallback();
  if((retain||mode==='local')&&navigation.identity(page.mainFrame()).generation!==generation)return fallback();
  if(aborted){serviceRequestTraffic(context,request,'intercepted');return route.abort('aborted').catch(()=>{});}
  if(config&&requestObservation(config.observations||[],baseURL,request))return fallback();
  const match=mode!=='local'&&url.origin===expected.origin&&request.method()===expected.method;
  const attributed=await causal(request);
  if(!attributed||!match||mode!=='real'){
   serviceRequestTraffic(context,request,'intercepted');aborted=true;onAbort(page,{at:Date.now(),runtimeAt:performance.now(),reason:'service intent abort'});
   if(mode==='local'){localReceipt.status='fail';localReceipt.reason='local validation attempted an unexpected request';onViolation(localReceipt.reason);rejectNetwork(Error(localReceipt.reason));}
   else if(!attributed)rejectNetwork(new ServiceAttributionGap('service initiator unavailable or outside click causal window'));
   else if(!match)rejectNetwork(Error(mode==='local'?'local validation attempted an unexpected request':'service intent attempted an unexpected host or method'));
   else{matched=true;resolveNetwork({status:'pass',outcome:"intent proved; this action's request was stopped before leaving the browser",method:request.method(),origin:url.origin,initiator:session?'browser stack or native navigation':'native navigation'});}
   await route.abort('aborted').catch(()=>{});return;
  }
  serviceRequestTraffic(context,request,'serviceActions');matched=true;resolveNetwork({status:'pass',outcome:'attributed service request allowed',method:request.method(),origin:url.origin});return fallback();
 };
 const boundary=mode==='real'?undefined:await matrixBoundary(context,{config:config||{baseURL},nonPhase:mode==='intent'});boundary?.admit(page);
 const remove=boundary?boundary.action(route,error=>{aborted=true;onAbort(page,{at:Date.now(),runtimeAt:performance.now(),reason:'unexpected service egress blocked'});onViolation(error.message);rejectNetwork(error);}):(await context.route('**/*',route),()=>context.unroute('**/*',route));const prior=localGuards.get(page);if(prior){await prior();localGuards.delete(page);}
 try{
  let last=-1;for(const [i,step]of recipe.steps.entries())if(mutations.has(step.action))last=i;
  const prefix=mode==='local'?recipe.steps:recipe.steps.slice(0,last+1).map(s=>mode!=='real'&&s.action==='handoff'?{action:s.gesture==='double-click'?'double-click':'click',selector:s.selector}:s);
  const operation=steps(page,prefix,root,recipe.target,runNavigation,pace);operation.catch(()=>{});boundary?.track(operation);
  if(mode==='local'){await Promise.race([operation,outcome]);await Promise.race([new Promise(r=>setTimeout(r,500)),outcome]);return localReceipt;}
  await Promise.race([operation,outcome]);
  if(!matched)timer=setTimeout(()=>rejectNetwork(Error('service intent did not attempt the declared request')),500);
  const receipt=await outcome;
  if(mode==='real'){receipt.effects=await operation;await steps(page,recipe.steps.slice(last+1),root,recipe.target,runNavigation,pace);}
  return receipt;
 }finally{
  clearTimeout(timer);
  if(!page.isClosed())await session?.detach();
  if(mode==='local'&&!aborted){const release=async()=>{await remove();localGuards.delete(page);};localGuards.set(page,release);}
  else if(retain&&(aborted||mode==='intent')){
   const replaced=frame=>{if(frame===page.mainFrame()&&navigation.identity(frame).generation!==generation){onReset(page);page.off('framenavigated',replaced);}};
   page.on('framenavigated',replaced);
   onGuardReady(async()=>{if(navigation.identity(page.mainFrame()).generation===generation)throw new ServiceAttributionGap('intent reset requires a new app document');await remove();page.off('framenavigated',replaced);});
  }else{
   if(aborted||mode==='intent'){boundary?.beginClose(page);await closeBoundaryPage(page);}
   if(boundary||!page.isClosed())await remove();
  }
 }
}

export async function prepareServiceAction(page,root,recipe,options){
 let index=recipe.steps.findIndex(s=>mutations.has(s.action)&&s.selector===(recipe.selector||recipe.target));
 if(index<0)index=recipe.steps.findLastIndex(s=>mutations.has(s.action));
 if(index>0)await serviceAction(page,root,{...recipe,steps:recipe.steps.slice(0,index)},{...options,mode:'local'});
 return {...recipe,steps:recipe.steps.slice(Math.max(0,index))};
}
