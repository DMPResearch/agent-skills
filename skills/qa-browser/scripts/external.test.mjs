import test from 'node:test';
import assert from 'node:assert/strict';
import {importCrawl} from './external.mjs';
const one={screen:'home',engine:'chromium',theme:'light',size:'390x660',path:'/tmp/a.png',failures:[]};
test('external capture checks exact matrix identity, unique frames and control evidence',()=>{
 const expected=[{screen:'home',engine:'chromium',theme:'light',size:'390x660'}];
 assert.throws(()=>importCrawl({results:[]},{expected}),/missing/);
 assert.throws(()=>importCrawl({results:[one,one]},{expected}),/duplicate/);
 assert.throws(()=>importCrawl({results:[one,{...one,screen:'unmapped',path:'/tmp/other.png'}]},{expected,checkFiles:false}),/unexpected/);
 const d=importCrawl({summary:{complete:true},results:[one],edges:[{screen:'home',engine:'chromium',theme:'light',width:390,height:660,controls:[]}],interactions:[]},{expected,checkFiles:false});
 assert.equal(d.cells[0].functional,'fail');
 for(const kind of ['empty','invalid','double-submit','refresh','back-forward','signed-out','signed-in'])assert.ok(d.cells[0].failures.some(f=>f.includes('missing break check: '+kind)));
 const checks=['empty','invalid','double-submit','refresh','back-forward','signed-out','signed-in'].map(kind=>({kind,pass:true}));
 const raw={summary:{complete:true},results:[one],edges:[{screen:'home',engine:'chromium',theme:'light',width:390,height:660,controls:[],checks}],interactions:[]};
 assert.equal(importCrawl(raw,{expected,checkFiles:false}).cells[0].functional,'pass');
 for(const kind of checks.map(c=>c.kind)){const edge={...raw.edges[0],checks:checks.filter(c=>c.kind!==kind)};assert.equal(importCrawl({...raw,edges:[edge]},{expected,checkFiles:false}).cells[0].functional,'fail');}
 const missing=importCrawl({summary:{complete:true},results:[one],edges:[],interactions:[]},{expected,checkFiles:false});assert.equal(missing.cells[0].functional,'fail');
});

test('runtime errors attach to their declared route, not every screen in a context',()=>{
 const expected=['home','settings'].map(screen=>({screen,engine:'chromium',theme:'light',size:'390x660'}));
 const results=expected.map((e,i)=>({...e,path:'/tmp/runtime-'+i+'.png',failures:[]}));
 const edges=expected.map(e=>({...e,width:390,height:660,controls:[],checks:['empty','invalid','double-submit','refresh','back-forward','signed-out','signed-in'].map(kind=>({kind,pass:true}))}));
 const error={engine:'chromium',theme:'light',width:390,height:660,url:'http://localhost/#home',type:'console',message:'HTTP failure'};
 const result=importCrawl({summary:{complete:true,firstPartyErrors:[error]},results,edges,interactions:[]},{expected,checkFiles:false});
 assert.ok(result.cells[0].failures.some(f=>f.includes('runtime error')));
 assert.deepEqual(result.cells[1].failures,[]);
 assert.equal(result.cells[0].functional,'fail');
 assert.equal(result.cells[1].functional,'pass');
});

test('imported break evidence must cover every reached target',()=>{
 const checks=['empty','invalid','double-submit','refresh','back-forward','signed-out','signed-in'].map(kind=>({kind,pass:true}));
 const expected=[one],edge={...one,width:390,height:660,forms:['#form'],inputs:['#email'],controls:[{selector:'#send'}],checks};
 const raw={summary:{complete:true},results:[one],edges:[edge],interactions:[{...edge,changed:true}]};
 const missing=importCrawl(raw,{expected,checkFiles:false});assert.equal(missing.cells[0].functional,'fail');assert.ok(missing.cells[0].failures.some(f=>f.includes('#email')));
 for(const target of ['#form','#email'])for(const kind of ['empty','invalid','double-submit','refresh'])checks.push({kind,target,pass:true});
 for(const kind of ['double-submit','refresh','back-forward'])checks.push({kind,target:'#send',pass:true});
 assert.equal(importCrawl(raw,{expected,checkFiles:false}).cells[0].functional,'pass');
});

test('no-change controls need observed chooser or explicit verified empty guard evidence',()=>{
 const expected=[one],checks=['empty','invalid','double-submit','refresh','back-forward','signed-out','signed-in'].map(kind=>({kind,pass:true}));
 const edge={...one,width:390,height:660,controls:[],checks},control={...edge,changed:false,label:'Action'};
 const run=effects=>importCrawl({summary:{complete:true},results:[one],edges:[edge],interactions:[{...control,effects}]},{expected,checkFiles:false}).cells[0].functional;
 assert.equal(run([]),'fail');
 control.changed=undefined;assert.equal(run([]),'fail');control.changed=false;assert.equal(run([{type:'file-chooser',observed:true}]),'pass');
 assert.equal(run([{type:'empty-guard',input:'#composer',empty:true,unchanged:true,noMutationRequests:true}]),'pass');
 assert.equal(run([{type:'empty-guard',input:'#composer',empty:true,unchanged:true}]),'fail');
});
