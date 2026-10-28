import fs from 'node:fs';
import {createRequire} from 'node:module';
import {configuredSupabase} from './supabase-profile.mjs';
import {ROOT,id,save,RESULTS} from './lib.mjs';
const require=createRequire(import.meta.url),{Pool}=require('pg');
const pool=new Pool({connectionString:configuredSupabase(),max:1,connectionTimeoutMillis:10000,statement_timeout:5000,application_name:'bbe_perf_readonly_inspection'});
const runId='supabase-inspection_'+id(),dir=RESULTS+'/'+runId;fs.mkdirSync(dir,{recursive:true});
const result={at:new Date().toISOString(),kind:'SUPABASE_READONLY_INSPECTION',loadTest:false,queries:[]};
let client;
try {
  client=await pool.connect();await client.query('BEGIN READ ONLY');
  for(const [name,sql]of [
    ['limits',"SELECT current_setting('max_connections')::int max_connections, current_setting('server_version_num') server_version_num, pg_database_size(current_database())::text database_bytes, pg_has_role(current_user, 'pg_read_all_stats', 'MEMBER') can_read_all_stats"],
    ['connections',"SELECT count(*)::int connections, count(*) FILTER(WHERE state='active' AND pid<>pg_backend_pid())::int active_other, count(*) FILTER(WHERE wait_event_type='Lock')::int lock_waiters FROM pg_stat_activity WHERE datname=current_database()"],
    ['row_estimates',"SELECT schemaname,relname table_name,n_live_tup estimated_rows FROM pg_stat_user_tables WHERE schemaname='public' AND relname IN ('users','courses','lessons','videos','attempts','star_ledger','lesson_progress','monthly_video_replays') ORDER BY relname"],
    ['learning_policy',"SELECT cutover_at IS NOT NULL AND mapping_approved_at IS NOT NULL AND cutover_at<=now() active_policy FROM learning_policy WHERE id='default'"],
    ['current_month',"SELECT state, starts_at, ends_at FROM competition_months WHERE starts_at<=now() AND ends_at>now() ORDER BY starts_at DESC LIMIT 1"],
  ]) {
    const start=performance.now(),r=await client.query(sql);
    result.queries.push({name,wallMs:performance.now()-start,rows:r.rows});
  }
  await client.query('COMMIT');result.completed=true;
}catch(e){result.completed=false;result.errorCode=e.code||'CONNECTION_ERROR';console.error('Read-only Supabase inspection failed; code '+result.errorCode);process.exitCode=1;}
finally{if(client)client.release();await pool.end();save(dir+'/inspection.json',result);console.log(JSON.stringify({directory:dir,...result},null,2));}
