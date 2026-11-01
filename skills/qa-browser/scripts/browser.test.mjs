import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
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
   assert.ok(red.some(x=>x.includes('overlapping')),'intentional overlap must fail');
   assert.ok(red.some(x=>x.includes('overflow')),'intentional overflow must fail');
   assert.ok(red.some(x=>x.includes('broken image')),'missing image must fail');
   assert.ok(red.some(x=>x.includes('device chrome')),'fake device chrome must fail');
   assert.ok(red.some(x=>x.includes('stretched image')),'distorted image must fail');
   assert.ok(red.some(x=>x.includes('duplicate visible id')),'duplicate elements must fail');
   assert.ok(red.some(x=>x.includes('contrast')),'unreadable contrast must fail');
   broken=false;await page.goto(url);assert.deepEqual(await inspect(page),[]);
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
