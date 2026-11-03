import {readFileSync} from 'node:fs';
import {runReview as nativeReview} from '../review.mjs';
export {reviewBatches,applyBatch,reviewPlan} from '../review.mjs';

// Fixture critics still judge image bytes; this models the CLI's public event stream.
export function imageEvents(prompt,judgments){
 const manifest=JSON.parse(readFileSync(prompt,'utf8').split('\n').at(-1)),events=[];let index=0;
 for(const [path,frames]of Object.entries(Object.groupBy(manifest,f=>f.readPath||f.path))){
  if(!readFileSync(path).subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')))throw Error('fixture critic did not open a PNG');
  const id='read-'+(++index);events.push({type:'assistant',message:{content:[{type:'tool_use',id,name:'Read',input:{file_path:path}}]}});
  events.push({type:'user',message:{content:[{type:'tool_result',tool_use_id:id,content:[{type:'image'}]}]}});
  events.push({type:'assistant',message:{content:[{type:'text',text:frames.map(f=>'FRAME '+JSON.stringify(judgments.find(j=>j.path===f.path))).join('\n')}]}});
 }
 return events;
}
export function auditedInvoke(invoke){return async(file,args,options)=>{
 const result=await invoke(file,args,options);if(result.code!==0)return result;
 let parsed;try{parsed=JSON.parse(result.stdout);if(parsed.result)parsed=JSON.parse(parsed.result);}catch{return result;}
 if(Array.isArray(parsed.frames))for(const event of imageEvents(args.at(-1).match(/^Read (.+) and return/)[1],parsed.frames))options.onEvent?.(event);
 return result;
};}
export function runReview(...args){if(args[5]?.invoke)args[5]={...args[5],invoke:auditedInvoke(args[5].invoke)};return nativeReview(...args);}
