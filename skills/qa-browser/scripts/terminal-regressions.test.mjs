import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {command} from './process.mjs';

test('terminal HTTP and console errors fail the real CLI check',{skip:!process.env.QA_PW_PATH,timeout:20000},async()=>{
 const server=createServer((req,res)=>{
  res.setHeader('Content-Type','text/html');
  if(req.url==='/exit'){res.writeHead(500);res.end('<html style="background:white;color:black"><body>Signed out<script>console.error("terminal fixture error")</script></body></html>');return;}
  res.end('<html style="background:white;color:black"><body><a id="exit" href="/exit">End</a></body></html>');
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const dir=mkdtempSync(join(tmpdir(),'qa-terminal-'));
 try{
  const flow={id:'entry',entry:'entry.js',url:'/',main:true,states:['signed-out'],steps:[],controls:[{selector:'#exit',safe:true,terminal:true,steps:[{action:'click',selector:'#exit'},{action:'text',selector:'body',value:'Signed out'}]}],breaks:[]};
  const file=join(dir,'config.json'),out=join(dir,'out');writeFileSync(file,JSON.stringify({version:1,baseURL:`http://127.0.0.1:${server.address().port}`,playwrightPath:process.env.QA_PW_PATH,flows:[flow]}));
  const result=await command(process.execPath,[fileURLToPath(new URL('./run.mjs',import.meta.url)),'--config',file,'--out',out],{cwd:dir,timeout:15000});
  const report=JSON.parse(readFileSync(join(out,'report.json')));assert.equal(result.code,1);
  assert.ok(report.terminalChecks.every(t=>t.status==='fail'));
  assert.ok(report.cells.every(c=>c.failures.some(f=>f.includes('HTTP 500'))&&c.failures.some(f=>f.includes('console error'))));
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});}
});

test('identical terminal recipes execute on both routes and attribute the broken route',{skip:!process.env.QA_PW_PATH,timeout:25000},async()=>{
 const counts={a:0,b:0},server=createServer((req,res)=>{
  res.setHeader('Content-Type','text/html');
  if(req.url.startsWith('/exit-')){const route=req.url.slice(-1);counts[route]++;res.writeHead(route==='b'?500:200);res.end('<html style="background:white;color:black"><body>Signed out</body></html>');return;}
  res.end('<html style="background:white;color:black"><body><a id="exit" href="/exit-'+(req.url==='/b'?'b':'a')+'">End</a></body></html>');
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const dir=mkdtempSync(join(tmpdir(),'qa-terminal-routes-'));
 try{
  const control={selector:'#exit',safe:true,terminal:true,steps:[{action:'click',selector:'#exit'},{action:'text',selector:'body',value:'Signed out'}]},flows=['a','b'].map(id=>({id,entry:'entry.js',url:'/'+id,main:true,states:['signed-out'],steps:[],controls:[control],breaks:[]}));
  const file=join(dir,'config.json'),out=join(dir,'out');writeFileSync(file,JSON.stringify({version:1,baseURL:`http://127.0.0.1:${server.address().port}`,playwrightPath:process.env.QA_PW_PATH,flows}));
  const result=await command(process.execPath,[fileURLToPath(new URL('./run.mjs',import.meta.url)),'--config',file,'--out',out],{cwd:dir,timeout:20000});const report=JSON.parse(readFileSync(join(out,'report.json')));
  assert.equal(result.code,1);assert.deepEqual(counts,{a:2,b:2});assert.equal(report.terminalChecks.length,4);
  assert.ok(report.cells.filter(c=>c.screen==='b').every(c=>c.failures.some(f=>f.includes('HTTP 500'))&&!c.controls.some(x=>x.status==='shared')));
  assert.ok(report.cells.filter(c=>c.screen==='a').every(c=>!c.failures.some(f=>f.includes('HTTP 500'))));
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});}
});
