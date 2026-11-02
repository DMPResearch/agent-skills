const trackers=new WeakMap();

// A URL match alone cannot prove why a request was cancelled.
export function trackNavigations(page){
 if(trackers.has(page))return trackers.get(page);
 const resources=new Map(),generations=new Map(),listeners=new Map();
 const pending=new Set(),cancelled=[],superseded=new Map(),committed=new Set(),latest=new Map(),scopes=[];
 page.on('request',r=>{
  try{const frame=r.frame();resources.set(r,{frame,generation:generations.get(frame)||0});}catch{}
  if(!r.isNavigationRequest()||r.resourceType()!=='document')return;
  const frame=r.frame(),scope=scopes.at(-1)?.requests;
  if(scope){
   for(const prior of scope)if(prior.frame()===frame&&prior!==r)superseded.set(prior,r);
   scope.add(r);
  }
  pending.add(r);latest.set(frame,r);
 });
 page.on('framenavigated',frame=>{
  const r=latest.get(frame);if(r&&r.url()===frame.url())committed.add(r);
  const scope=scopes.at(-1);
  const generation=(generations.get(frame)||0)+1;generations.set(frame,generation);
  if(scope&&(scope.requests.has(r)||scope.history))for(const [request,record]of resources){
   if(request===r||record.frame!==frame||record.generation>=generation||record.replacement)continue;
   record.replacement=frame.url();
   for(const callback of listeners.get(request)||[])callback(record.replacement);
  }
  if(scope?.history&&frame===page.mainFrame())scope.historyCommitted=true;
 });
 page.on('requestfinished',r=>pending.delete(r));
 page.on('requestfailed',r=>{
  pending.delete(r);
  if(/ABORTED|cancelled|canceled/i.test(r.failure()?.errorText||''))cancelled.push(r);
 });
 const tracker={
  bodyReplacementPending(request){
   const frame=resources.get(request)?.frame;
   return scopes.some(scope=>scope.history||[...scope.requests].some(r=>r!==request&&r.frame()===frame));
  },
  onBodyReplacement(request,callback){
   const record=resources.get(request);
   if(record?.replacement){callback(record.replacement);return ()=>{};}
   const callbacks=listeners.get(request)||new Set();callbacks.add(callback);listeners.set(request,callbacks);
   return ()=>{callbacks.delete(callback);if(!callbacks.size)listeners.delete(request);};
  },
  run:async(operation,{history=false}={})=>{
   const scope={requests:new Set(pending),history,candidates:[...pending],historyCommitted:false};scopes.push(scope);
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
  unclassified:()=>cancelled.filter(r=>!committed.has(superseded.get(r)))
 };
 trackers.set(page,tracker);return tracker;
}
