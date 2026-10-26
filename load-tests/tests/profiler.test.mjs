import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {ROOT,id,safeEnv} from '../lib.mjs';
test('CPU preload preserves HTTP and records neither auth headers nor query values',()=>{
  const dir=ROOT+'/results/profiler-unit_'+id();fs.mkdirSync(dir,{recursive:true});
  const out=dir+'/cpu.jsonl';
  const program="const http=require('node:http');const s=http.createServer((q,r)=>{console.log('[SQL 5ms] SELECT dummy');r.end('ok');});s.listen(0,'127.0.0.1',async()=>{try{const r=await fetch('http://127.0.0.1:'+s.address().port+'/api/v1/stars/me?token=do-not-log',{headers:{Authorization:'Bearer private-unit-test'}});if(await r.text()!=='ok')process.exitCode=1;}finally{s.close();}});";
  const r=spawnSync(process.execPath,['--require',path.join(ROOT,'request-profiler.cjs'),'-e',program],{env:{...safeEnv('postgresql://disabled:disabled@127.0.0.1:1/bbe_loadtest'),PERF_REQUEST_OUTPUT:out},encoding:'utf8',timeout:10000});
  assert.equal(r.status,0,r.stderr);const raw=fs.readFileSync(out,'utf8');
  assert.ok(!raw.includes('private-unit-test'));assert.ok(!raw.includes('do-not-log'));
  const samples=raw.trim().split('\n').map(l=>JSON.parse(l));assert.equal(samples.length,1);assert.equal(samples[0].endpoint,'stars');assert.equal(samples[0].completed,true);assert.equal(samples[0].overlappingRequests,false);assert.ok(samples[0].cpuTotalMs>=0);
  assert.equal(samples[0].sqlQueryCount,1);assert.equal(samples[0].sqlDurationSumMs,5);assert.ok(!raw.includes('SELECT dummy'));
});
