import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { ROOT,REPO,SANDBOX,localDatabase,safeEnv,id,save,freeGiB,fixture,assertFixture } from './lib.mjs';
import { target,integer } from './config.js';
import { snapshot,compare } from './audit.mjs';
import { writeRunReport } from './summarize.mjs';
import { configuredSupabase,SUPABASE_BASELINE_MAX_VUS } from './supabase-profile.mjs';
const require=createRequire(import.meta.url);
const {Pool}=require('pg');
const args=process.argv.slice(2), arg=(k,d)=>{const i=args.indexOf('--'+k);return i<0?d:args[i+1];};
const mode=arg('mode','mixed'), vus=integer(arg('vus',10),10,1,1000);
const hold=integer(arg('hold',vus>=500?300:vus<=10?120:180),120,10,3600);
const ramp=integer(arg('ramp',30),30,1,600), recovery=integer(arg('recovery',120),120,10,900);
const loginRate=integer(arg('login-rate',10),10,1,1000);
const requestTimeout=integer(arg('request-timeout',10),10,1,30),sqlLog=args.includes('--sql-log');
const profileCpu=args.includes('--profile-cpu'),userOffset=integer(arg('user-offset',0),0,0,999);
if(profileCpu && vus!==1)throw new Error('Request CPU profiling requires exactly 1 VU');
const errorLimit=Number(arg('error-limit',0.01)),p95Ms=Number(arg('p95-ms',1500));
if(!(errorLimit>0 && errorLimit<=0.1 && p95Ms>0 && Number.isFinite(p95Ms)))throw new Error('Invalid thresholds');
const base=target(arg('base','http://127.0.0.1:3100'));
if(!base.startsWith('http://127.0.0.1:')) throw new Error('Runner binds literal IPv4 loopback; use 127.0.0.1');
const staticOnly=mode==='static-smoke';
const remote=args.includes('--supabase-baseline');
if(remote && (vus>SUPABASE_BASELINE_MAX_VUS || hold>240 || !['mixed','dashboard','video','quiz','leaderboard','diagnostic-read'].includes(mode)))
  throw new Error('Supabase baseline permits only steady learner modes, <=10 VUs, hold <=240s; no spikes');
if(remote && requestTimeout>10 && vus!==1)throw new Error('Extended timeout is diagnostic-only at exactly 1 VU');
if(remote && ramp<30)throw new Error('Supabase baseline ramp must be at least 30 seconds');
if(mode==='diagnostic-read' && vus!==1)throw new Error('Diagnostic read coverage requires exactly 1 VU');
if(staticOnly && vus>5) throw new Error('Static smoke limited to 5 VUs; cannot establish learner capacity');
const db=staticOnly?'postgresql://disabled:disabled@127.0.0.1:1/bbe_loadtest':remote?configuredSupabase():localDatabase(process.env.LOAD_DATABASE_URL);
const fixtureName=arg('fixture','users.private.json');
const f=staticOnly?null:fixture(fixtureName);
if(f) assertFixture(db,f,remote?vus:1000);
if(f && userOffset+vus>f.users.length)throw new Error('Offset would reuse or exceed fixture identities');
if(remote && (f.scope!=='SUPABASE_BASELINE' || !f.complete || f.users.length>10))throw new Error('Require complete dedicated bounded Supabase fixture');
if(!fs.existsSync(path.join(SANDBOX,'.next/BUILD_ID'))) throw new Error('Production snapshot not built; run prepare.mjs first');
const minFree=vus>=750?6:vus>=300?4:staticOnly?1:2;
if(freeGiB()<minFree) throw new Error(`Safety gate: need >=${minFree} GiB available for this co-located run`);
// Refuse an occupied port; never target an unknown local dev/proxy process.
await new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(Number(base.split(':').pop()),'127.0.0.1',()=>s.close(resolve));});
const runId=id(), dir=path.join(ROOT,'results',runId);fs.mkdirSync(dir,{recursive:true});
const metadata={runId,startedAt:new Date().toISOString(),mode,vusConfigured:vus,hold,ramp,recovery,base,
  scenarioSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,'scenarios/learners.js'))).digest('hex'),
  requestTimeoutSeconds:requestTimeout,sqlLogging:sqlLog,diagnosticOnly:p95Ms>1500||requestTimeout>10,
  requestCpuProfiling:profileCpu,userOffset,
  node:process.version,platform:process.platform,cpu:os.cpus()[0].model,logicalCpus:os.cpus().length,totalMemoryBytes:os.totalmem(),
  buildId:fs.readFileSync(path.join(SANDBOX,'.next/BUILD_ID'),'utf8').trim(),resourceAbort:null,
  database:staticOnly?'disabled':remote?'owner-authorized Supabase Free, bounded baseline':'dedicated loopback PostgreSQL',thresholdAssumptions:{errorRate:errorLimit,p95Ms},
};
let backend,k6,monitor,timer,pool,busy=false,before,summary,abortReason=null,pressure=0;
const backendLog=fs.openSync(path.join(dir,'backend.log'),'wx'), k6Log=fs.openSync(path.join(dir,'k6.log'),'wx');
const stopFile=path.join(dir,'monitor.stop');
function stopLoad(reason) { abortReason=reason; if(k6 && k6.exitCode===null) k6.kill('SIGINT'); }
const terminate=()=>stopLoad('Interrupted by operator');process.once('SIGINT',terminate);
try {
  const backendEnv=safeEnv(db);
  if(profileCpu){backendEnv.NODE_OPTIONS+=' --require='+path.join(ROOT,'request-profiler.cjs');backendEnv.PERF_REQUEST_OUTPUT=path.join(dir,'request-cpu.jsonl');}
  if(sqlLog)backendEnv.PRISMA_QUERY_LOG='1';
  backend=spawn(process.execPath,[path.join(REPO,'node_modules/next/dist/bin/next'),'start','-H','127.0.0.1','-p',base.split(':').pop()],{cwd:SANDBOX,env:backendEnv,stdio:['ignore',backendLog,backendLog]});
  backend.once('error',e=>{abortReason='Backend spawn failed: '+e.code;});
  let ready=false;
  for(let i=0;i<30;i++) {
    if(backend.exitCode!==null || abortReason) throw new Error('Backend failed to start');
    try { const r=await fetch(base+'/login',{redirect:'manual',signal:AbortSignal.timeout(1500)});if(r.status===200){ready=true;break;} } catch {}
    await new Promise(r=>setTimeout(r,1000));
  }
  if(!ready) throw new Error('Backend readiness timeout');
  if(f) {
    pool=new Pool({connectionString:db,max:1,connectionTimeoutMillis:3000,statement_timeout:3000,application_name:'bbe_loadtest_observer'});
    // Actual DB must be reachable before launching k6.
    await pool.query('SELECT 1');before=await snapshot(db,f);save(path.join(dir,'before.json'),before);
  }
  const env={...safeEnv(db),BASE_URL:base,MAX_VUS:String(vus),MODE:mode,HOLD_SECONDS:String(hold),RAMP_SECONDS:String(ramp),RECOVERY_SECONDS:String(recovery),LOGIN_RATE:String(loginRate),FIXTURE_FILE:fixtureName,ERROR_LIMIT:String(errorLimit),P95_MS:String(p95Ms),REQUEST_TIMEOUT_SECONDS:String(requestTimeout),USER_OFFSET:String(userOffset),SAFETY_PREFLIGHT:'verified',RUN_DIR:'results/'+runId};
  k6=spawn('k6',['--config','k6.config.json','run','--no-usage-report','--out','json='+path.join(dir,'samples.json'),'--out','csv='+path.join(dir,'samples.csv'),'scenarios/learners.js'],{cwd:ROOT,env,stdio:['ignore',k6Log,k6Log]});
  const monitorLog=fs.openSync(path.join(dir,'monitor.log'),'wx');
  monitor=spawn('powershell.exe',['-NoProfile','-File',path.join(ROOT,'monitor.ps1'),'-BackendPid',String(backend.pid),'-K6Pid',String(k6.pid),'-Output',path.join(dir,'process.csv'),'-StopFile',stopFile],{windowsHide:true,stdio:['ignore',monitorLog,monitorLog]});
  monitor.once('error',()=>stopLoad('Process telemetry unavailable'));
  monitor.once('exit',()=>{if(!fs.existsSync(stopFile))stopLoad('Process telemetry exited unexpectedly');});
  timer=setInterval(async()=>{
    if(busy)return;busy=true;
    try {
      const resource={at:new Date().toISOString(),freeMemoryBytes:os.freemem(),loadAverage:os.loadavg()};
      fs.appendFileSync(path.join(dir,'resources.jsonl'),JSON.stringify(resource)+'\n');
      pressure=freeGiB()<0.75?pressure+1:0;
      if(pressure>=3)stopLoad('Available RAM <0.75 GiB for 15 seconds');
      const disk=fs.statfsSync(ROOT);if(disk.bavail*disk.bsize<2*2**30)stopLoad('Less than 2 GiB disk available for evidence');
      if(backend.exitCode!==null)stopLoad('Backend exited');
      if(pool){
        const {rows}=await pool.query("SELECT count(*)::int connections, count(*) FILTER (WHERE state='active')::int active, count(*) FILTER (WHERE wait_event_type='Lock')::int lock_waiters, coalesce(max(extract(epoch from clock_timestamp()-query_start)) FILTER (WHERE state='active' AND pid<>pg_backend_pid()),0)::float8 longest_active_seconds, current_setting('max_connections')::int max_connections FROM pg_stat_activity WHERE datname=current_database()");
        fs.appendFileSync(path.join(dir,'database.jsonl'),JSON.stringify({at:resource.at,...rows[0]})+'\n');
        const r=rows[0];if(r.connections>r.max_connections*0.8 || r.longest_active_seconds>30)stopLoad('DB connection/query safety threshold exceeded');
      }
    } catch { stopLoad('Resource/DB observation failed'); } finally {busy=false;}
  },5000);
  metadata.k6Exit=await new Promise((resolve,reject)=>{k6.once('error',reject);k6.once('exit',resolve);});
  clearInterval(timer);while(busy)await new Promise(r=>setTimeout(r,50));
  const summaryPath=path.join(dir,'summary.json');
  if(fs.existsSync(summaryPath))summary=JSON.parse(fs.readFileSync(summaryPath,'utf8'));
  if(!summary)throw new Error('Missing k6 summary; run cannot qualify');
  if(f){const after=await snapshot(db,f);save(path.join(dir,'after.json'),after);save(path.join(dir,'integrity.json'),compare(before,after,summary,f));}
} catch(e) {metadata.failure=e.message;process.exitCode=1;}
finally {
  clearInterval(timer);if(pool)await pool.end();
  fs.writeFileSync(stopFile,'stop');
  if(k6 && k6.exitCode===null)k6.kill('SIGINT');
  if(backend && backend.exitCode===null)backend.kill();
  if(monitor){await new Promise(r=>setTimeout(r,5500));if(monitor.exitCode===null)monitor.kill();}
  fs.closeSync(backendLog);fs.closeSync(k6Log);
  metadata.resourceAbort=abortReason;metadata.finishedAt=new Date().toISOString();
  save(path.join(dir,'metadata.json'),metadata);writeRunReport(dir);
  if(metadata.k6Exit!==0 || abortReason || metadata.failure)process.exitCode=1;
  if(fs.existsSync(path.join(dir,'integrity.json'))&&!JSON.parse(fs.readFileSync(path.join(dir,'integrity.json'),'utf8')).passed)process.exitCode=1;
  console.log(JSON.stringify({runId,path:dir,exit:process.exitCode||0}));
}
