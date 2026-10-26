import fs from 'node:fs';
import {createRequire} from 'node:module';
import {configuredSupabase} from './supabase-profile.mjs';
import {ROOT,id,save,fixture} from './lib.mjs';
const require=createRequire(import.meta.url),{Pool}=require('pg');
const name=process.argv[2],f=fixture(name);
if(f.scope!=='SUPABASE_BASELINE'||!f.complete)throw new Error('Require approved synthetic cohort');
const pool=new Pool({connectionString:configuredSupabase(),max:1,connectionTimeoutMillis:10000,statement_timeout:3000,application_name:'bbe_perf_network_calibration'});
const dir=ROOT+'/results/network_'+id();fs.mkdirSync(dir,{recursive:true});
const r={at:new Date().toISOString(),kind:'READONLY_NETWORK_CALIBRATION',roundTripsMs:[],plans:[],note:'Round-trip includes network/driver/pooler/server scheduling; not pure network latency.'};
let c;
try {
  const start=performance.now();c=await pool.connect();r.connectMs=performance.now()-start;
  await c.query('BEGIN READ ONLY');
  for(let i=0;i<8;i++) {const t=performance.now();await c.query('SELECT 1');r.roundTripsMs.push(performance.now()-t);await new Promise(resolve=>setTimeout(resolve,500));}
  for(const [name,query]of [
    ['synthetic-user-index-lookup','SELECT id,status,role FROM public.users WHERE id=$1::uuid'],
    ['synthetic-user-star-sum','SELECT sum(amount) FROM public.star_ledger WHERE user_id=$1::uuid'],
  ]) {
    const t=performance.now(),v=await c.query('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+query,[f.users[0].id]);
    const plan=v.rows[0]['QUERY PLAN'][0];r.plans.push({name,wallMs:performance.now()-t,serverExecutionMs:plan['Execution Time'],serverPlanningMs:plan['Planning Time']});
  }
  await c.query('COMMIT');r.completed=true;
}catch(e){r.completed=false;r.errorCode=e.code||'UNKNOWN';process.exitCode=1;}
finally{if(c)c.release();await pool.end();save(dir+'/calibration.json',r);console.log(JSON.stringify({directory:dir,...r},null,2));}
