import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runReview} from './review.mjs';
import {imageEvents} from './fixtures/critic.mjs';

async function fixture(check){
 const pw=createRequire(process.env.QA_PW_PATH)('playwright'),browser=await pw.chromium.launch(),out=mkdtempSync(join(tmpdir(),'qa-binding-'));
 try{
  const page=await browser.newPage(),cells=[];
  for(const size of ['412x620','820x1180','1440x900']){const [width,height]=size.split('x').map(Number);await page.setViewportSize({width,height});await page.setContent('<body style="background:white;color:black"><p>Ready</p>');const path=join(out,size+'.png');await page.screenshot({path});cells.push({id:size,screen:'preferences',state:'base',engine:'chromium',theme:'light',size,frames:[path],entryFrame:path,complete:true,failures:[],gaps:[]});}await page.close();
  const report={head:'fixture',build:'fixture',cells,gaps:[],sheets:[]};
  const result=args=>{const prompt=args.at(-1).match(/^Read (.+) and return/)[1],manifest=JSON.parse(readFileSync(prompt,'utf8').split('\n').at(-1));const frames=manifest.map(f=>{const real=cells.some(c=>readFileSync(c.frames[0]).equals(readFileSync(f.path)));return {path:f.path,status:real?'pass':'fail',rules:real?[]:['overlapping-controls'],failures:real?[]:['Independent controls overlap']};});return {prompt,frames};};
  await check({report,out,browser,result});
 }finally{await browser.close();rmSync(out,{recursive:true,force:true});}
}
for(const mode of ['wrong-path','missing-image','unbound'])test(mode+' cannot approve a batch even with a claimed canary catch',{skip:!process.env.QA_PW_PATH},()=>fixture(async({report,out,browser,result})=>{
 await runReview(report,{review:{attempts:1}},out,out,browser,{invoke:async(_,args,options)=>{
  const {prompt,frames}=result(args),events=imageEvents(prompt,frames);
  if(mode==='wrong-path'){const first=events.find(e=>e.message.content[0].type==='text');const item=JSON.parse(first.message.content[0].text.split('\n')[0].slice(6));item.path=frames.find(f=>f.path!==item.path).path;first.message.content[0].text='FRAME '+JSON.stringify(item);}
  if(mode==='missing-image')for(const e of events)if(e.type==='user')e.message.content[0].content=[{type:'text',text:'not an image'}];
  if(mode!=='unbound')for(const event of events)options.onEvent?.(event);
  return {code:0,stdout:JSON.stringify({frames})};
 }});
 assert.equal(report.review.complete,false);assert.ok(report.cells.every(c=>c.critic!=='pass'));assert.ok(report.review.batches.every(b=>b.canary.status!=='caught'),'unbound images cannot establish a caught canary');assert.ok(report.review.batches.some(b=>b.attempts.some(a=>/binding|image/i.test(a.reason||''))));
}));

test('bound verdicts retain valid structured JSON after redaction',{skip:!process.env.QA_PW_PATH},()=>fixture(async({report,out,browser,result})=>{
 const value=['short','Value'].join('');
 await runReview(report,{review:{attempts:1}},out,out,browser,{invoke:async(_,args,options)=>{
  const {prompt,frames}=result(args);frames[0].failures.push('session='+value,'Unauthorized: denied','Authorization: Token '+value);for(const event of imageEvents(prompt,frames))options.onEvent?.(event);
  return {code:0,stdout:JSON.stringify({session_id:value,input_tokens:12,result:JSON.stringify({frames})})};
 }});
 assert.equal(report.review.complete,true);assert.ok(!readFileSync(join(out,'review-ledger.json'),'utf8').includes(value),'ledger retained a named secret');
 for(const b of report.review.batches){const text=readFileSync(join(out,b.id+'-attempt1.txt'),'utf8'),envelope=JSON.parse(text);assert.ok(!text.includes(value));assert.ok(Array.isArray(JSON.parse(envelope.result).frames));const bindings=JSON.parse(readFileSync(join(out,b.id+'-attempt1.bindings.json'),'utf8'));assert.ok(bindings.reads.every(r=>!r.path.includes('[redacted]')),'public sheet identity was lost');}
}));
