import {probeErrors,probeErrorWindowMs} from './probe-errors.mjs';
import {finding,documentOf} from './findings.mjs';
import {randomUUID} from 'node:crypto';
import {redact} from './contract.mjs';
import {trackNavigations} from './navigation.mjs';

// Read-only listeners retain the emitting document before navigation can replace it.
export async function observeErrors(context,cell,failures=cell.failures,config={}){
 cell.diagnostics||=[];cell.observations||=[];const probe=probeErrors(context),pending=new Set();
 let phase='context',lastPage,frameNumber=0;
 const frames=new WeakMap(),documents=new WeakMap(),recent=[],fallbacks=new Set();
 const frameId=frame=>{if(!frames.has(frame))frames.set(frame,'frame-'+(++frameNumber));return frames.get(frame);};
 const location=(page,frame,document)=>{
  const navigation=page&&frame?trackNavigations(page).identity(frame):{generation:0,unknown:true};
  if(frame&&!document)document={...documentOf(frame),attribution:'caught lifecycle context'};
  if(navigation.url)navigation.url=redact(navigation.url);
  return {document:document||{id:'unknown',url:'unknown',attribution:'native event supplied no frame'},frame:frame?{id:frameId(frame),url:redact(frame.url()),main:frame===page.mainFrame()}:{id:'unknown'},navigation};
 };
 const append=(error,where,kind='pageerror',during=phase)=>{
  const detail={kind,message:redact(error.message||String(error)),stack:redact(error.stack||''),phase:during,flow:cell.screen,state:cell.state,engine:cell.engine,viewport:cell.size,...where};
  cell.diagnostics.push(detail);return detail;
 };
 const record=async(error,where,page,frame,during,at)=>{
  const detail=append(error,where,'pageerror',during);
  const matched=await probe.match(page,error,config,{frame,at});
  if(matched){const {request,rule,failedAt,errorAt}=matched;cell.observations.push({kind:'external-request',classId:rule.id,owner:rule.owner,reason:redact(rule.reason),outcome:'page-error',url:redact(request.url()),method:request.method(),resourceType:request.resourceType(),document:detail.document,message:detail.message,correlation:{failedAt,errorAt,windowMs:probeErrorWindowMs}});}
  else finding(cell,'uncaught page error: '+detail.message,{...config,document:detail.document,phase:detail.phase,kind:'pageerror',target:failures});
 };
 const retain=promise=>{pending.add(promise);promise.finally(()=>pending.delete(promise)).catch(()=>{});return promise;};
 const native=event=>{
  const at=Date.now(),page=event.page(),error=event.error(),message=String(error.message).replace(/^Error: /,''),during=phase;
  // WebKit omits init scripts on a newly created initial blank document.
  const initial=page&&!page.isClosed()&&page.frames().length===1&&page.url()==='about:blank'&&trackNavigations(page).identity(page.mainFrame()).generation===0;
  const where=initial?location(page,page.mainFrame(),{id:frameId(page.mainFrame())+':initial',url:'about:blank',origin:'null'}):location(page,undefined);
  const timer=setTimeout(()=>{
   fallbacks.delete(timer);
   if(recent.some(r=>r.page===page&&r.message===message&&Date.now()-r.time<250))return;
   retain(record(error,where,page,undefined,during,at));
  },50);fallbacks.add(timer);
 };
 context.on('page',page=>{lastPage=page;trackNavigations(page);});
 context.on('weberror',native);
 const binding='qaObserve'+randomUUID().replaceAll('-','');
 await context.exposeBinding(binding,async({page,frame},error)=>{
  const doc={id:frameId(frame)+':'+error.documentId,url:redact(error.url),origin:error.origin};documents.set(frame,doc);
  if(error.kind==='document')return;
  recent.push({page,message:error.message,time:Date.now()});if(recent.length>100)recent.shift();
  await retain(record(error,location(page,frame,doc),page,frame,phase,Date.now()));
 });
 await context.addInitScript(({binding})=>{
  const documentId=Math.random().toString(36).slice(2);
  const retain=error=>{
   const detail={message:String(error?.message??error),stack:[String(error?.name||'Error')+': '+String(error?.message??error),String(error?.stack||'')].join('\n'),documentId,url:location.href,origin:location.origin};
   // The callback can disappear during teardown. Never create an observer rejection.
   globalThis[binding](detail).catch(()=>{});
  };
  globalThis[binding]({kind:'document',documentId,url:location.href,origin:location.origin}).catch(()=>{});
  addEventListener('error',event=>{if(event.error)retain(event.error);});
  addEventListener('unhandledrejection',event=>retain(event.reason));
 },{binding});
 return {
  phase(value){phase=value;},
  caught(error,kind='caught-exception',page=lastPage){return append(error,location(page,page?.mainFrame(),page&&documents.get(page.mainFrame())),kind);},
  async finish(){if(fallbacks.size)await new Promise(r=>setTimeout(r,60));await Promise.all([...pending]);},
 };
}
