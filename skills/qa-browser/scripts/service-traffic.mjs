const traffic=new WeakMap();
export function serviceRequestTraffic(context,request,kind){const data=traffic.get(context);if(!data||data.seen.has(request))return;data.seen.add(request);data.row[kind]++;data.report.serviceTraffic[kind]++;}
export function observeServiceTraffic(context,report,{baseURL,phase,cell,engine,state,onLimit}){
 report.serviceTraffic||={total:0,intercepted:0,serviceActions:0,replayed:0,contexts:[]};
 const row={phase,cell,engine,state,total:0,intercepted:0,serviceActions:0,replayed:0,origins:{},methods:{},resourceTypes:{}};report.serviceTraffic.contexts.push(row);traffic.set(context,{row,report,seen:new WeakSet()});
 context.on('request',request=>{const url=new URL(request.url());if(!['https:','http:'].includes(url.protocol)||url.origin===new URL(baseURL).origin)return;row.total++;report.serviceTraffic.total++;for(const [key,value]of [['origins',url.origin],['methods',request.method()],['resourceTypes',request.resourceType()]])row[key][value]=(row[key][value]||0)+1;});
 context.on('response',response=>{const url=new URL(response.url());if(url.origin!==new URL(baseURL).origin&&[429,500,502].includes(response.status())){row.limit={origin:url.origin,status:response.status(),requestsAtStop:row.total};onLimit?.(row.limit);}});
 return row;
}
