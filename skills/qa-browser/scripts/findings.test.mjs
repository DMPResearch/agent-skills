import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {finding} from './findings.mjs';
import {save} from './report.mjs';
test('canonical own document origins remain failures; foreign findings are visible without failing our screen',()=>{
 const out=mkdtempSync(join(tmpdir(),'qa-provenance-'));
 try{
  const cell={id:'entry',screen:'entry',frames:[],failures:[],gaps:[],repro:[],complete:true,critic:'pass'};
  finding(cell,'Foreign overlap',{baseURL:'https://app.example.com',document:{id:'foreign',origin:'https://provider.example.org/',url:'https://provider.example.org/'}});
  assert.equal(cell.failures.length,0);
  finding(cell,'Owned overlap',{baseURL:'https://app.example.com',document:{id:'owned',origin:'https://app.example.com/',url:'https://app.example.com/entry'}});
  assert.deepEqual(cell.failures,['Owned overlap']);
  finding(cell,'Owned resource failed',{baseURL:'https://app.example.com',document:{id:'foreign',origin:'https://provider.example.org',url:'https://provider.example.org/'},resourceURL:'https://app.example.com/asset.js'});
  cell.gaps.push('Unattributed coverage gap');
  const report={cells:[cell],gaps:[]};assert.equal(save(report,out),1);
  const saved=JSON.parse(readFileSync(join(out,'report.json')));
  assert.ok(saved.issues.every(i=>i.document?.id&&i.origin&&i.phase));
  assert.ok(saved.cells[0].findings.some(f=>f.message==='Unattributed coverage gap'&&f.origin==='unknown'&&f.affectsVerdict));
  assert.ok(saved.foreignFindings.some(f=>f.message==='Foreign overlap'&&!f.affectsVerdict));
 }finally{rmSync(out,{recursive:true,force:true});}
});

test('unavailable document metadata cannot erase an inspection failure',async()=>{
 const {documentOf}=await import('./findings.mjs');
 const result=documentOf({page(){throw Error('Frame metadata unavailable');}});
 assert.equal(result.origin,'unknown');assert.equal(result.url,'unknown');
});
