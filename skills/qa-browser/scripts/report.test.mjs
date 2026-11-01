import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {command,critique,save} from './report.mjs';
import {redact,validate} from './contract.mjs';
test('reviewer stdin is closed and a stuck reviewer is bounded',async()=>{
 const closed=await command(process.execPath,['-e',"process.stdin.resume();process.stdin.on('end',()=>console.log('closed'))"],{timeout:10000});
 assert.equal(closed.code,0);assert.equal(closed.stdout.trim(),'closed');
 const hung=await command(process.execPath,['-e','setInterval(()=>{},1000)'],{timeout:30});
 assert.equal(hung.code,124);
});
test('missing frame cannot be approved; readable report keeps reproduction and gaps',async()=>{
 const out=mkdtempSync(join(tmpdir(),'qa-report-'));
 try{
  const cell={id:'settings-light',screen:'settings',size:'390x660',engine:'webkit',theme:'light',state:'signed-out',frames:[join(out,'missing.png')],failures:[],gaps:['auth service unavailable'],repro:['Open settings','Click Save'],complete:false};
  const report={head:{kind:'unversioned',root:'/served/source'},build:{kind:'served-content',id:'observed-build'},cells:[cell],gaps:[]};
  await critique(report,{designRules:['rules.md'],references:['approved.png']},out,out);
  assert.ok(report.gaps.some(g=>g.includes('missing frame')));
  assert.equal(save(report,out),2);
  const md=readFileSync(join(out,'report.md'),'utf8');assert.match(md,/unversioned/);assert.match(md,/observed-build/);assert.ok(!md.includes('[object Object]'));assert.match(md,/Click Save/);assert.match(md,/auth service unavailable/);
  cell.failures.push('control overlap');assert.equal(save(report,out),1);
  assert.equal(JSON.parse(readFileSync(join(out,'report.json'))).screens[0].status,'fail');
 }finally{rmSync(out,{recursive:true,force:true});}
});
test('credentials and URL queries do not reach runtime evidence',()=>{
 const value=['secret','value',String(Date.now()),'unreadable'].join('');
 const raw=`https://example.com/path?ticket=${value} user@example.com Bearer ${value}`;
 const clean=redact(raw);assert.ok(!clean.includes(value));assert.ok(!clean.includes('user@example.com'));assert.ok(!clean.includes('?ticket'));
});
test('a declared click without an expected outcome is not coverage',()=>{
 assert.throws(()=>validate({version:1,baseURL:'http://localhost',flows:[{id:'x',main:true,entry:'x.js',url:'/',states:['signed-out'],steps:[],controls:[{selector:'button',steps:[{action:'click',selector:'button'}]}],breaks:[]}]}),/expected effect/);
});
