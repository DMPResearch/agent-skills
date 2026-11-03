import {redact} from './contract.mjs';
import {validateObservations,requestObservation,warningObservation} from './observations.mjs';

export function observeRuntime(page,cell,config={},failures=cell.failures){
 cell.diagnostics||=[];cell.observations||=[];
 const classes=config.observations||[];validateObservations(classes,config);
 const seen=new WeakMap();
 const expected=(request,outcome)=>{
  const rule=requestObservation(classes,config.baseURL,request,outcome);if(!rule)return false;
  const prior=seen.get(request)||new Set();if(!prior.has(outcome)){cell.observations.push({kind:'external-request',classId:rule.id,owner:rule.owner,reason:redact(rule.reason),outcome,method:request.method(),resourceType:request.resourceType(),url:redact(request.url()),port:new URL(request.url()).port||'default'});prior.add(outcome);seen.set(request,prior);}
  return true;
 };
 const pending=new Set();page.on('request',request=>pending.add(request));
 page.on('console',message=>{
  if(!['error','warning'].includes(message.type()))return;
  const rule=message.type()==='warning'&&warningObservation(classes,config.baseURL,message);
  if(rule){cell.observations.push({kind:rule.kind,classId:rule.id,owner:rule.owner,reason:redact(rule.reason),url:redact(message.location().url),message:redact(message.text()),outcome:'observed'});return;}
  const source=message.location(),target=message.type()==='warning'?cell.gaps:failures;
  target.push('console '+message.type()+' at '+redact(source.url||'[inline]')+':'+source.lineNumber+'; '+redact(message.text()));
 });
 page.on('response',response=>{if(response.status()>=400)failures.push(`HTTP ${response.status()}: ${redact(response.url())}`);});
 page.on('requestfailed',request=>{pending.delete(request);const error=request.failure()?.errorText||'';if(!/ABORTED|cancelled|canceled/i.test(error))failures.push('request failed: '+redact(request.url())+'; '+redact(error));});
 page.on('requestfinished',request=>{pending.delete(request);if(request.timing().responseEnd>Number(config.slowRequestMs||5000))failures.push('slow request: '+redact(request.url()));});
 return {expectedCancellation:request=>expected(request,'cancelled'),async settle(){
  const deadline=Date.now()+2000;
  do{
   await new Promise(resolve=>setTimeout(resolve,25));
   for(const request of pending)if(expected(request,'pending'))pending.delete(request);
   if(!pending.size)return true;
  }while(Date.now()<deadline&&!page.isClosed());
  for(const request of pending)cell.gaps.push('in-flight request unresolved after 2000 ms: '+request.method()+' '+redact(request.url()));
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
