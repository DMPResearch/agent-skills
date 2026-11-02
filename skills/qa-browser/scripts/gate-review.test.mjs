import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runReview,reviewBatches} from './review.mjs';

const enabled=!!process.env.QA_PW_PATH;
async function fixture(check){
 const pw=createRequire(process.env.QA_PW_PATH)('playwright'),browser=await pw.chromium.launch(),out=mkdtempSync(join(tmpdir(),'qa-review-gate-'));
 try{
  const page=await browser.newPage({viewport:{width:390,height:660}});await page.setContent('<html style="background:white;color:black"><body><h1>Preferences</h1></body></html>');
  const paths=[];for(let i=0;i<9;i++){const path=join(out,`frame-${i}.png`);await page.screenshot({path});paths.push(path);}await page.close();
  const report={head:'fixture-head',build:'fixture-build',cells:[{id:'one',screen:'preferences',engine:'chromium',theme:'light',size:'390x660',frames:paths,entryFrame:paths[0],complete:true,failures:[],gaps:[]}],gaps:[],sheets:[]};
  const manifests=[];
  const invoke=async(file,args)=>{
   const prompt=args.at(-1).match(/^Read (.+) and return/)[1],manifest=JSON.parse(readFileSync(prompt,'utf8').split('\n').at(-1));manifests.push(manifest);
   return {code:0,stdout:JSON.stringify({frames:manifest.map(f=>({path:f.path,status:paths.some(path=>readFileSync(path).equals(readFileSync(f.path)))?'pass':'fail',rules:paths.some(path=>readFileSync(path).equals(readFileSync(f.path)))?[]:['overlapping-controls'],failures:paths.some(path=>readFileSync(path).equals(readFileSync(f.path)))?[]:['Two independent buttons overlap and obscure their labels.']}))})};
  };
  await check({report,out,browser,invoke,manifests,paths});
 }finally{await browser.close();rmSync(out,{recursive:true,force:true});}
}

test('one screen is split into bounded calls with exact unique coverage',()=>{
 const cells=[{id:'a',screen:'preferences',engine:'chromium',theme:'light',size:'390x660',frames:Array.from({length:70},(_,i)=>i+'.png')}];
 const batches=reviewBatches(cells);
 assert.ok(batches.every(b=>b.frames.length<=7),'one sheet reserves one of eight frames for calibration');
 assert.equal(batches.flatMap(b=>b.frames).length,70);
 assert.equal(new Set(batches.map(b=>b.id)).size,batches.length);
});

test('every critic batch must catch its generated defect without reporting it as a screen finding',{skip:!enabled},()=>fixture(async({report,out,browser,invoke,manifests,paths})=>{
 await runReview(report,{},out,out,browser,{invoke});
 assert.ok(manifests.every(m=>m.length<=8&&m.filter(f=>!paths.some(path=>readFileSync(path).equals(readFileSync(f.path)))).length===1));
 assert.equal(report.review.complete,true);assert.equal(report.cells[0].critic,'pass');assert.deepEqual(report.cells[0].visualFailures,[]);
 assert.ok(report.review.batches.every(b=>b.canary?.status==='caught'));
 assert.ok(report.review.batches.every(b=>b.judgments.every(j=>paths.includes(j.path))));
}));

test('a critic missing calibration yields no verdict and is not retried blindly',{skip:!enabled},()=>fixture(async({report,out,browser})=>{
 let calls=0;
 await runReview(report,{},out,out,browser,{invoke:async(file,args)=>{
  calls++;const prompt=args.at(-1).match(/^Read (.+) and return/)[1],m=JSON.parse(readFileSync(prompt,'utf8').split('\n').at(-1));
  return {code:0,stdout:JSON.stringify({frames:m.map(f=>({path:f.path,status:'pass',failures:[]}))})};
 }});
 assert.equal(report.review.complete,false);assert.equal(report.cells[0].critic,undefined);
 assert.ok(report.review.batches.some(b=>b.canary?.status==='missed'));assert.equal(calls,1);
 assert.deepEqual(report.cells[0].visualFailures||[],[]);
}));

test('resume reruns only failed batches and rejects changed frame identity',{skip:!enabled},()=>fixture(async({report,out,browser,invoke,paths})=>{
 let calls=0;
 const config={review:{resume:true}};
 await runReview(report,config,out,out,browser,{invoke:async(...args)=>{calls++;return calls===2||calls===3?{code:124,stdout:''}:invoke(...args);}});
 assert.equal(report.review.complete,false);assert.equal(calls,3);
 calls=0;await runReview(report,config,out,out,browser,{invoke:async(...args)=>{calls++;return invoke(...args);}});
 assert.equal(calls,1);assert.equal(report.review.complete,true);
 writeFileSync(paths[0],readFileSync(paths[1]));
 // Changing identity must invalidate reuse even if the pathname is unchanged.
 report.build='different-build';calls=0;
 await runReview(report,config,out,out,browser,{invoke:async(...args)=>{calls++;return invoke(...args);}});
 assert.equal(calls,2);
}));

test('quota on a changed first batch preserves later completed receipts for resume',{skip:!enabled},()=>fixture(async({report,out,browser,invoke,paths})=>{
 const config={review:{framesPerBatch:3,resume:true}};
 await runReview(report,config,out,out,browser,{invoke});assert.equal(report.review.complete,true);
 writeFileSync(paths[0],Buffer.concat([readFileSync(paths[0]),Buffer.from([0])]));
 await runReview(report,config,out,out,browser,{invoke:async()=>({code:1,stdout:'',stderr:'usage limit reached'})});
 const ledger=JSON.parse(readFileSync(join(out,'review-ledger.json')));
 assert.equal(ledger.batches.filter(b=>b.status==='pass'&&b.judgments).length,2);
 let calls=0;await runReview(report,config,out,out,browser,{invoke:async(...args)=>{calls++;return invoke(...args);}});
 assert.equal(calls,1);assert.equal(report.review.complete,true);
}));

test('review-cap exhaustion is durable and resumes without repeating completed calls',{skip:!enabled,timeout:15000},()=>fixture(async({report,out,browser,invoke})=>{
 const config={reviewTimeoutMs:5000,review:{framesPerBatch:3,resume:true}};let calls=0;
 await runReview(report,config,out,out,browser,{invoke:async(...args)=>{calls++;await new Promise(r=>setTimeout(r,5100));return invoke(...args);}});
 assert.equal(calls,1);assert.equal(report.review.complete,false);assert.ok(report.gaps.some(g=>g.includes('review budget exhausted')));
 calls=0;await runReview(report,config,out,out,browser,{invoke:async(...args)=>{calls++;return invoke(...args);}});
 assert.equal(calls,2);assert.equal(report.review.complete,true);
}));
