import {readFileSync} from 'node:fs';
import {domainToASCII} from 'node:url';
import {isIP} from 'node:net';

// Public Suffix List format, including its private section and wildcard exceptions.
const exact=new Set(),wildcard=new Set(),exceptions=new Set();
for(const line of readFileSync(new URL('../references/public-suffix-list.dat',import.meta.url),'utf8').split('\n')){
 const rule=line.trim().split(/\s/)[0];if(!rule||rule.startsWith('//'))continue;
 const marker=rule.startsWith('!')?'!':rule.startsWith('*.')?'*.':'';
 const normalized=domainToASCII(rule.slice(marker.length));
 (marker==='!'?exceptions:marker==='*.'?wildcard:exact).add(normalized);
}
export function registrableDomain(hostname){
 const host=domainToASCII(hostname.toLowerCase().replace(/\.$/,''));
 if(!host||isIP(host.replace(/^\[|\]$/g,''))||!host.includes('.'))return;
 const labels=host.split('.');let suffix=0;
 for(let index=0;index<labels.length;index++){
  const candidate=labels.slice(index).join('.'),length=labels.length-index;
  if(exceptions.has(candidate)){suffix=length-1;break;}
  if(exact.has(candidate))suffix=Math.max(suffix,length);
  if(index>0&&wildcard.has(candidate))suffix=Math.max(suffix,length+1);
 }
 if(suffix>0&&labels.length>suffix)return labels.slice(-suffix-1).join('.');
}
/** Unknown suffixes cannot establish that two sites are different. @returns {boolean|undefined} */
export function sameSite(a,b){
 const key=hostname=>{const host=domainToASCII(hostname.toLowerCase().replace(/\.$/,''));return registrableDomain(host)||(isIP(host.replace(/^\[|\]$/g,''))||host==='localhost'?host:undefined);};
 const left=key(a.hostname),right=key(b.hostname);
 if(left!==undefined&&right!==undefined)return left===right;
}
