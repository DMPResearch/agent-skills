export const fullSizes=['360x640','390x660','412x620','412x660','390x844','430x932','344x880','755x1000','744x1133','820x1180','1024x768','1440x900'];
export const coreSizes=['390x660','412x620','390x844','820x1180','1440x900'];
export function matrix(tier='full') {
 const sizes=tier==='global'?['390x660','430x932','820x1180','1440x900']:tier==='full'?coreSizes:fullSizes;
 return ['chromium','webkit'].flatMap(engine=>['light','dark'].flatMap(theme=>sizes.map(size=>({engine,theme,size}))));
}
export function validate(c) {
 if(c.version!==1)throw Error('config version must be 1');
 if(!Array.isArray(c.flows)||!c.flows.length)throw Error('flows contract is required');
 if(!c.baseURL&&!c.start)throw Error('baseURL or start contract required');
 const ids=new Set();
 for(const f of c.flows){
  if(!f.id||ids.has(f.id)||!f.url||!f.entry||!Array.isArray(f.states)||!f.states.length||!Array.isArray(f.steps)||!Array.isArray(f.controls)||!Array.isArray(f.breaks))throw Error('invalid or duplicate flow contract');
  ids.add(f.id);
  if(typeof f.main!=='boolean')throw Error('flow main-screen ownership required');
  if(f.states.some(s=>typeof s!=='string'&&(!s.id||!Array.isArray(s.setup))))throw Error('invalid auth/data state');
  for(const control of f.controls)if(!control.selector||!Array.isArray(control.steps)||!['visible','hidden','text','url','count','value'].includes(control.steps.at(-1)?.action))throw Error('control requires selector and expected effect steps');
  for(const step of [...f.steps,...f.controls.flatMap(x=>x.steps),...f.breaks.flatMap(x=>x.steps||[])]){
   if(!['click','double-click','fill','press','select','check','reload','back','forward','visible','hidden','text','url','count','value'].includes(step.action))throw Error('unknown step action');
   if(!['reload','back','forward','url'].includes(step.action)&&!step.selector)throw Error('step selector required');
   if(['fill','select','press','text','url','value','count'].includes(step.action)&&step.value===undefined&&!step.env)throw Error('step value required');
  }
 }
 return c;
}
export function selectScope(flows,graph,globals=[]) {
 if(!graph)return flows.map(flow=>({flow,tier:'full',reason:['full run']}));
 const selected=new Map(), reverse=new Map();
 for(const g of [graph.base,graph.head])for(const [importer,deps]of Object.entries(g||{}))for(const dep of deps){const set=reverse.get(dep)||new Set();set.add(importer);reverse.set(dep,set);}
 const add=(flow,tier,reason)=>{if(selected.get(flow.id)?.tier!=='direct')selected.set(flow.id,{flow,tier,reason});};
 for(const file of graph.changed||[]){
  if(globals.includes(file))for(const f of flows.filter(f=>f.main))add(f,'global',[file,'global style/token']);
  const queue=[[file]],seen=new Set();let mapped=false;
  while(queue.length){const path=queue.shift(),last=path.at(-1);if(seen.has(last))continue;seen.add(last);
   for(const f of flows.filter(f=>f.entry===last)){add(f,'direct',path);mapped=true;}
   for(const importer of reverse.get(last)||[])queue.push([...path,importer]);
  }
  if(!mapped&&!globals.includes(file))for(const f of flows.filter(f=>f.main))add(f,'fallback',[file,'unresolved ownership: main-flow fallback']);
 }
 return [...selected.values()];
}
export function verdict(cells,gaps) {
 if(cells.some(c=>c.failures.length||c.critic==='fail'))return 'fail';
 if(gaps.length||!cells.length||cells.some(c=>!c.complete||c.critic!=='pass'))return 'incomplete';
 return 'pass';
}
export function redact(value) {
 return String(value).replace(/https?:\/\/[^\s"'<>]+/g,raw=>{try{const u=new URL(raw);return u.origin+u.pathname.split('/').map(p=>p.length>24?'[redacted]':p).join('/');}catch{return '[url]';}})
 .replace(/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/gi,'[email]')
 .replace(/\b(Bearer|Basic)\s+\S+/gi,'$1 [redacted]')
 .replace(/\b[A-Za-z0-9_+\/-]{28,}={0,2}\b/g,'[redacted]');
}
