const states=flow=>flow.states.map(s=>typeof s==='string'?s:s.id);
export function validateCounterparts(config){
 for(const flow of config.flows){
  if(flow.authCounterparts===undefined)continue;
  if(!flow.authCounterparts||typeof flow.authCounterparts!=='object'||Array.isArray(flow.authCounterparts))throw Error('authCounterparts must map auth states to flow ids');
  for(const [state,id]of Object.entries(flow.authCounterparts)){
   const target=config.flows.find(f=>f.id===id);
   if(!['signed-in','signed-out'].includes(state)||typeof id!=='string'||id===flow.id||states(flow).includes(state)||!target||!states(target).includes(state)||!target.breaks.some(b=>b.kind===state&&!b.notApplicable&&(!b.state||b.state===state)&&b.safe&&b.target&&b.steps?.length))throw Error('auth counterpart must name another flow with the requested state and its real auth assertion');
  }
 }
}
export function resolveCounterparts(report,config){
 const flowFor=c=>config.flows.find(f=>f.id===c.screen),pending=c=>c.gaps.filter(g=>g.startsWith('auth counterpart pending: '));
 const target=(c,state)=>report.cells.find(t=>t.screen===flowFor(c)?.authCounterparts?.[state]&&t.state===state&&t.engine===c.engine&&t.theme===c.theme&&t.size===c.size);
 const valid=new Set(report.cells.filter(c=>!c.failures.length&&c.gaps.every(g=>g.startsWith('auth counterpart pending: '))&&c.controls.some(x=>x.break===c.state&&['pass','shared'].includes(x.status))&&(c.state!=='signed-in'||c.sessionVerified===true)));
 let changed;
 do{changed=false;for(const c of valid)if(pending(c).some(g=>!valid.has(target(c,g.slice('auth counterpart pending: '.length))))){valid.delete(c);changed=true;}}while(changed);
 for(const c of report.cells){
  const satisfied=pending(c).filter(g=>valid.has(target(c,g.slice('auth counterpart pending: '.length))));
  c.authCoverage=satisfied.map(g=>{const state=g.slice('auth counterpart pending: '.length),proof=target(c,state);return {state,flow:proof.screen,cell:proof.id,scope:'matching-matrix',status:'covered'};});
  c.gaps=c.gaps.filter(g=>!satisfied.includes(g));c.complete=c.gaps.length===0;
  if(c.functional)c.functional=c.failures.length?'fail':c.complete?'pass':'incomplete';
 }
}
