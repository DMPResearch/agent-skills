const trackers=new WeakMap();

// A URL match alone cannot prove why a request was cancelled.
export function trackNavigations(page){
 if(trackers.has(page))return trackers.get(page);
 const resources=new Map(),generations=new Map(),listeners=new Map();
 const pending=new Set(),cancelled=[],superseded=new Map(),committed=new Set(),latest=new Map(),scopes=[];
 page.on('request',r=>{
  try{const frame=r.frame();resources.set(r,{frame,generation:generations.get(frame)||0,active:true});}catch{}
  if(!r.isNavigationRequest()||r.resourceType()!=='document')return;
  const frame=r.frame(),scope=scopes.at(-1)?.requests;
  if(scope){
   for(const prior of scope)if(prior.frame()===frame&&prior!==r)superseded.set(prior,r);
   scope.add(r);
  }
  pending.add(r);latest.set(frame,r);
 });
 page.on('framenavigated',frame=>{
  const r=latest.get(frame),scope=scopes.at(-1);
  const newDocument=r&&!committed.has(r)&&r.url()===frame.url();
  const historyBlank=scope?.history&&frame===page.mainFrame()&&frame.url()==='about:blank'&&r?.url()!=='about:blank';
  if(!newDocument&&!historyBlank)return;
  if(newDocument)committed.add(r);
  const generation=(generations.get(frame)||0)+1;generations.set(frame,generation);
  if(scope&&(newDocument&&scope.requests.has(r)||historyBlank))for(const [request,record]of resources){
   if(request===r||record.frame!==frame||record.generation>=generation||record.replacement)continue;
   if(record.active)record.replacement=frame.url();
   if(record.active||scope.active.has(request)){record.bodyReplacement=frame.url();for(const callback of listeners.get(request)||[])callback(record.bodyReplacement);}
  }
  if(scope?.history&&frame===page.mainFrame()){scope.historyCommitted=true;scope.destination=frame.url();}
 });
 page.on('requestfinished',r=>{pending.delete(r);const record=resources.get(r);if(record)record.active=false;});
 page.on('requestfailed',r=>{
  pending.delete(r);const record=resources.get(r);if(record)record.active=false;
  if(/ABORTED|cancelled|canceled/i.test(r.failure()?.errorText||''))cancelled.push(r);
 });
 const cancellation=request=>{
  if(!cancelled.includes(request))return;
  const record=resources.get(request),replacement=record?.replacement||(committed.has(superseded.get(request))?(superseded.get(request).destination||superseded.get(request).url()):undefined);
  if(replacement)return {url:request.url(),error:request.failure()?.errorText||'',replacement,generation:record?.generation,reason:'request cancelled by committed tool document replacement'};
 };
 const tracker={
  identity:frame=>({generation:generations.get(frame)||0,url:frame.url()}),
  bodyReplacementPending(request){
   const frame=resources.get(request)?.frame;
   return scopes.some(scope=>[...scope.requests].some(r=>r!==request&&!committed.has(r)&&r.frame()===frame));
  },
  onBodyReplacement(request,callback){
   const record=resources.get(request);
   if(record?.bodyReplacement){callback(record.bodyReplacement);return ()=>{};}
   const callbacks=listeners.get(request)||new Set();callbacks.add(callback);listeners.set(request,callbacks);
   return ()=>{callbacks.delete(callback);if(!callbacks.size)listeners.delete(request);};
  },
  run:async(operation,{history=false}={})=>{
   const scope={active:new Set([...resources].filter(([,r])=>r.active).map(([request])=>request)),requests:new Set(pending),history,candidates:[...pending],historyCommitted:false};scopes.push(scope);
   try{
    const result=await operation();
    // History can commit a cached document or about:blank without a new request.
    if(scope.historyCommitted){
     committed.add(scope);
     for(const prior of scope.candidates)if(prior.frame()===page.mainFrame())superseded.set(prior,scope);
    }
    return result;
   }finally{scopes.splice(scopes.indexOf(scope),1);}
  },
  cancellation,
  cancellations:()=>cancelled.map(cancellation).filter(Boolean),
  unclassified:()=>cancelled.filter(r=>!cancellation(r))

 };
 trackers.set(page,tracker);return tracker;
}
