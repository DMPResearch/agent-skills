import test from 'node:test';
import assert from 'node:assert/strict';
import {validate} from './contract.mjs';
import {resolveCounterparts} from './counterparts.mjs';
const flow=(id,state,counterpart)=>({id,url:'/'+id,entry:id+'.js',main:true,states:[state],steps:[],controls:[],breaks:[{kind:state,target:'body',safe:true,steps:[{action:'visible',selector:'body'}]}],authCounterparts:{[state==='signed-in'?'signed-out':'signed-in']:counterpart}});
const flows=[flow('public','signed-out','private'),flow('private','signed-in','public')];
const cell=(screen,state)=>({screen,state,engine:'chromium',theme:'light',size:'390x660',failures:[],gaps:['auth counterpart pending: '+(state==='signed-in'?'signed-out':'signed-in')],controls:[{break:state,status:'pass'}],sessionVerified:state==='signed-in',complete:false});
test('counterpart coverage needs the actual matching matrix, successful state assertions and verified identity',()=>{
 validate({version:1,baseURL:'http://localhost',flows});
 for(const variant of ['complete','absent','wrong-size','dead-session','failed-assertion','other-gap']){
  const cells=[cell('public','signed-out'),cell('private','signed-in')];
  if(variant==='absent')cells.pop();if(variant==='wrong-size')cells[1].size='1440x900';
  if(variant==='dead-session')cells[1].sessionVerified=false;if(variant==='failed-assertion')cells[1].controls[0].status='fail';if(variant==='other-gap')cells[1].gaps.push('capture missing');
  const report={cells,gaps:[]};resolveCounterparts(report,{flows});
  assert.equal(cells[0].complete,variant==='complete',variant);
  assert.equal(cells[0].gaps.length===0,variant==='complete',variant);
 }
});
test('counterpart declarations cannot point to a missing flow or one without the requested state',()=>{
 assert.throws(()=>validate({version:1,baseURL:'http://localhost',flows:[flows[0]]}),/counterpart/);
 assert.throws(()=>validate({version:1,baseURL:'http://localhost',flows:[flows[0],flow('private','signed-out','public')]}),/counterpart/);
});
