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
 assert.equal(d.cells[0].functional,'pass');
 const missing=importCrawl({summary:{complete:true},results:[one],edges:[],interactions:[]},{expected,checkFiles:false});assert.equal(missing.cells[0].functional,'fail');
});

test('runtime errors attach to their declared route, not every screen in a context',()=>{
 const expected=['home','settings'].map(screen=>({screen,engine:'chromium',theme:'light',size:'390x660'}));
 const results=expected.map((e,i)=>({...e,path:'/tmp/runtime-'+i+'.png',failures:[]}));
 const edges=expected.map(e=>({...e,width:390,height:660,controls:[]}));
 const error={engine:'chromium',theme:'light',width:390,height:660,url:'http://localhost/#home',type:'console',message:'HTTP failure'};
 const result=importCrawl({summary:{complete:true,firstPartyErrors:[error]},results,edges,interactions:[]},{expected,checkFiles:false});
 assert.ok(result.cells[0].failures.some(f=>f.includes('runtime error')));
 assert.deepEqual(result.cells[1].failures,[]);
 assert.equal(result.cells[0].functional,'fail');
 assert.equal(result.cells[1].functional,'pass');
});
