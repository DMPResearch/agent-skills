import {probeErrors} from './probe-errors.mjs';
import {finding,documentOf} from './findings.mjs';
import {createHash} from 'node:crypto';
import {readBody} from './body.mjs';
import {trackNavigations} from './navigation.mjs';
import {redact} from './contract.mjs';
import {validateObservations,requestObservation,warningObservation} from './observations.mjs';

export function observeRuntime(page,cell,config={},failures=cell.failures){
 const probe=probeErrors(typeof page.pages==='function'?page:page.context());
 cell.diagnostics||=[];cell.observations||=[];
 const classes=config.observations||[];validateObservations(classes,config);
 const exception=rule=>rule.sameSiteException?{hostname:rule.sameSiteException.hostname,reason:redact(rule.sameSiteException.reason)}:undefined;
 const seen=new WeakMap();
 const expected=(request,outcome)=>{
  const rule=requestObservation(classes,config.baseURL,request,outcome);if(!rule)return false;
  const prior=seen.get(request)||new Set();if(!prior.has(outcome)){cell.observations.push({kind:'external-request',classId:rule.id,owner:rule.owner,sameSiteException:exception(rule),reason:redact(rule.reason),outcome,method:request.method(),resourceType:request.resourceType(),url:redact(request.url()),port:new URL(request.url()).port||'default'});prior.add(outcome);seen.set(request,prior);}
  return true;
 };
 const navigations=new Map(),cancelled=new Set(),audited=new Set();
 const watch=page=>navigations.set(page,trackNavigations(page));
 if(typeof page.pages==='function'){for(const current of page.pages())watch(current);page.on('page',watch);}else watch(page);
 const auditCancellations=()=>{
  for(const request of cancelled){
   const receipt=[...navigations.values()].map(nav=>nav.cancellation(request)).find(Boolean);
   if(receipt){if(!audited.has(request)){cell.diagnostics.push({kind:'navigation-cancellation',...receipt,url:redact(receipt.url),replacement:redact(receipt.replacement),error:redact(receipt.error)});audited.add(request);}}
   else if(!expected(request,'cancelled')){const gap='unclassified cancelled request: '+redact(request.url());if(!cell.gaps.includes(gap))emit(gap,owner(request),request.url(),'gap',requestPage(request),failedAt.get(request));}
  }
 };
 const assetChecks=[];
 const audit=async()=>{for(let index=0;index<assetChecks.length;index++)await assetChecks[index];auditCancellations();};
 const owners=new WeakMap(),sourcePages=new WeakMap(),failedAt=new WeakMap();
 const requestPage=request=>sourcePages.get(request);
 const owner=request=>{if(owners.has(request))return owners.get(request);try{return documentOf(request.frame());}catch{return undefined;}};
 const emit=(message,document,resourceURL,severity='failure',sourcePage,at=performance.now())=>config.intentBoundaries?.get(sourcePage||page)?.runtimeAt<=at?cell.observations.push({kind:'post-intent-unjudged',message:redact(message),document}):finding(cell,message,{...config,document,resourceURL,severity,kind:'runtime',target:severity==='gap'?cell.gaps:failures});
 const foreign=request=>{const doc=owner(request);try{return doc?.origin&&doc.origin!=='null'&&doc.origin!==new URL(config.baseURL).origin&&new URL(request.url()).origin!==new URL(config.baseURL).origin;}catch{return false;}};
 const pending=new Set();page.on('request',request=>{let doc;try{doc=documentOf(request.frame());if(request.isNavigationRequest()){const url=new URL(request.url());doc={...doc,url:redact(url.href),origin:url.origin};}}catch{}owners.set(request,doc);try{sourcePages.set(request,request.frame().page());}catch{}pending.add(request);});
 page.on('console',message=>{
  if(!['error','warning'].includes(message.type()))return;
  const rule=message.type()==='warning'&&warningObservation(classes,config.baseURL,message);
  if(rule){cell.observations.push({kind:rule.kind,classId:rule.id,owner:rule.owner,sameSiteException:exception(rule),reason:redact(rule.reason),url:redact(message.location().url),message:redact(message.text()),outcome:'observed'});return;}
  const source=message.location();const surface=message.page?.()||(typeof page.pages==='function'?undefined:page);
  const matches=surface?.frames().filter(frame=>frame.url()===source.url)||[];
  const document=matches.length===1?documentOf(matches[0]):surface?.frames().length===1?documentOf(surface.mainFrame()):undefined;
  emit('console '+message.type()+' at '+redact(source.url||'[inline]')+':'+source.lineNumber+'; '+redact(message.text()),document,undefined,message.type()==='warning'?'gap':'failure',surface);
 });
 page.on('response',response=>{const at=performance.now();
  if(response.status()>=400)emit(`HTTP ${response.status()}: ${redact(response.url())}`,owner(response.request()),response.url(),'failure',requestPage(response.request()));
  const url=new URL(response.url());
  if(!config.assetHashes||url.origin!==new URL(config.baseURL).origin||!['script','stylesheet','font'].includes(response.request().resourceType()))return;
  const context=typeof page.pages==='function'?page:page.context();
  const expected=config.assetHashes[url.pathname],scope={flow:cell.screen,state:cell.state,engine:cell.engine,viewport:cell.size};
  if(!expected){emit('served build asset absent from manifest: '+redact(url.pathname),owner(response.request()),response.url(),'gap',requestPage(response.request()));return;}
  assetChecks.push(readBody(response,{retry:async()=>{const fresh=await context.request.get(response.url(),{timeout:2000,maxRetries:0});if(!fresh.ok())throw Error('fresh asset request HTTP '+fresh.status());return fresh.body();}}).then(result=>{
   if(result.reason){cell.diagnostics.push({...result,body:undefined,...scope});if(!result.navigationCancelled)emit('served asset body unverified: '+result.url+'; '+result.error,owner(response.request()),response.url(),'gap',requestPage(response.request()),at);}
   if(result.body&&createHash('sha256').update(result.body).digest('hex')!==expected)emit('served asset hash mismatch: '+redact(url.pathname),owner(response.request()),response.url(),'failure',requestPage(response.request()),at);
  }));
 });
 page.on('requestfailed',request=>{failedAt.set(request,performance.now());pending.delete(request);const error=request.failure()?.errorText||'';if(/ABORTED|cancelled|canceled/i.test(error))cancelled.add(request);else if(requestObservation(classes,config.baseURL,request))assetChecks.push(probe.wait(request).then(matched=>{if(!matched)emit('request failed: '+redact(request.url())+'; '+redact(error),owner(request),request.url(),'failure',requestPage(request),failedAt.get(request));}));else emit('request failed: '+redact(request.url())+'; '+redact(error),owner(request),request.url(),'failure',requestPage(request));});
 page.on('requestfinished',request=>{pending.delete(request);if(request.timing().responseEnd>Number(config.slowRequestMs||5000))emit('slow request: '+redact(request.url()),owner(request),request.url(),'failure',requestPage(request));});
 return {audit,auditCancellations,expectedCancellation:request=>expected(request,'cancelled'),async settle(){
  const deadline=Date.now()+2000;
  do{
   await new Promise(resolve=>setTimeout(resolve,25));
   for(const request of pending)if(foreign(request)||expected(request,'pending'))pending.delete(request);
   if(!pending.size)return true;
  }while(Date.now()<deadline&&!page.isClosed?.());
  for(const request of pending)emit('in-flight request unresolved after 2000 ms: '+request.method()+' '+redact(request.url()),owner(request),request.url(),'gap',requestPage(request));
  return false;
 }};
}

export async function verifyIdentity(adapter,options,identities){
 if(!adapter?.verifySession)throw Error('adapter.verifySession must verify the real session identity');
 const actual=await adapter.verifySession(options);
 if(!actual||typeof actual.id!=='string'||!actual.id.trim())throw Error('adapter.verifySession must return the verified identity id');
 const expected=identities?.get(options.engine);
 if(expected&&actual.id!==expected)throw Error('session identity differs from the real shared entry');
 identities?.set(options.engine,actual.id);
}
