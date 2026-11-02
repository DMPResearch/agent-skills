import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewPlan,applyBatch} from './review.mjs';

test('every state gets shortest-phone and widest-desktop full reads before sheets',()=>{
 const cells=['base','error'].flatMap(state=>['390x660','412x620','820x1180','1440x900'].map(size=>({id:state+size,screen:'preferences',state,engine:'chromium',theme:'dark',size,frames:[state+size+'.png']})));
 const plan=reviewPlan(cells,{framesPerBatch:28});assert.deepEqual(plan.gaps,[]);
 assert.deepEqual(plan.mandatory.flatMap(b=>b.frames.map(f=>f.path)).sort(),['base412x620.png','base1440x900.png','error412x620.png','error1440x900.png'].sort());
 assert.deepEqual(plan.sheets.flatMap(b=>b.frames.map(f=>f.path)).sort(),['base390x660.png','base820x1180.png','error390x660.png','error820x1180.png'].sort());
 assert.equal(new Set([...plan.mandatory,...plan.sheets].flatMap(b=>b.frames.map(f=>f.path))).size,8);
});

test('missing a mandatory desktop is a gap, and a rule without prose still flags',()=>{
 const plan=reviewPlan([{id:'phone',screen:'preferences',state:'base',engine:'webkit',theme:'light',size:'412x620',frames:['phone.png']}]);assert.ok(plan.gaps.some(g=>g.includes('desktop')));
 const result=applyBatch({frames:[{path:'one.png',screen:'preferences',state:'base',engine:'webkit',theme:'light'}]},{frames:[{path:'one.png',status:'pass',rules:['overlapping-controls'],failures:[]}]});assert.equal(result.status,'flagged');
});
