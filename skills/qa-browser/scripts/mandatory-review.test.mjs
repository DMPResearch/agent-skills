import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runReview} from './fixtures/critic.mjs';

test('a lone phone defect is caught by mandatory full reads without any sheet flag',{skip:!process.env.QA_PW_PATH},async()=>{
 const pw=createRequire(process.env.QA_PW_PATH)('playwright'),browser=await pw.chromium.launch(),out=mkdtempSync(join(tmpdir(),'qa-mandatory-'));
 try{
  const page=await browser.newPage(),cells=[];
  for(const size of ['412x620','820x1180','1440x900']){const [width,height]=size.split('x').map(Number);await page.setViewportSize({width,height});await page.setContent('<body style="background:white;color:black"><h1>'+size+'</h1>');const path=join(out,size+'.png');await page.screenshot({path});cells.push({id:size,screen:'preferences',state:'base',engine:'chromium',theme:'light',size,entryFrame:path,frames:[path],complete:true,failures:[],gaps:[]});}await page.close();
  const same=(a,b)=>readFileSync(a).equals(readFileSync(b)),report={head:'fixture',build:'fixture',cells,gaps:[],sheets:[]};let sheetFlags=0;
  await runReview(report,{},out,out,browser,{invoke:async(_,args)=>{
   const prompt=args.at(-1).match(/^Read (.+) and return/)[1],text=readFileSync(prompt,'utf8'),manifest=JSON.parse(text.split('\n').at(-1)),full=!text.includes('Read ONLY these contact sheets');
   return {code:0,stdout:JSON.stringify({frames:manifest.map(f=>{
    const source=cells.find(c=>same(f.path,c.frames[0])),bad=source?.size==='412x620'&&full;
    const judgment={path:f.path,status:source?(bad?'fail':'pass'):'fail',rules:source?(bad?['reference-mismatch']:[]):['overlapping-controls'],failures:source?(bad?['Known lone defect']:[]):['Independent controls overlap']};if(!full&&source&&judgment.status!=='pass')sheetFlags++;return judgment;
   })})};
  }});
  assert.equal(sheetFlags,0);assert.equal(report.review.complete,true);assert.equal(cells[0].critic,'fail');assert.equal(cells[2].critic,'pass');
  assert.ok(report.review.batches.some(b=>b.mode==='full'&&b.frames.includes(cells[0].frames[0])));assert.ok(report.review.batches.some(b=>b.mode==='full'&&b.frames.includes(cells[2].frames[0])));
  const partial={head:'fixture',build:'fixture',cells:cells.slice(0,2).map(c=>({...c,failures:[],gaps:[]})),gaps:[],sheets:[]};
  await runReview(partial,{},out,out,browser,{invoke:async(_,args)=>{const prompt=args.at(-1).match(/^Read (.+) and return/)[1],manifest=JSON.parse(readFileSync(prompt,'utf8').split('\n').at(-1));return {code:0,stdout:JSON.stringify({frames:manifest.map(f=>{const real=cells.some(c=>same(f.path,c.frames[0]));return {path:f.path,status:real?'pass':'fail',rules:real?[]:['overlapping-controls'],failures:real?[]:['Independent controls overlap']};})})};}});
  assert.equal(partial.review.complete,false);assert.ok(partial.gaps.some(g=>g.includes('desktop')));assert.ok(partial.cells.every(c=>c.critic!=='pass'));

 }finally{await browser.close();rmSync(out,{recursive:true,force:true});}
});
