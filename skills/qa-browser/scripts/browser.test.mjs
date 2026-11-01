import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {inspect,steps,inventory} from './browser.mjs';
const toolchain=process.env.QA_PW_PATH;
test('served defects fail and corrected screens pass in both real engines',{skip:!toolchain},async()=>{
 const pw=createRequire(toolchain)('playwright');let broken=true;
 const server=createServer((req,res)=>{
  res.setHeader('Content-Type','text/html');
  res.end(`<html><head><style>html{background:#fff;color:#111}body{margin:20px;font:16px sans-serif}button{height:44px} ${broken?'button{position:fixed;left:20px;top:20px}#bad{width:200vw}img{width:100px;height:40px;object-fit:fill}':''}</style></head><body><h1>Account</h1><button id="open" onclick="document.querySelector('#panel').hidden=false">Open settings</button><button id="save" onclick="document.querySelector('#result').textContent='Saved'">Save</button><section id="panel" hidden>Settings</section><output id="result"></output><iframe style="display:none" srcdoc="<p>Hidden service frame</p>"></iframe>${broken?'<div id="bad">Wide content</div><img src="/missing.png"><div class="phone-frame">9:41</div><span id="duplicate">One</span><span id="duplicate">Two</span><img width="100" height="40" src="data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27100%27 height=%27100%27%3E%3C/svg%3E"><p style="color:rgb(240,240,240);background:rgb(255,255,255)">Low contrast</p>':''}</body></html>`);
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const url=`http://127.0.0.1:${server.address().port}`;
 try{for(const engine of ['chromium','webkit']){
  const browser=await pw[engine].launch();try{
   const page=await browser.newPage({viewport:{width:390,height:660}});
   broken=true;await page.goto(url);const red=await inspect(page);
   if(process.env.QA_FIXTURE_OUT){mkdirSync(process.env.QA_FIXTURE_OUT,{recursive:true});await page.screenshot({path:join(process.env.QA_FIXTURE_OUT,'broken-'+engine+'.png')});writeFileSync(join(process.env.QA_FIXTURE_OUT,'broken-'+engine+'.json'),JSON.stringify({status:'fail',issues:red},null,2));}
   assert.ok(red.some(x=>x.includes('overlapping')),'intentional overlap must fail');
   assert.ok(red.some(x=>x.includes('overflow')),'intentional overflow must fail');
   assert.ok(red.some(x=>x.includes('broken image')),'missing image must fail');
   assert.ok(red.some(x=>x.includes('device chrome')),'fake device chrome must fail');
   assert.ok(red.some(x=>x.includes('stretched image')),'distorted image must fail');
   assert.ok(red.some(x=>x.includes('duplicate visible id')),'duplicate elements must fail');
   assert.ok(red.some(x=>x.includes('contrast')),'unreadable contrast must fail');
   broken=false;await page.goto(url);const green=await inspect(page);assert.deepEqual(green,[]);
   if(process.env.QA_FIXTURE_OUT){await page.screenshot({path:join(process.env.QA_FIXTURE_OUT,'fixed-'+engine+'.png')});writeFileSync(join(process.env.QA_FIXTURE_OUT,'fixed-'+engine+'.json'),JSON.stringify({status:'pass',issues:green},null,2));}
   assert.equal((await inventory(page)).length,2);
   await page.locator('#save').evaluate(e=>e.addEventListener('click',()=>{e.dataset.clicks=String(Number(e.dataset.clicks||0)+1)}));
   await steps(page,[{action:'double-click',selector:'#save'}]);
   assert.equal(await page.locator('#save').getAttribute('data-clicks'),'2');
   await page.locator('#result').evaluate(e=>e.textContent='');
   await steps(page,[{action:'click',role:'button',selector:'Open settings'},{action:'visible',selector:'#panel'}]);
   await assert.rejects(steps(page,[{action:'text',selector:'#result',value:'Saved'}]),/expected text absent/);
   await steps(page,[{action:'click',selector:'#save'},{action:'text',selector:'#result',value:'Saved'}]);
  }finally{await browser.close();}
 }}finally{await new Promise(r=>server.close(r));}
});

test('real file chooser and declared empty guard are effects, a mutating guard fails',{skip:!process.env.QA_PW_PATH},async()=>{
 const {steps}=await import('./browser.mjs');const {createRequire}=await import('node:module');const pw=createRequire(process.env.QA_PW_PATH)('playwright');
 for(const engine of ['chromium','webkit']){const browser=await pw[engine].launch();try{
  const page=await browser.newPage();await page.setContent('<input id="email"><input id="file" type="file" hidden><button id="attach" onclick="document.querySelector(\'#file\').click()">Attach</button><button id="send">Send</button>');
  assert.equal((await steps(page,[{action:'file-chooser',selector:'#attach'}]))[0].type,'file-chooser');
  assert.equal((await steps(page,[{action:'empty-guard',selector:'#send',input:'#email'}]))[0].type,'empty-guard');
  await page.locator('#send').evaluate(e=>e.onclick=()=>e.textContent='Changed');
  await assert.rejects(steps(page,[{action:'empty-guard',selector:'#send',input:'#email'}]),/guard/);
 }finally{await browser.close();}}
});

test('declared prototype chrome is excluded while product defects remain visible',{skip:!process.env.QA_PW_PATH},async()=>{
 const {withPrototypeChrome,inspect}=await import('./browser.mjs');const {createRequire}=await import('node:module');const browser=await createRequire(process.env.QA_PW_PATH)('playwright').chromium.launch();
 try{const page=await browser.newPage();await page.setContent('<html style="background:white;color:black"><body><aside id="harness" class="status-bar">Prototype controls</aside><input aria-label="First" style="position:absolute;top:100px;left:10px"><input aria-label="Second" style="position:absolute;top:100px;left:10px"></body></html>');
 assert.ok((await inspect(page)).includes('fake device chrome'));
 const failures=await withPrototypeChrome(page,[{selector:'#harness',reason:'Prototype navigation, outside product'}],()=>inspect(page));
 assert.ok(!failures.includes('fake device chrome'));assert.ok(failures.includes('overlapping independent controls'));assert.ok(await page.locator('#harness').isVisible(),'temporary exclusion must be restored');
 }finally{await browser.close();}
});
