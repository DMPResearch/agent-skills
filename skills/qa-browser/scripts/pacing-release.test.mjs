import test from 'node:test';
import assert from 'node:assert/strict';
import {servicePacer} from './phases.mjs';

test('cancelled pacing reservations do not consume a service admission',{timeout:3000},async()=>{
 const pace=servicePacer({entry:300}),times=[],cancelled=new AbortController();
 await pace('entry');const start=Date.now();
 const abandoned=pace('entry',{signal:cancelled.signal});
 const admitted=pace('entry').then(()=>times.push(Date.now()-start));
 cancelled.abort();await assert.rejects(abandoned,{name:'AbortError'});await admitted;
 assert.ok(times[0]>=270,'actual service interval was shortened');assert.ok(times[0]<480,'cancelled work retained an unused reservation');
 const already=new AbortController();already.abort();await assert.rejects(pace('entry',{signal:already.signal}),{name:'AbortError'});
});
