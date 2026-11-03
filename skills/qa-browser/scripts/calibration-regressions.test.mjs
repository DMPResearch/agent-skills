import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {runReview} from './fixtures/critic.mjs';
const enabled=!!process.env.QA_PW_PATH;
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
async function fixture(broken,check){
 const pw=createRequire(process.env.QA_PW_PATH)('playwright'),browser=await pw.chromium.launch(),out=mkdtempSync(join(tmpdir(),'qa-calibration-'));
 try{
  const page=await browser.newPage({viewport:{width:390,height:660}});
  await page.setContent('<body style="background:white;color:black"><h1>Preferences</h1>'+(broken?'<button style="position:absolute;top:100px;width:240px;height:90px">First</button><button style="position:absolute;top:120px;left:25px;width:240px;height:90px">Second</button>':''));
  const path=join(out,'entry.png');await page.screenshot({path});const paths=[path],cells=[{id:'one',screen:'preferences',state:'base',engine:'chromium',theme:'light',size:'390x660',entryFrame:path,frames:[path],complete:true,failures:[],gaps:[]}];
  for(const size of ['820x1180','1440x900']){const [width,height]=size.split('x').map(Number);await page.setViewportSize({width,height});const extra=join(out,size+'.png');await page.screenshot({path:extra});paths.push(extra);cells.push({...cells[0],id:size,size,frames:[extra],entryFrame:extra,failures:[],gaps:[]});}await page.close();
  const report={head:'fixture',build:'fixture',cells,gaps:[],sheets:[]};
  const realHashes=new Set(paths.map(hash)),read=args=>{const prompt=args.at(-1).match(/^Read (.+) and return/)[1];return JSON.parse(readFileSync(prompt,'utf8').split('\n').at(-1));};
  await check({report,out,browser,realHashes,read});
 }finally{await browser.close();rmSync(out,{recursive:true,force:true});}
}

test('the old metadata-only attack cannot approve broken images',{skip:!enabled},()=>fixture(true,async({report,out,browser,read})=>{
 await runReview(report,{},out,out,browser,{invoke:async(_,args)=>({code:0,stdout:JSON.stringify({frames:read(args).map(f=>({path:f.path,status:f.path.includes('review-check-')||f.screen==='Supplementary frame'?'fail':'pass',rules:['overlapping-controls'],failures:f.path.includes('review-check-')||f.screen==='Supplementary frame'?['Buttons overlap']:[]}))})})});
 assert.equal(report.review.complete,false);assert.equal(report.cells[0].critic,undefined);
 const prompt=readFileSync(join(out,report.review.batches[0].id+'.prompt.md'),'utf8');
 assert.ok(!prompt.includes('review-check-'));assert.ok(!prompt.includes('Supplementary frame'));
 const manifest=JSON.parse(prompt.split('\n').at(-1));assert.ok(manifest.every(f=>f.screen==='preferences'&&f.isEntry===true));
}));

test('inspect with the matching overlap verdict catches calibration and reaches full-size review',{skip:!enabled},()=>fixture(false,async({report,out,browser,read,realHashes})=>{
 let calls=0;
 await runReview(report,{},out,out,browser,{invoke:async(_,args)=>{calls++;const sheet=args.at(-1).includes('-sheets');return {code:0,stdout:JSON.stringify({frames:read(args).map(f=>{const planted=!realHashes.has(hash(f.path));return {path:f.path,status:planted?(sheet?'inspect':'fail'):(sheet?'inspect':'pass'),rules:planted?['overlapping-controls']:[],failures:planted?['Independent buttons overlap']:[]};})})};}});
 assert.equal(report.review.complete,true);assert.equal(report.cells[0].critic,'pass');assert.equal(calls,3);
 assert.ok(report.review.batches.every(b=>b.canary.status==='caught'));assert.deepEqual(report.cells[0].visualFailures,[]);
}));

test('unrelated clip-art verdict does not count as the planted overlap',{skip:!enabled},()=>fixture(false,async({report,out,browser,read,realHashes})=>{
 await runReview(report,{},out,out,browser,{invoke:async(_,args)=>({code:0,stdout:JSON.stringify({frames:read(args).map(f=>{const planted=!realHashes.has(hash(f.path));return {path:f.path,status:planted?'fail':'pass',rules:planted?['clip-art']:[],failures:planted?['generic clip-art']:[]};})})})});
 assert.equal(report.review.complete,false);assert.equal(report.review.batches[0].canary.status,'missed');
}));
