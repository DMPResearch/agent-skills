import {trackNavigations} from './navigation.mjs';
import {redact} from './contract.mjs';

// Diagnostic reads must fit inside the existing 10-second action and 60-second cell caps.
export const bodyReadBoundMs=2000;
export async function readBody(response){
 const request=response.request(),navigation=trackNavigations(request.frame().page());
 let bodyError;
 let timer,unsubscribe=()=>{};
 const diagnostic=(reason,error,navigationCancelled=false)=>({kind:'asset-body',url:redact(response.url()),reason,error:redact(error),navigationCancelled});
 try{
  return await Promise.race([
   response.body().then(body=>navigation.bodyReplacementPending(request)?new Promise(()=>{}):{body},error=>{bodyError=error;return new Promise(()=>{});}),
   new Promise(resolve=>{unsubscribe=navigation.onBodyReplacement(request,url=>resolve({...diagnostic('body read cancelled by navigation',bodyError?.message||'document replaced during declared navigation',true),destination:redact(url)}));}),
   new Promise(resolve=>{timer=setTimeout(()=>resolve(diagnostic(bodyError?'body read failed':'body read timed out',bodyError?.message||`body read exceeded ${bodyReadBoundMs} ms`)),bodyReadBoundMs);})
  ]);
 }finally{clearTimeout(timer);unsubscribe();}
}
