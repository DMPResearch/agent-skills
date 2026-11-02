import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runCell} from './cell.mjs';
const enabled=!!process.env.QA_PW_PATH;

async function fixture(html,check){
 const server=createServer((req,res)=>{if(req.url==='/identity'){if(!req.headers.cookie?.includes('sid=live')){res.writeHead(401);res.end();}else res.end(JSON.stringify({id:'fixture-user'}));return;}res.setHeader('Content-Type','text/html');res.end('<html style="background:white;color:black"><body>'+html+'</body></html>');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const pw=createRequire(process.env.QA_PW_PATH)('playwright'),out=mkdtempSync(join(tmpdir(),'qa-identity-')),browsers=new Map(),launches=new Map(),baseURL=`http://127.0.0.1:${server.address().port}`;
 try{
  const run=async options=>{const flow={id:'public',entry:'entry.js',url:'/',states:['signed-out','signed-in'],steps:[],controls:[],breaks:[]},report={cells:[],gaps:[]};await runCell({flow,engine:'chromium',theme:'light',size:'390x660',state:{id:options.state||'signed-out'}},{config:{baseURL,flows:[flow]},report,out,browserModule:pw,browsers,launches,...options});return report.cells[0];};
  await check(run,baseURL,out);
 }finally{for(const b of browsers.values())await b.close();server.closeAllConnections();await new Promise(r=>server.close(r));rmSync(out,{recursive:true,force:true});}
}

test('named short secrets never reach pageerror message, stack, failure or saved checkpoint',{skip:!enabled},async()=>{
 const values=[['hun','ter2'].join(''),['42','4242'].join(''),['short','Tok99'].join(''),['cookie','123'].join('')];
 const message=`password=${values[0]} otp=${values[1]} token=${values[2]} cookie: sid=${values[3]}`;
 await fixture(`<script>setTimeout(()=>{throw Error(${JSON.stringify(message)})},10)</script>Public`,async(run,_baseURL,out)=>{
  const cell=await run({});assert.ok(cell.failures.some(f=>f.startsWith('uncaught page error')));
  for(const value of values){assert.ok(!JSON.stringify(cell).includes(value),'named secret was retained');assert.ok(!readFileSync(join(out,'checkpoint.json'),'utf8').includes(value),'checkpoint retained a named secret');}
 });
});

test('a public route cannot certify a dead or missing signed-in identity',{skip:!enabled},()=>fixture('Public terms',async(run,baseURL)=>{
 let checks=0;const verifySession=async({context})=>{checks++;const result=await context.request.get(baseURL+'/identity');if(!result.ok())throw Error('session unavailable');return result.json();};
 const saved=value=>new Map([['chromium',{cookies:[{name:'sid',value,domain:'127.0.0.1',path:'/',expires:-1,httpOnly:true,secure:false,sameSite:'Lax'}],origins:[]}]]);
 const dead=await run({state:'signed-in',sessions:saved('revoked'),adapter:{verifySession}});
 assert.ok(checks>0);assert.ok(dead.gaps.some(g=>/session|identity/i.test(g)));assert.equal(dead.complete,false);
 const live=await run({state:'signed-in',sessions:saved('live'),adapter:{verifySession}});
 assert.ok(!live.gaps.some(g=>/session|identity/i.test(g)));
 const wrong=await run({state:'signed-in',sessions:saved('live'),adapter:{verifySession},identities:new Map([['chromium','different-user']])});assert.ok(wrong.gaps.some(g=>g.includes('identity differs')));
 const absent=await run({state:'signed-in',sessions:saved('live')});assert.ok(absent.gaps.some(g=>/verifySession|identity/i.test(g)));
}));
