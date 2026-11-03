#!/usr/bin/env node
import {spawn} from 'node:child_process';
import {readdirSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=dirname(fileURLToPath(import.meta.url)),files=process.argv.slice(2);
if(!files.length)files.push(...readdirSync(root).filter(name=>name.endsWith('.test.mjs')).sort().map(name=>join(root,name)));
if(!process.env.QA_PW_PATH){console.error('QA_PW_PATH is required; send the existing Playwright package.json path');process.exitCode=2;}
else if(!files.length||files.some(file=>!file.endsWith('.test.mjs')||file.startsWith('-'))){console.error('Send test file paths ending in .test.mjs, or no arguments for the whole suite');process.exitCode=2;}
else{
 const testEnvironment={...process.env};delete testEnvironment.NODE_TEST_CONTEXT;
 const child=spawn(process.execPath,['--test','--test-concurrency=1',...files],{stdio:'inherit',env:testEnvironment});
 const stop=signal=>child.kill(signal),interrupt=()=>stop('SIGINT'),terminate=()=>stop('SIGTERM');process.once('SIGINT',interrupt);process.once('SIGTERM',terminate);
 child.once('error',error=>{console.error(error.message);process.exitCode=2;});
 const code=await new Promise(resolve=>child.once('close',(code,signal)=>resolve(signal?2:code??2)));
 process.removeListener('SIGINT',interrupt);process.removeListener('SIGTERM',terminate);process.exitCode=code;
}
