import test from 'node:test';
import assert from 'node:assert/strict';
import {selectScope, matrix, verdict, validate} from './contract.mjs';
const flow = {id:'home',url:'/',entry:'src/home.js',main:true,states:['out'],steps:[],controls:[],breaks:[]};
test('rejects absent flow contract instead of reporting green',()=>{
 assert.throws(()=>validate({version:1,baseURL:'http://localhost:1234'}),/flows/);
});
test('direct PR ownership uses importer paths and full matrix',()=>{
 const scope=selectScope([flow],{changed:['src/button.js'],head:{'src/home.js':['src/button.js']},base:{}},[]);
 assert.deepEqual(scope[0].reason,['src/button.js','src/home.js']);
 assert.equal(matrix(scope[0].tier).length,48);
});
test('deleted dependency uses base graph; unresolved files fall back to all main screens',()=>{
 assert.equal(selectScope([flow],{changed:['old.js'],head:{},base:{'src/home.js':['old.js']}},[])[0].tier,'direct');
 assert.equal(selectScope([flow],{changed:['unknown.js'],head:{},base:{}},[])[0].tier,'fallback');
});
test('global changes sample all main screens; direct overlap wins',()=>{
 const other={...flow,id:'other',entry:'src/other.js'};
 const scope=selectScope([flow,other],{changed:['tokens.css','src/home.js'],head:{},base:{}},['tokens.css']);
 assert.equal(scope.find(x=>x.flow.id==='home').tier,'direct');
 assert.equal(matrix(scope.find(x=>x.flow.id==='other').tier).length,16);
});
test('missing critique, incomplete cells and failed functional checks cannot pass',()=>{
 assert.equal(verdict([{failures:[],complete:true,critic:'pass'}],[]),'pass');
 assert.equal(verdict([{failures:[],complete:true}],[]),'incomplete');
 assert.equal(verdict([{failures:[],complete:false,critic:'pass'}],[]),'incomplete');
 assert.equal(verdict([{failures:['dead control'],complete:true,critic:'pass'}],[]),'fail');
 assert.equal(verdict([],['missing flows']),'incomplete');
});
