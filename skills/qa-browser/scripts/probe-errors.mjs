import {requestObservation} from './observations.mjs';
const observers=new WeakMap();
export const probeErrorWindowMs=1000;
const urls=text=>String(text||'').match(/https?:\/\/[^\s"'<>]+/g)||[];
const mentions=(text,url)=>urls(text).some(token=>token===url||token.startsWith(url)&&/^[),.;\]]+$/.test(token.slice(url.length)));
export function probeErrors(context){
 if(observers.has(context))return observers.get(context);
 const failed=[],seen=new WeakMap(),statuses=new WeakMap(),accepted=new WeakSet(),workerPages=new WeakSet(),waiting=new Map();
 const watch=page=>{if(page.workers().length)workerPages.add(page);page.on('worker',()=>workerPages.add(page));};
 for(const page of context.pages())watch(page);context.on('page',watch);
 context.on('request',request=>{let page;try{page=request.frame().page();}catch{}const row={request,page,started:Date.now()};failed.push(row);seen.set(request,row);});
 context.on('response',response=>statuses.set(response.request(),response.status()));
 context.on('requestfailed',request=>{
  let page;try{page=request.frame().page();}catch{}
  const at=Date.now(),row=seen.get(request);if(row)row.at=at;while(failed[0]&&Math.max(failed[0].at||0,failed[0].started)<at-probeErrorWindowMs)failed.shift();
 });
 const observer={
  async match(page,error,config,{frame,at=Date.now()}={}){
   if(!page||!config.baseURL||!config.observations?.length||workerPages.has(page))return;
   const own=new URL(config.baseURL).origin;
   if(urls(String(error.stack||'').split('\n').slice(1).join('\n')).some(url=>{try{return new URL(url.replace(/[),.;\]]+$/,'')).origin===own;}catch{return false;}}))return;
   const deadline=Date.now()+100;
   do{
    const candidates=failed.filter(row=>row.page===page&&Math.abs(at-(row.at||row.started))<=probeErrorWindowMs&&mentions(error.message,row.request.url())&&requestObservation(config.observations,config.baseURL,row.request));
    if(candidates.length>1)return;
    if(candidates.length===1&&candidates[0].at&&Math.abs(at-candidates[0].at)<=probeErrorWindowMs&&!(statuses.get(candidates[0].request)>=400)){const {request,at:failedAt}=candidates[0],rule=requestObservation(config.observations,config.baseURL,request);accepted.add(request);for(const done of waiting.get(request)||[])done(true);waiting.delete(request);return {request,rule,failedAt,errorAt:at};}
    await new Promise(resolve=>setTimeout(resolve,5));
   }while(Date.now()<deadline);
  },
  wait(request){if(accepted.has(request))return Promise.resolve(true);return new Promise(resolve=>{const timer=setTimeout(()=>{waiting.get(request)?.delete(done);resolve(false);},200);const done=value=>{clearTimeout(timer);resolve(value);};const callbacks=waiting.get(request)||new Set();callbacks.add(done);waiting.set(request,callbacks);});}
 };
 observers.set(context,observer);return observer;
}
