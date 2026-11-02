import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {mkdtempSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {command} from './process.mjs';
import {runCell} from './cell.mjs';
const enabled=!!process.env.QA_PW_PATH,html='<html style="background:white;color:black"><body>';
const sha=value=>createHash('sha256').update(value).digest('hex');

async function served(handler,check){
 const server=createServer(handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{await check(`http://127.0.0.1:${server.address().port}`);}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
}

test('popup and service-worker responses never lose the CLI report',{skip:!enabled,timeout:30000},()=>served((req,res)=>{
 res.setHeader('Content-Type',req.url.endsWith('.js')?'text/javascript':'text/html');
 if(req.url==='/sw.js')return res.end("importScripts('/dep.js')");
 if(req.url==='/dep.js')return res.end('self.ready=true');
 res.end(html+(req.url==='/popup'?'Popup':"<a id=open href=/popup target=_blank>Open</a><script>navigator.serviceWorker.register('/sw.js')</script>")+'</body></html>');
},async baseURL=>{
 const dir=mkdtempSync(join(tmpdir(),'qa-response-cli-'));
 try{
  const config={version:1,baseURL,playwrightPath:process.env.QA_PW_PATH,flows:[{id:'entry',entry:'entry.js',url:'/',main:true,states:['signed-out'],steps:[],controls:[{selector:'#open',safe:true,steps:[{action:'click',selector:'#open'},{action:'visible',selector:'body'}]}],breaks:[]}]};
  const file=join(dir,'config.json'),out=join(dir,'out');writeFileSync(file,JSON.stringify(config));
  const result=await command(process.execPath,[fileURLToPath(new URL('./run.mjs',import.meta.url)),'--config',file,'--out',out],{cwd:dir,timeout:25000});
  assert.ok(existsSync(join(out,'report.json')),result.stderr);const report=JSON.parse(readFileSync(join(out,'report.json')));
  assert.equal(report.cells.length,20);assert.ok(!/Unhandled|frame.*not.*available|associated.*frame/i.test(result.stderr));
 }finally{rmSync(dir,{recursive:true,force:true});}
}));

for(const scenario of ['replaceState','slow-image'])test('asset integrity survives '+scenario,{skip:!enabled,timeout:20000},async()=>{
 const good='window.ready=true',script=scenario==='replaceState'?'window.ready=false;history.replaceState(null,"","/home")':good;
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg==','base64');
 await served((req,res)=>{
  if(req.url==='/app.js'){res.setHeader('Content-Type','text/javascript');res.end(script);return;}
  if(req.url==='/image.png'){setTimeout(()=>{res.setHeader('Content-Type','image/png');res.end(png);},600);return;}
  res.setHeader('Content-Type','text/html');res.end(html+'Ready<script src=/app.js></script>'+(scenario==='slow-image'?'<img src=/image.png alt="" width=1 height=1>':'')+'</body></html>');
 },async baseURL=>{
  const pw=createRequire(process.env.QA_PW_PATH)('playwright'),out=mkdtempSync(join(tmpdir(),'qa-response-')),browsers=new Map(),launches=new Map();
  try{for(const engine of ['chromium','webkit']){
   const flow={id:'entry',entry:'entry.js',url:'/',states:['signed-out','signed-in'],steps:[],controls:[],breaks:[]},report={cells:[],gaps:[]};
   await runCell({flow,engine,theme:'light',size:'390x660',state:{id:'signed-out'}},{config:{baseURL,flows:[flow],assetHashes:{'/app.js':sha(good)}},report,out,browserModule:pw,browsers,launches});
   const assetFailures=report.cells[0].failures.filter(f=>f.includes('served asset'));
   if(scenario==='replaceState')assert.ok(assetFailures.some(f=>f.includes('hash mismatch')),engine+' lost wrong hash');
   else assert.deepEqual(assetFailures,[],engine+' healthy bytes failed under a slow image');
  }}finally{for(const b of browsers.values())await b.close();rmSync(out,{recursive:true,force:true});}
 });
});
