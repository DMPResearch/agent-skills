import {redact} from './contract.mjs';
const assertions=new Set(['visible','hidden','text','url','count','value']);
const stateOf=(flow,id)=>flow.states.find(s=>(typeof s==='string'?s:s.id)===id);
const entrySteps=(flow,state)=>[...(typeof state==='object'?state.setup||[]:[]),...flow.steps];
const handoffs=(flow,state)=>[...entrySteps(flow,state),...flow.controls.flatMap(c=>c.steps),...flow.breaks.filter(b=>(!b.state||b.state===state.id)&&(!['signed-out','signed-in'].includes(b.kind)||b.kind===state.id)).flatMap(b=>b.steps||[])].filter(s=>s.action==='handoff');
const gap=target=>'return path not proven: '+redact(target);
export function validateReturnPaths(config){
 for(const flow of config.flows)for(const state of flow.states)for(const step of handoffs(flow,typeof state==='string'?{id:state}:state)){
  if(step.returnPath===undefined)continue;
  const proof=step.returnPath,target=config.flows.find(f=>f.id===proof?.flow),targetState=target&&stateOf(target,proof.state);
  if(!proof||typeof proof!=='object'||Array.isArray(proof)||Object.keys(proof).some(k=>!['flow','state'].includes(k))||!target||!targetState||target.id===flow.id||new URL(target.url,config.baseURL||config.start.url).origin!==new URL(config.baseURL||config.start.url).origin||!assertions.has(entrySteps(target,targetState).at(-1)?.action))throw Error('handoff returnPath must name another own-origin flow and declared state with a final entry assertion');
 }
}
export function declareReturnPaths(cell,flow,state){
 const steps=handoffs(flow,state);if(!steps.length)return;
 cell.returnPaths=[...new Map(steps.map(s=>[JSON.stringify([s.selector,s.origin,s.returnPath]),{control:s.selector,providerOrigin:s.origin,proof:s.returnPath,status:'unrun',departure:false}])).values()];
 for(const row of cell.returnPaths)if(!cell.gaps.includes(gap(row.control)))cell.gaps.push(gap(row.control));
}
export function recordDepartures(cell,items,effects){
 for(const step of items.filter(s=>s.action==='handoff'))if(effects.some(e=>e.type==='handoff'&&e.origin===step.origin))for(const row of cell.returnPaths||[])if(row.control===step.selector&&row.providerOrigin===step.origin&&JSON.stringify(row.proof)===JSON.stringify(step.returnPath)){row.departure=true;row.status='departure-only';}
}
export function recordReturnEntry(cell,page,flow,state,config){
 const expected=new URL(flow.url,config.baseURL),actual=new URL(page.url());
 if(expected.origin===new URL(config.baseURL).origin&&actual.origin===expected.origin&&actual.pathname===expected.pathname&&assertions.has(entrySteps(flow,state).at(-1)?.action))cell.returnPathEntry={route:redact(actual.origin+actual.pathname),verified:true};
}
export function resolveReturnPaths(report,config){
 for(const cell of report.cells){
  if(!cell.returnPaths){const flow=config.flows.find(f=>f.id===cell.screen);if(flow)declareReturnPaths(cell,flow,{id:cell.state});}
  for(const row of cell.returnPaths||[]){
   row.status=row.departure?'departure-only':'unrun';delete row.proofCell;delete row.route;if(!cell.gaps.includes(gap(row.control)))cell.gaps.push(gap(row.control));
   if(!row.departure||!row.proof)continue;
   const target=config.flows.find(f=>f.id===row.proof.flow),proof=report.cells.find(c=>c.screen===target?.id&&c.state===row.proof.state&&c.engine===cell.engine&&c.theme===cell.theme&&c.size===cell.size);
   if(!proof)continue;
   row.proofCell=proof.id;
   if(proof.failures.length){row.status='fail';const failure='return path failed: '+redact(row.control)+' via '+redact(proof.screen)+' state '+redact(proof.state);if(!cell.failures.includes(failure))cell.failures.push(failure);continue;}
   if(proof.gaps.length||!proof.complete||!proof.frames.includes(proof.entryFrame)||!proof.returnPathEntry?.verified||proof.state==='signed-in'&&!proof.sessionVerified)continue;
   row.status='proven';row.route=proof.returnPathEntry.route;
  }
  for(const target of new Set((cell.returnPaths||[]).map(r=>r.control)))if(cell.returnPaths.filter(r=>r.control===target).every(r=>r.status==='proven'))cell.gaps=cell.gaps.filter(g=>g!==gap(target));
  cell.complete=cell.gaps.length===0;if(cell.functional)cell.functional=cell.failures.length?'fail':cell.complete?'pass':'incomplete';
 }
}
