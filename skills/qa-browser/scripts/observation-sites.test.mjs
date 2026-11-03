import test from 'node:test';
import assert from 'node:assert/strict';
import {validateObservations,requestObservation,warningObservation} from './observations.mjs';
const request=match=>({kind:'external-request',id:'probe',owner:'Transport service',reason:'Background connectivity probe',match:{path:'/probe',methods:['GET'],resourceTypes:['fetch'],...match},outcomes:['pending','cancelled']});
const config=baseURL=>({baseURL,serviceEnvironment:'development'});
const warning=origin=>({kind:'expected-development-warning',id:'notice',owner:'Transport service',reason:'Known development notice',source:{origin,paths:['/sdk.js']},message:'Development transport active'});
const observed=url=>({url:()=>url,method:()=> 'GET',resourceType:()=> 'fetch'});

test('same-site sibling origins and narrower suffixes need a reasoned exact-host exception',()=>{
 for(const base of ['https://app.example.com','https://app.example.co.uk','https://app.www.ck','https://app.xn--bcher-kva.de']){
  const sibling=base.replace('app.','api.'),rule=request({origin:sibling}),suffix=request({hostnameSuffix:'.'+new URL(sibling).hostname,scheme:'https'});
  assert.throws(()=>validateObservations([rule],config(base)),/same.site|registrable/i);
  assert.throws(()=>validateObservations([suffix],config(base)),/same.site|registrable/i);
  assert.equal(requestObservation([rule],base,observed(sibling+'/probe'),'cancelled'),undefined,'runtime matching must retain the same boundary');
  const notice=warning(sibling);assert.throws(()=>validateObservations([notice],config(base)),/same.site|registrable/i);
  assert.equal(warningObservation([notice],base,{text:()=>notice.message,location:()=>({url:sibling+'/sdk.js'})}),undefined);
 }
});

test('an exact-host exception is explicit, justified, visible data and never includes the same origin',()=>{
 const base='https://app.example.co.uk',origin='https://identity.example.co.uk',exception={hostname:'identity.example.co.uk',reason:'Separately operated identity service shares the organizational domain'},rule={...request({origin}),sameSiteException:exception};
 validateObservations([rule],config(base));assert.equal(requestObservation([rule],base,observed(origin+'/probe'),'cancelled'),rule);
 for(const change of [{hostname:'other.example.co.uk',reason:exception.reason},{hostname:exception.hostname,reason:''}])assert.throws(()=>validateObservations([{...rule,sameSiteException:change}],config(base)),/sameSiteException/);
 assert.throws(()=>validateObservations([{...rule,match:{...rule.match,origin:base},sameSiteException:{...exception,hostname:'app.example.co.uk'}}],config(base)),/same.origin/);
 assert.throws(()=>validateObservations([{...rule,match:{...rule.match,origin:undefined,hostnameSuffix:'.identity.example.co.uk',scheme:'https'}}],config(base)),/same.site|exact|sameSiteException/i);
 const notice={...warning(origin),sameSiteException:exception};validateObservations([notice],config(base));assert.equal(warningObservation([notice],base,{text:()=>notice.message,location:()=>({url:origin+'/sdk.js'})}),notice);
});

test('independent registrants, private suffix tenants and unrelated IP addresses remain external',()=>{
 for(const [base,origin]of [['https://app.example.co.uk','https://api.other.co.uk'],['https://one.github.io','https://two.github.io'],['https://one.blogspot.com','https://two.blogspot.com'],['http://127.0.0.1:1234','http://127.0.0.2:5678']]){
  const rule=request({origin});validateObservations([rule],config(base));assert.equal(requestObservation([rule],base,observed(origin+'/probe'),'pending'),rule);
 }
 const suffix=request({hostnameSuffix:'.service.other.co.uk',scheme:'https'});validateObservations([suffix],config('https://app.example.co.uk'));assert.equal(requestObservation([suffix],'https://app.example.co.uk',observed('https://node.service.other.co.uk/probe'),'pending'),suffix);
 for(const base of ['http://localhost:1234','http://127.0.0.1:1234','http://[::1]:1234']){const origin=base.replace('1234','5678');assert.throws(()=>validateObservations([request({origin})],config(base)),/same.site|registrable/);}
});
