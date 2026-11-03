import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {validateObservations,requestObservation,warningObservation} from './observations.mjs';
const rule=origin=>({kind:'external-request',id:'probe',owner:'Transport service',reason:'Known background probe',match:{origin,path:'/probe',methods:['GET'],resourceTypes:['fetch']},outcomes:['cancelled']});

test('unknown suffixes cannot establish external ownership without an exact-host exception',()=>{
 for(const [baseURL,origin]of [['https://app.division.unknownsuffix','https://api.otherdivision.unknownsuffix'],['https://app.example.com','https://api.division.unknownsuffix'],['https://app.division.unknownsuffix','https://api.example.net']]){
  const candidate=rule(origin),config={baseURL,serviceEnvironment:'development'};
  assert.throws(()=>validateObservations([candidate],config),/unknown|suffix|same.site/i);
  assert.equal(requestObservation([candidate],baseURL,{url:()=>origin+'/probe',method:()=> 'GET',resourceType:()=> 'fetch'},'cancelled'),undefined);
  const notice={kind:'expected-development-warning',id:'notice',owner:'Transport service',reason:'Development service',source:{origin,paths:['/sdk.js']},message:'Development transport active'};
  assert.throws(()=>validateObservations([notice],config),/unknown|suffix|same.site/i);
  assert.equal(warningObservation([notice],baseURL,{text:()=>notice.message,location:()=>({url:origin+'/sdk.js'})}),undefined);
  const sameSiteException={hostname:new URL(origin).hostname,reason:'Explicitly approved service host; its domain boundary is unknown'};
  validateObservations([{...candidate,sameSiteException},{...notice,sameSiteException}],config);
 }
});
for(const engine of ['chromium','webkit'])test(engine+' a real aborted request on unknown suffixes gets no implicit exemption',{skip:!process.env.QA_PW_PATH,timeout:8000},async()=>{
 const proxy=createServer((req,res)=>{if(new URL(req.url,'http://'+req.headers.host).pathname==='/probe'){res.writeHead(200,{'Access-Control-Allow-Origin':'*'});res.write('pending');return;}res.setHeader('Content-Type','text/html');res.end('<body>Ready</body>');});
 await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));
 const pw=createRequire(process.env.QA_PW_PATH)('playwright'),browser=await pw[engine].launch(),baseURL='http://app.division.unknownsuffix',origin='http://api.otherdivision.unknownsuffix';
 try{
  const context=await browser.newContext({proxy:{server:'http://127.0.0.1:'+proxy.address().port}}),page=await context.newPage();page.setDefaultTimeout(2000);page.setDefaultNavigationTimeout(2000);
  await page.goto(baseURL);const response=page.waitForEvent('response',request=>request.url()===origin+'/probe');await page.evaluate(url=>{globalThis.controller=new AbortController();fetch(url,{signal:controller.signal}).then(r=>r.text()).catch(()=>{});},origin+'/probe');await response;
  const failed=page.waitForEvent('requestfailed',request=>request.url()===origin+'/probe');await page.evaluate(()=>controller.abort());const request=await failed;
  assert.match(request.failure().errorText,/ABORTED|cancelled|canceled/i);assert.equal(requestObservation([rule(origin)],baseURL,request,'cancelled'),undefined);
  const explicit={...rule(origin),sameSiteException:{hostname:new URL(origin).hostname,reason:'Known fixture service whose suffix is intentionally outside the snapshot'}};validateObservations([explicit],{baseURL});assert.equal(requestObservation([explicit],baseURL,request,'cancelled'),explicit);
 }finally{await browser.close();proxy.closeAllConnections();await new Promise(resolve=>proxy.close(resolve));}
});
