import {trackNavigations} from './navigation.mjs';
import {redact} from './contract.mjs';
import {readBody} from './body.mjs';
import {serviceRequestTraffic} from './service-traffic.mjs';
const shape=request=>{const u=new URL(request.url());return JSON.stringify([request.method(),u.origin,u.pathname,[...u.searchParams.keys()].sort()]);};
export function recordServiceResponses(context,baseURL){
 const rows=[],pending=new Set(),order=new WeakMap();let next=0;
 context.on('request',request=>order.set(request,next++));
 context.on('response',response=>{
  if(new URL(response.url()).origin===new URL(baseURL).origin)return;
  const promise=(async()=>{
   const headers=await response.allHeaders(),status=response.status();
   const result=status>=300&&status<400?{body:Buffer.alloc(0)}:await readBody(response);
   delete headers['content-encoding'];delete headers['content-length'];delete headers['transfer-encoding'];
   let mimeType=headers['content-type'];
   if(!mimeType&&result.body&&response.request().resourceType()==='document'&&status>=200&&status<300){
    const frame=response.request().frame();await frame.waitForURL(url=>url.href===response.url(),{waitUntil:'commit',timeout:2000});mimeType=await frame.evaluate(()=>document.contentType);
   }
   rows.push({mimeType,url:response.url(),cookies:await context.cookies([response.url()]),key:shape(response.request()),order:order.get(response.request()),status,headers,body:result.body});
  })();pending.add(promise);promise.finally(()=>pending.delete(promise)).catch(()=>{});
 });
 return {async snapshot(){await Promise.all([...pending]);return rows.slice().sort((a,b)=>a.order-b.order);}};
}
export function replayServiceResponses(boundary,context,rows,{cell,phase,baseURL,beforeReplay}){
 const used=new Set();let redirectVersion=0,lastRedirect;
 const navigation=async operation=>{const before=redirectVersion;try{await operation();}catch(error){if(before===redirectVersion)throw error;}if(before!==redirectVersion)await lastRedirect;};
 boundary.replay(async route=>{
  try{await beforeReplay?.();}catch(error){cell.gaps.push('fresh-load replay refused: '+redact(error.message));await route.abort('aborted');return;}
  const request=route.request(),key=shape(request),index=rows.findIndex((row,i)=>row.key===key&&!used.has(i));
  if(index<0){boundary.fail('request outside the recorded phase method/URL shape',request.url());await route.abort('aborted');return;}
  const row=rows[index];used.add(index);
  if(!row.body){cell.gaps.push('fresh-load layout not proven: recorded service response unavailable');await route.abort('aborted');return;}
  serviceRequestTraffic(context,request,'replayed');
  try{
   if(row.status>=300&&row.status<400){
    const request=route.request(),page=request.frame().page(),target=new URL(row.headers.location,row.url);
    if(!request.isNavigationRequest()||target.origin!==new URL(baseURL).origin||![301,302,303].includes(row.status)&&request.method()!=='GET')throw Error('recorded redirect cannot be replayed as a same-origin document navigation');
    cell.captureSource='service response replayed from real call in phase '+phase;await context.addCookies(row.cookies);
    redirectVersion++;let resolve,reject;lastRedirect=new Promise((yes,no)=>{resolve=yes;reject=no;});lastRedirect.catch(()=>{});
    await route.abort('aborted');
    trackNavigations(page).run(()=>page.goto(target.href,{waitUntil:'load'})).then(resolve,reject);return;
   }
   await route.fulfill({status:row.status,headers:row.headers,contentType:row.mimeType,body:row.body});cell.captureSource='service response replayed from real call in phase '+phase;
  }catch(error){cell.gaps.push('fresh-load layout not proven: '+redact(error.message));await route.abort('aborted').catch(()=>{});}
 });
 return {navigation};
}
