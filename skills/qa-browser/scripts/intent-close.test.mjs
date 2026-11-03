import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runCell} from './cell.mjs';
for(const engine of ['chromium','webkit'])test(engine+' intent interception remains installed until native page close commits',{skip:!process.env.QA_PW_PATH,timeout:15000},async()=>{
 let calls=0;const external=createServer((q,r)=>{calls++;r.setHeader('Access-Control-Allow-Origin','*');r.end('Ready');});await new Promise(r=>external.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+external.address().port;
 const app=createServer((q,r)=>{r.setHeader('Content-Type','text/html');r.end(`<html style="color:black;background:white"><button id="send" style="width:150px;height:48px" onclick="fetch('${origin}/send');setTimeout(()=>fetch('${origin}/retry'),50)">Send</button></html>`);});await new Promise(r=>app.listen(0,'127.0.0.1',r));
 const pw=createRequire(process.env.QA_PW_PATH)('playwright'),browsers=new Map(),launches=new Map(),out=mkdtempSync(join(tmpdir(),'qa-intent-close-'));
 const instrumented={...pw,[engine]:{launch:async()=>{const browser=await pw[engine].launch(),newContext=browser.newContext.bind(browser);browser.newContext=async options=>{const context=await newContext(options),newPage=context.newPage.bind(context);context.newPage=async()=>{const page=await newPage(),close=page.close.bind(page);page.close=async options=>{await new Promise(r=>setTimeout(r,200));return close(options);};return page;};return context;};return browser;}}};
 try{const recipe={selector:'#send',safe:true,service:true,name:'Send',role:'button',serviceRequest:{origin,method:'GET'},steps:[{action:'click',selector:'#send'},{action:'visible',selector:'#send'}]},flow={id:'entry',url:'/',states:['signed-out'],steps:[],controls:[recipe],breaks:[]},report={cells:[]};await runCell({flow,engine,theme:'light',size:'390x660',state:{id:'signed-out'}},{config:{baseURL:'http://127.0.0.1:'+app.address().port,flows:[flow]},report,out,browserModule:instrumented,browsers,launches,services:{defer:()=> 'phase'}});assert.equal(calls,0,'a retry during the native close handshake must never leave the browser');assert.ok(report.cells[0].observations?.some(o=>o.kind==='service-teardown-request'&&o.url===origin+'/retry'&&o.method==='GET'),'observed teardown traffic must have a visible receipt');}
 finally{for(const b of browsers.values())await b.close();for(const s of [app,external]){s.closeAllConnections();await new Promise(r=>s.close(r));}rmSync(out,{recursive:true,force:true});}
});
