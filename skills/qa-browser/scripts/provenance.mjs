import {createHash} from 'node:crypto';

export function observeBuild(baseURL){
 const origin=new URL(baseURL).origin,assets=new Map(),pending=[],unreadable=new Set();
 return {
  attach(context){context.on('response',response=>{
   const url=new URL(response.url());
   if(url.origin!==origin||!response.ok()||!['document','script','stylesheet'].includes(response.request().resourceType()))return;
   pending.push(response.body().then(body=>{const sha256=createHash('sha256').update(body).digest('hex');assets.set(url.pathname+'#'+sha256,{path:url.pathname,sha256});}).catch(()=>unreadable.add(url.pathname)));
  });},
  async finish(){
   await Promise.all(pending);
   const rows=[...assets.values()].sort((a,b)=>(a.path+a.sha256).localeCompare(b.path+b.sha256));
   return {kind:'served-content',observedAt:new Date().toISOString(),id:createHash('sha256').update(JSON.stringify(rows)).digest('hex'),assets:rows,unreadable:[...unreadable]};
  }
 };
}
