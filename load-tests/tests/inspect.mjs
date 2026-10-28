import fs from 'node:fs';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import { ROOT,safeEnv,id,save ,RESULTS} from '../lib.mjs';
const name='offline-'+id()+'.private.json';
save(ROOT+'/fixtures/'+name,{offlineOnly:true,users:Array.from({length:1000},(_,i)=>({id:crypto.randomUUID(),email:`offline-${i}@loadtest.invalid`}))});
const dir=RESULTS+'/inspect_'+id();fs.mkdirSync(dir);
const results=[];
for(const mode of ['mixed','dashboard','video','quiz','leaderboard','spike-login','spike-course','spike-heartbeat','spike-submit','spike-completion']) {
  const r=spawnSync('k6',['--config','k6.config.json','inspect','-e','SAFETY_PREFLIGHT=verified','-e','MAX_VUS=1000','-e','MODE='+mode,'-e','FIXTURE_FILE='+name,'scenarios/learners.js'],{cwd:ROOT,env:safeEnv('postgresql://disabled:disabled@127.0.0.1:1/bbe_loadtest'),encoding:'utf8'});
  assert.equal(r.status,0,r.stderr);
  const options=JSON.parse(r.stdout),s=options.scenarios.learners;
  assert.equal(mode==='spike-login'?s.maxVUs:mode.startsWith('spike-')?s.vus:Math.max(...s.stages.map(x=>x.target)),1000);
  save(dir+'/'+mode+'.json',options);results.push({mode,configuredCapacity:1000,executedVUs:0,passed:true});
}
for(const base of ['https://example.vercel.app','https://example.com','http://127.0.0.1:3100@evil.invalid']) {
  const r=spawnSync('k6',['--config','k6.config.json','inspect','-e','MODE=static-smoke','-e','SAFETY_PREFLIGHT=verified','-e','BASE_URL='+base,'scenarios/learners.js'],{cwd:ROOT,encoding:'utf8'});
  assert.notEqual(r.status,0);results.push({test:'reject-unsafe-target',passed:true});
}
for(const file of ['legacy-disabled.js','smoke-test.js','load-test.js','stress-test.js','endpoints-benchmark.js']){
  assert.equal(fs.existsSync(ROOT+'/'+file),false);results.push({test:'legacy-removed '+file,passed:true});
}
save(dir+'/validation.json',{applicationTested:false,results});
console.log(JSON.stringify({inspectionChecks:results.length,applicationTested:false,dir}));
