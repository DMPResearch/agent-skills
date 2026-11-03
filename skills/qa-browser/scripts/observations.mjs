import {sameSite,registrableDomain} from './sites.mjs';
/** @typedef {{hostname:string,reason:string}} SameSiteException */
/** @typedef {{prefix:string,suffix:string,maxSegmentLength:number}} SegmentPath */
/** @typedef {{origin?:string,hostnameSuffix?:string,scheme?:'https',path:string|SegmentPath,methods:('GET'|'HEAD'|'OPTIONS')[],resourceTypes:('fetch'|'xhr')[]}} RequestMatch */
/** @typedef {{sameSiteException?:SameSiteException,kind:'external-request',id:string,owner:string,reason:string,match:RequestMatch,outcomes:('pending'|'cancelled')[]}} ExternalObservation */
/** @typedef {{sameSiteException?:SameSiteException,kind:'expected-development-warning',id:string,owner:string,reason:string,source:{origin:string,paths:string[]},message:string}} DevelopmentWarning */
/** @typedef {ExternalObservation|DevelopmentWarning} ObservationClass */

const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const text=value=>typeof value==='string'&&value.trim().length>0;
function strict(value,keys,path){if(!object(value)||Object.keys(value).some(k=>!keys.includes(k)))throw Error(path+': send only the declared observation fields');}
function literalPath(value){return text(value)&&value.startsWith('/')&&!/[?*#]/.test(value);}
function origin(value,path){try{const u=new URL(value);if(!['http:','https:'].includes(u.protocol)||u.origin!==value)throw Error();return u;}catch{throw Error(path+': send an exact HTTP(S) origin without path or query');}}
function choices(value,allowed,path){if(!Array.isArray(value)||!value.length||value.some(x=>!allowed.includes(x))||new Set(value).size!==value.length)throw Error(path+': send a nonempty list from '+allowed.join(', '));}

/** Validate the sole flow observation wire contract. @param {ObservationClass[]|undefined} classes */
export function validateObservations(classes,{baseURL,serviceEnvironment},path='observations'){
 if(classes===undefined)return;
 if(!Array.isArray(classes)||classes.length>8)throw Error(path+': send at most eight narrow observation classes');
 if(!classes.length)return;
 const base=new URL(baseURL),ids=new Set();
 for(const [index,c]of classes.entries()){
  const at=path+'.'+index;
  strict(c,['kind','id','owner','reason','sameSiteException',...(c?.kind==='external-request'?['match','outcomes']:['source','message'])],at);
  if(!text(c.id)||!text(c.owner)||!text(c.reason)||ids.has(c.id))throw Error(at+': send a unique id, owner and reason');ids.add(c.id);
  if(c.kind==='external-request'){
   const m=c.match;strict(m,['origin','hostnameSuffix','scheme','path','methods','resourceTypes'],at+'.match');
   if(Boolean(m.origin)===Boolean(m.hostnameSuffix))throw Error(at+'.match: send exactly one origin or hostnameSuffix');
   if(m.origin){if(m.scheme||origin(m.origin,at+'.match.origin').origin===base.origin)throw Error(at+'.match.origin: observations cannot include the same origin as the app');}
   else if(m.scheme!=='https'||!/^\.(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(m.hostnameSuffix)||base.protocol==='https:'&&base.hostname.endsWith(m.hostnameSuffix))throw Error(at+'.match: send a label-bound external HTTPS hostnameSuffix excluding the app');
   if(typeof m.path==='string'){if(!literalPath(m.path))throw Error(at+'.match.path: send one exact absolute path, never a glob');}
   else{strict(m.path,['prefix','suffix','maxSegmentLength'],at+'.match.path');if(!literalPath(m.path.prefix)||!m.path.prefix.endsWith('/')||!literalPath(m.path.suffix)||!Number.isInteger(m.path.maxSegmentLength)||m.path.maxSegmentLength<1||m.path.maxSegmentLength>128)throw Error(at+'.match.path: send literal prefix/suffix around one bounded 1..128 character segment');}
   choices(m.methods,['GET','HEAD','OPTIONS'],at+'.match.methods');choices(m.resourceTypes,['fetch','xhr'],at+'.match.resourceTypes');choices(c.outcomes,['pending','cancelled'],at+'.outcomes');
  }else if(c.kind==='expected-development-warning'){
   strict(c.source,['origin','paths'],at+'.source');
   if(origin(c.source.origin,at+'.source.origin').origin===base.origin)throw Error(at+'.source.origin: expected warnings cannot include the same origin as the app');
   if(serviceEnvironment!=='development')throw Error(at+': expected-development-warning requires serviceEnvironment: development');
   if(!text(c.message)||!Array.isArray(c.source.paths)||!c.source.paths.length||c.source.paths.length>8||c.source.paths.some(p=>!literalPath(p)))throw Error(at+': send one exact warning message and exact source paths');
  }else throw Error(at+'.kind: send external-request or expected-development-warning');
  const target=c.kind==='external-request'?c.match.origin:c.source.origin,hostname=target?new URL(target).hostname:c.match.hostnameSuffix.slice(1);
  if(c.kind==='external-request'&&c.match.hostnameSuffix&&!registrableDomain(hostname))throw Error(at+'.match.hostnameSuffix: send a service domain below a known public suffix; unknown suffixes need an exact origin and sameSiteException');
  if(c.sameSiteException!==undefined){strict(c.sameSiteException,['hostname','reason'],at+'.sameSiteException');if(!target||c.sameSiteException.hostname!==hostname||!text(c.sameSiteException.reason))throw Error(at+'.sameSiteException: send an exact origin, its exact hostname and a reason for treating this same-site service as external');}
  if(!externalBoundary(c,base,{origin:target,hostname},Boolean(target)))throw Error(at+'.sameSiteException: same-site or unknown-suffix hosts have no proven external boundary; send an exact origin and {hostname,reason} explaining its separate ownership');
 }
}

function externalBoundary(rule,base,url,exact){
 if(url.origin===base.origin)return false;
 return sameSite(base,url)===false||Boolean(exact&&rule.sameSiteException?.hostname===url.hostname&&text(rule.sameSiteException.reason));
}

function pathMatches(path,rule){
 if(typeof rule==='string')return path===rule;
 if(!path.startsWith(rule.prefix)||!path.endsWith(rule.suffix))return false;
 const segment=path.slice(rule.prefix.length,path.length-rule.suffix.length);
 return segment.length>0&&segment.length<=rule.maxSegmentLength&&/^[a-z0-9_-]+$/i.test(segment);
}
/** @param {ObservationClass[]} classes */
export function requestObservation(classes,baseURL,request,outcome){
 if(!classes.length)return;
 const url=new URL(request.url());if(url.origin===new URL(baseURL).origin)return;
 const matches=classes.filter(c=>c.kind==='external-request'&&externalBoundary(c,new URL(baseURL),url,Boolean(c.match.origin))&&c.outcomes.includes(outcome)&&c.match.methods.includes(request.method())&&c.match.resourceTypes.includes(request.resourceType())&&
  (c.match.origin?url.origin===c.match.origin:url.protocol==='https:'&&url.hostname.endsWith(c.match.hostnameSuffix))&&pathMatches(url.pathname,c.match.path));
 return matches.length===1?matches[0]:undefined;
}
/** @param {ObservationClass[]} classes */
export function warningObservation(classes,baseURL,message){
 if(!classes.length)return;
 let source;try{source=new URL(message.location().url);}catch{return;}
 if(source.origin===new URL(baseURL).origin)return;
 const matches=classes.filter(c=>c.kind==='expected-development-warning'&&externalBoundary(c,new URL(baseURL),source,true)&&c.message===message.text()&&c.source.origin===source.origin&&c.source.paths.includes(source.pathname));
 return matches.length===1?matches[0]:undefined;
}
