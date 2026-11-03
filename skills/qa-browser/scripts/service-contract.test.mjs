import test from 'node:test';
import assert from 'node:assert/strict';
import {validate} from './contract.mjs';
const control={selector:'#send',safe:true,service:true,name:'Send',role:'button',serviceRequest:{origin:'https://service.example.net',method:'POST'},steps:[{action:'click',selector:'#send'},{action:'visible',selector:'output'}]};
const flow={id:'entry',entry:'entry.js',main:true,url:'/',states:['signed-out'],steps:[],controls:[control],breaks:[]};
const config={version:1,baseURL:'https://app.example.org',flows:[flow],servicePhase:{size:'390x660',theme:'light',limiter:'write',cellLimiter:'load'},serviceIntervals:{write:1,load:1}};
test('service intent requires an exact external origin and method',()=>{
 assert.doesNotThrow(()=>validate(config));
 for(const request of [undefined,{origin:config.baseURL,method:'POST'},{origin:'https://service.example.net/path',method:'POST'},{origin:'https://service.example.net',method:'post'}])assert.throws(()=>validate({...config,flows:[{...flow,controls:[{...control,serviceRequest:request}]}]}),/serviceRequest/);
});
test('post-service entries must name a declared own-origin state without a preparation cycle',()=>{
 const target={...flow,id:'code',url:'/code',controls:[]},recipe={...control,postState:{flow:'code',state:'signed-out'}};
 assert.doesNotThrow(()=>validate({...config,flows:[{...flow,controls:[recipe]},target]}));
 assert.throws(()=>validate({...config,flows:[{...flow,controls:[{...recipe,postState:{flow:'code',state:'missing'}}]},target]}),/postState/);
 assert.throws(()=>validate({...config,flows:[{...flow,controls:[recipe]},{...target,controls:[{...control,postState:{flow:'entry',state:'signed-out'}}]}]}),/cycle/);
});
