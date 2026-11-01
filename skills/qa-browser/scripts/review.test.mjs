import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewBatches,applyBatch} from './review.mjs';
const cells=Array.from({length:20},(_,i)=>({id:'cell-'+i,screen:'screen-'+Math.floor(i/5),engine:i<10?'chromium':'webkit',theme:i%2?'dark':'light',size:'390x660',frames:['frame-'+i+'.png'],failures:[],gaps:[],complete:true}));
test('review sheets are bounded and never mix engines or themes',()=>{
 const batches=reviewBatches(cells,{screensPerBatch:2,framesPerSheet:8});
 assert.deepEqual(batches.flatMap(b=>b.frames.map(f=>f.path)).sort(),cells.flatMap(c=>c.frames).sort());
 for(const b of batches){assert.ok(new Set(b.frames.map(f=>f.engine)).size===1);assert.ok(new Set(b.frames.map(f=>f.theme)).size===1);assert.ok(b.sheets.every(s=>s.length<=8));}
});
test('batch verdict requires exact coverage; flagged screens need full-size follow-up',()=>{
 const batch=reviewBatches(cells.slice(0,3),{screensPerBatch:8})[0];
 assert.throws(()=>applyBatch(batch,{frames:[]}),/coverage/);
 const frames=batch.frames.map(f=>({path:f.path,status:'pass',failures:[]}));
 assert.equal(applyBatch(batch,{frames}).status,'pass');
 frames[0]={...frames[0],status:'fail',failures:['Overlapping controls']};
 const result=applyBatch(batch,{frames});assert.equal(result.status,'flagged');assert.ok(result.flaggedScreens.includes(batch.frames[0].screen));
 assert.throws(()=>applyBatch(batch,{frames:[...frames,frames[0]]}),/coverage/);
});

test('real sheets review sequentially, retry once and resolve flagged screens at full size',{skip:!process.env.QA_PW_PATH},async()=>{
 const {createRequire}=await import('node:module');
 const {mkdtempSync,readFileSync,rmSync}=await import('node:fs');
 const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const {runReview}=await import('./review.mjs');
 const pw=createRequire(process.env.QA_PW_PATH)('playwright'),browser=await pw.chromium.launch(),out=mkdtempSync(join(tmpdir(),'qa-review-'));
 try{
  const page=await browser.newPage({viewport:{width:390,height:660}});await page.setContent('<h1>Settings</h1>');
  const path=join(out,'frame.png');await page.screenshot({path});await page.close();
  const report={cells:[{id:'one',screen:'settings',engine:'chromium',theme:'light',size:'390x660',frames:[path],failures:[],gaps:[],complete:true}],gaps:[],sheets:[]};
  let calls=0,active=0;
  await runReview(report,{designRules:['AGENTS.md']},out,out,browser,{invoke:async(file,args)=>{
   active++;assert.equal(active,1);calls++;
   await new Promise(r=>setTimeout(r,5));active--;
   if(calls===1)return {code:124,stdout:''};
   const promptPath=args.at(-1).match(/^Read (.+) and return/)[1];
   const manifest=JSON.parse(readFileSync(promptPath,'utf8').split('\n').at(-1));
   return {code:0,stdout:JSON.stringify({frames:manifest.map(f=>({path:f.path,status:calls===2?'inspect':'pass',failures:calls===2?['Small text requires full-size check']:[]}))})};
  }});
  const ledger=JSON.parse(readFileSync(join(out,'review-ledger.json')));assert.ok(ledger.batches.every(b=>b.frames.includes(path)));
  assert.equal(calls,3);assert.equal(report.review.complete,true);assert.equal(report.cells[0].critic,'pass');
  assert.equal(report.review.batches[0].attempts.length,2);assert.equal(report.review.batches[1].mode,'full');
  let quotaCalls=0;
  await runReview(report,{designRules:['AGENTS.md']},out,out,browser,{invoke:async()=>{quotaCalls++;return {code:1,stdout:'',stderr:'Usage limit reached; rate_limit_error'}}});
  assert.equal(quotaCalls,1);assert.equal(report.review.complete,false);assert.equal(report.cells[0].critic,undefined);
  assert.ok(report.gaps.some(g=>g.includes('quota unavailable')));
 }finally{await browser.close();rmSync(out,{recursive:true,force:true});}
});

test('invalid batch sizes are rejected before starting a review',()=>{
 for(const screensPerBatch of [0,-1,1.5,9])assert.throws(()=>reviewBatches(cells,{screensPerBatch}),/group size/);
});
