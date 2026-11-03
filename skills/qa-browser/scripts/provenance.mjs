import {readBody} from './body.mjs';
import {trackNavigations} from './navigation.mjs';
import {createHash} from 'node:crypto';

export function observeBuild(baseURL){
 const origin=new URL(baseURL).origin,assets=new Map(),pending=[],unreadable=new Set(),diagnostics=[];
 return {
  attach(context){context.on('page',trackNavigations);context.on('response',response=>{
   const url=new URL(response.url());
   if(url.origin!==origin||!response.ok()||!['document','script','stylesheet'].includes(response.request().resourceType()))return;
   pending.push(readBody(response).then(result=>{
    if(!result.body){diagnostics.push(result);if(!result.navigationCancelled)unreadable.add(url.pathname);return;}
    const body=result.body;const sha256=createHash('sha256').update(body).digest('hex');assets.set(url.pathname+'#'+sha256,{path:url.pathname,sha256});}));
  });},
  async finish(){
   await Promise.all(pending);
   const rows=[...assets.values()].sort((a,b)=>(a.path+a.sha256).localeCompare(b.path+b.sha256));
   return {kind:'served-content',observedAt:new Date().toISOString(),id:createHash('sha256').update(JSON.stringify(rows)).digest('hex'),assets:rows,unreadable:[...unreadable],diagnostics};
  }
 };
}

export function compareServedBuild(actual,expected,manifest={}){
 const failures=[],gaps=[];
 if(!expected?.assets?.length||!actual?.assets?.length||actual.unreadable?.length||expected.unreadable?.length)return {failures,gaps:['service build bytes unverified']};
 const baseline=new Map();for(const asset of expected.assets){const hashes=baseline.get(asset.path)||new Set();hashes.add(asset.sha256);baseline.set(asset.path,hashes);}
 for(const asset of actual.assets){const hashes=baseline.get(asset.path);if(hashes&&(hashes.size!==1||!hashes.has(asset.sha256)))failures.push('service build mismatch: '+asset.path);else if(!hashes&&manifest[asset.path]!==asset.sha256)gaps.push('service build asset unverified: '+asset.path);}
 return {failures,gaps};
}
