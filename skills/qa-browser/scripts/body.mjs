import {trackNavigations} from './navigation.mjs';
import {redact} from './contract.mjs';

export const bodyReadBoundMs=2000;
export async function readBody(response,{retry}={}){
 let navigation,associationError;
 try{navigation=trackNavigations(response.request().frame().page());}catch(error){associationError=redact(error.message);}
 let bodyError,timer,unsubscribe=()=>{};
 const diagnostic=(reason,error,navigationCancelled=false)=>({kind:'asset-body',url:redact(response.url()),reason,error:redact(error),navigationCancelled,...associationError?{associationError}:{}});
 let result;
 try{
  result=await Promise.race([
   response.body().then(body=>navigation?.bodyReplacementPending(response.request())?new Promise(()=>{}):{body},error=>{bodyError=error;return new Promise(()=>{});}),
   new Promise(resolve=>{if(navigation)unsubscribe=navigation.onBodyReplacement(response.request(),url=>resolve({...diagnostic('body read cancelled by navigation',bodyError?.message||'document replaced during declared navigation',true),destination:redact(url)}));}),
   new Promise(resolve=>{timer=setTimeout(()=>resolve(diagnostic(bodyError?'body read failed':'body read timed out',bodyError?.message||`body read exceeded ${bodyReadBoundMs} ms`)),bodyReadBoundMs);})
  ]);
 }catch(error){result=diagnostic('body read failed',error.message);}
 finally{clearTimeout(timer);unsubscribe();}
 if(result.reason==='body read timed out'&&retry){
  let retryTimer;
  try{
   const body=await Promise.race([retry(),new Promise((_,reject)=>{retryTimer=setTimeout(()=>reject(Error('fresh body read exceeded 2000 ms')),bodyReadBoundMs);})]);
   return {...result,body,recovered:true};
  }catch(error){result.retryError=redact(error.message);}
  finally{clearTimeout(retryTimer);}
 }
 return result;
}
