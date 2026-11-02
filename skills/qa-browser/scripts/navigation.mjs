// A URL match alone cannot prove why a request was cancelled.
export function trackNavigations(page){
 const pending=new Set(),cancelled=[],superseded=new Map(),committed=new Set(),latest=new Map(),scopes=[];
 page.on('request',r=>{
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
  if(scope?.history&&frame===page.mainFrame())scope.historyCommitted=true;
 });
 page.on('requestfinished',r=>pending.delete(r));
 page.on('requestfailed',r=>{
  pending.delete(r);
  if(/ABORTED|cancelled|canceled/i.test(r.failure()?.errorText||''))cancelled.push(r);
 });
 return {
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
}
