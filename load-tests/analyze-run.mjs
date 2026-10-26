import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import {ROOT,save} from './lib.mjs';
const name=process.argv[2];if(!/^[a-zA-Z0-9_-]+$/.test(name||''))throw new Error('Pass a run ID');
const dir=path.join(ROOT,'results',name),read=n=>JSON.parse(fs.readFileSync(path.join(dir,n),'utf8'));
const metadata=read('metadata.json'),s=read('summary.json');
const rows=[];
if(fs.existsSync(dir+'/process.csv')) {
  const csv=fs.readFileSync(dir+'/process.csv','utf8').trim().split(/\r?\n/),parse=l=>l.split(',').map(x=>x.replace(/^"|"$/g,''));
  const headers=parse(csv.shift().replace(/^\uFEFF/,''));
  for(const line of csv) {const values=parse(line);rows.push(Object.fromEntries(headers.map((h,i)=>[h,values[i]])));}
}
const processes={};
for(const component of ['backend','k6']) {
  const r=rows.filter(x=>x.component===component);if(!r.length)continue;
  const first=r[0],last=r.at(-1),seconds=(Date.parse(last.timestamp)-Date.parse(first.timestamp))/1000;
  const cpuSeconds=first.cpuSeconds!==undefined&&last.cpuSeconds!==undefined?Number(last.cpuSeconds)-Number(first.cpuSeconds):null;
  processes[component]={sampleCount:r.length,first:first.timestamp,last:last.timestamp,cpuSeconds,meanCoreUtilization:cpuSeconds===null||!seconds?null:cpuSeconds/seconds,
    maxMachineCpuPercent:Math.max(...r.map(x=>Number(x.cpuMachinePercent)||0)),maxWorkingSetBytes:Math.max(...r.map(x=>Number(x.workingSetBytes))),maxPrivateBytes:Math.max(...r.map(x=>Number(x.privateBytes)))};
}
let httpWithinCpuWindow=0,actualVuPeak=0;
const backend=processes.backend;
if(fs.existsSync(dir+'/samples.json'))for await(const line of readline.createInterface({input:fs.createReadStream(dir+'/samples.json'),crlfDelay:Infinity})) {
  let p;try{p=JSON.parse(line);}catch{continue;}if(p.type!=='Point')continue;
  if(p.metric==='vus')actualVuPeak=Math.max(actualVuPeak,p.data.value);
  if(p.metric==='http_reqs' && backend && Date.parse(p.data.time)>=Date.parse(backend.first) && Date.parse(p.data.time)<=Date.parse(backend.last))httpWithinCpuWindow+=p.data.value;
}
const db=fs.existsSync(dir+'/database.jsonl')?fs.readFileSync(dir+'/database.jsonl','utf8').trim().split('\n').filter(Boolean).map(l=>JSON.parse(l)):[];
const sql=fs.existsSync(dir+'/backend.log')?[...fs.readFileSync(dir+'/backend.log','utf8').matchAll(/\[SQL ([0-9.]+)ms\]/g)].map(m=>Number(m[1])):[];
const endpoints=[];for(const [key,value]of Object.entries(s.metrics))if(key.startsWith('http_req_duration{endpoint:')){
  const count=s.metrics[key.replace('http_req_duration','endpoint_requests')]?.values?.count||0;
  if(count)endpoints.push({endpoint:key.match(/endpoint:([^}]+)/)[1],count,...value.values});
}
const result={runId:name,mode:metadata.mode,diagnosticOnly:metadata.diagnosticOnly||false,actualVuPeak,endpoints,processes,
  rps:s.metrics.http_reqs?.values?.rate,httpCount:s.metrics.http_reqs?.values?.count,httpErrorRate:s.metrics.http_req_failed?.values?.rate,
  latency:s.metrics.http_req_duration?.values,timeouts:s.metrics.timeouts?.values?.count||0,successfulTransactionsPerSecond:s.metrics.successful_transactions?.values?.rate||0,
  httpWithinCpuWindow,backendCpuSecondsPerHttpRequest:backend?.cpuSeconds!==null&&httpWithinCpuWindow?backend.cpuSeconds/httpWithinCpuWindow:null,
  database:db.length?{sampleCount:db.length,peakConnections:Math.max(...db.map(r=>r.connections)),peakActive:Math.max(...db.map(r=>r.active)),peakLockWaiters:Math.max(...db.map(r=>r.lock_waiters)),maxConnections:db[0].max_connections}:null,
  sqlEvents:sql.length,sqlDurationSumMs:sql.reduce((a,b)=>a+b,0),sqlMeanMs:sql.length?sql.reduce((a,b)=>a+b,0)/sql.length:null,
  caveats:['CPU/request is process CPU in a sampled window, includes cold code/GC/background overhead; not Vercel billable CPU.','SQL durations include driver/network and may overlap; do not subtract their sum from HTTP wall time.','Percentiles with few samples are descriptive only; no concurrency capacity proven.']};
save(dir+'/analysis.json',result);console.log(JSON.stringify(result,null,2));
