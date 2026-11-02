import {redact} from './contract.mjs';

export function observeRuntime(page,cell,config={},failures=cell.failures){
 cell.diagnostics||=[];
 const pending=new Set();page.on('request',request=>pending.add(request));
 page.on('console',message=>{
  if(!['error','warning'].includes(message.type()))return;
  const source=message.location(),target=message.type()==='warning'?cell.gaps:failures;
  target.push('console '+message.type()+' at '+redact(source.url||'[inline]')+':'+source.lineNumber+'; '+redact(message.text()));
 });
 page.on('pageerror',error=>{
  const detail={kind:'pageerror',message:redact(error.message),stack:redact(error.stack||''),flow:cell.screen,state:cell.state,engine:cell.engine,viewport:cell.size};
  cell.diagnostics.push(detail);failures.push('uncaught page error: '+detail.message);
 });
 page.on('response',response=>{if(response.status()>=400)failures.push(`HTTP ${response.status()}: ${redact(response.url())}`);});
 page.on('requestfailed',request=>{pending.delete(request);const error=request.failure()?.errorText||'';if(!/ABORTED|cancelled|canceled/i.test(error))failures.push('request failed: '+redact(request.url())+'; '+redact(error));});
 page.on('requestfinished',request=>{pending.delete(request);if(request.timing().responseEnd>Number(config.slowRequestMs||5000))failures.push('slow request: '+redact(request.url()));});
 return {async settle(){
  const deadline=Date.now()+2000;
  do{
   await new Promise(resolve=>setTimeout(resolve,25));
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
