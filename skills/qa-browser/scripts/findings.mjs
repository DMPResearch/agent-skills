import {redact} from './contract.mjs';
import {trackNavigations} from './navigation.mjs';
const ids=new WeakMap();let next=0;
export function documentOf(frame){
 if(!frame)return {id:'unknown',url:'unknown',origin:'unknown'};
 if(!ids.has(frame))ids.set(frame,'frame-'+(++next));
 const identity=trackNavigations(frame.page()).identity(frame),url=frame.url();let origin='unknown';try{origin=new URL(url).origin;}catch{}
 return {id:ids.get(frame)+':'+identity.generation,url:redact(url),origin};
}
export function finding(cell,message,{baseURL,document={id:'unknown',url:'unknown',origin:'unknown'},resourceURL,kind='check',phase='unknown',severity='failure',target}={}){
 let base,resourceOrigin;try{base=new URL(baseURL).origin;}catch{}try{resourceOrigin=new URL(resourceURL).origin;}catch{}
 const origin=document.origin||'unknown',foreign=Boolean(base&&origin!=='unknown'&&origin!=='null'&&origin!==base&&resourceOrigin!==base);
 const row={kind,message:redact(message),phase,document,origin,resourceURL:resourceURL?redact(resourceURL):undefined,scope:foreign?'third-party':base&&origin===base?'app':'unknown',severity,affectsVerdict:!foreign};
 cell.findings||=[];cell.findings.push(row);
 if(!foreign)(target|| (severity==='gap'?cell.gaps:cell.failures)).push(row.message);
 return row;
}
