import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {command} from './process.mjs';
const runner=fileURLToPath(new URL('./run-tests.mjs',import.meta.url));
test('supported suite runner serializes files and preserves a real child failure',{skip:!process.env.QA_PW_PATH,timeout:10000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'qa-suite-order-')),lock=join(dir,'lock'),trace=join(dir,'trace'),files=['a','b'].map(name=>join(dir,name+'.test.mjs'));
 try{
  for(const [i,file]of files.entries())writeFileSync(file,`import test from 'node:test';import {openSync,closeSync,unlinkSync,appendFileSync} from 'node:fs';test('admission',async()=>{const fd=openSync(process.env.QA_TEST_LOCK,'wx');appendFileSync(process.env.QA_TEST_TRACE,'start${i}\\n');try{await new Promise(r=>setTimeout(r,200));}finally{appendFileSync(process.env.QA_TEST_TRACE,'end${i}\\n');closeSync(fd);unlinkSync(process.env.QA_TEST_LOCK);}});`);
  const result=await command(process.execPath,[runner,...files],{timeout:5000,env:{...process.env,QA_TEST_LOCK:lock,QA_TEST_TRACE:trace}});assert.equal(result.code,0,result.stdout+result.stderr);assert.deepEqual(readFileSync(trace,'utf8').trim().split('\n'),['start0','end0','start1','end1']);
  const missingEnvironment={...process.env};delete missingEnvironment.QA_PW_PATH;const absent=await command(process.execPath,[runner,...files],{timeout:5000,env:missingEnvironment});assert.equal(absent.code,2);assert.match(absent.stderr,/QA_PW_PATH is required/);
  writeFileSync(files[0],`import test from 'node:test';import assert from 'node:assert/strict';test('negative',()=>assert.fail('known failure'));`);
  const negative=await command(process.execPath,[runner,files[0]],{timeout:5000});assert.equal(negative.code,1,negative.stdout+negative.stderr);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
