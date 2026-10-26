import fs from 'node:fs';
import {createRequire} from 'node:module';
import {configuredSupabase} from './supabase-profile.mjs';
import {ROOT,id,save,fixture} from './lib.mjs';
const require=createRequire(import.meta.url),{Pool}=require('pg'),f=fixture(process.argv[2]);
if(f.scope!=='SUPABASE_BASELINE'||!f.complete)throw new Error('Require approved synthetic fixture');
const pool=new Pool({connectionString:configuredSupabase(),max:1,connectionTimeoutMillis:10000,statement_timeout:5000,application_name:'bbe_perf_test_state_readonly'});
const dir=ROOT+'/results/test-state_'+id();fs.mkdirSync(dir,{recursive:true});let c;
try {
  c=await pool.connect();await c.query('BEGIN READ ONLY');
  const quiz=await c.query('SELECT question_count,duration_minutes FROM public.assessments WHERE id=$1::uuid',[f.users[0].assessmentId]);
  const attempts=await c.query("SELECT array_position($1::uuid[],user_id)-1 synthetic_user_index,status,started_at AT TIME ZONE 'UTC' started_at,expires_at AT TIME ZONE 'UTC' expires_at,submitted_at AT TIME ZONE 'UTC' submitted_at,score,passed FROM public.attempts WHERE user_id=ANY($1::uuid[]) ORDER BY started_at",[f.users.map(u=>u.id)]);
  const stars=await c.query('SELECT source_type,sum(amount)::int stars,count(*)::int entries FROM public.star_ledger WHERE user_id=ANY($1::uuid[]) GROUP BY source_type',[f.users.map(u=>u.id)]);
  await c.query('COMMIT');const r={at:new Date().toISOString(),scope:'SYNTHETIC_COHORT_ONLY_READONLY',quiz:quiz.rows,attempts:attempts.rows,stars:stars.rows};save(dir+'/state.json',r);console.log(JSON.stringify({directory:dir,...r},null,2));
}finally{if(c)c.release();await pool.end();}
