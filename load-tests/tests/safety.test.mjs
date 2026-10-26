import test from 'node:test';
import assert from 'node:assert/strict';
import {target,integer,flowForVu,quizThinkSeconds} from '../config.js';
import {localDatabase,safeEnv} from '../lib.mjs';
import {compare} from '../audit.mjs';
test('HTTP target cannot escape loopback or follow redirects',()=>{
  for(const u of ['https://bbe.vercel.app','https://example.com','http://localhost.evil:3100','http://127.0.0.1:3100@evil','http://2130706433:3100','http://127.0.0.1:3100/path','http://127.0.0.1:65536','http://localhost:3000?url=https://example.com']) assert.throws(()=>target(u));
  assert.equal(target('http://127.0.0.1:3100'),'http://127.0.0.1:3100');
});
test('Only named dedicated local DBs; no routing overrides',()=>{
  for(const u of ['postgresql://a:b@remote:5432/bbe_loadtest','postgresql://a:b@localhost:5432/postgres','postgresql://a:b@localhost:5432/bbe_loadtest?host=remote','postgresql://a:b@localhost:5432/bbe_loadtest?schema=real']) assert.throws(()=>localDatabase(u));
  assert.match(localDatabase('postgresql://a:b@127.0.0.1:55432/bbe_loadtest'),/connection_limit=10/);
});
test('VU bounds are strict',()=>{for(const x of [0,1001,1.1,'NaN'])assert.throws(()=>integer(x,10,1,1000));assert.equal(integer(1000,10,1,1000),1000);});
test('Mixed cohort covers all flows at 10 and exact requested ratio at 1000',()=>{
  assert.equal(new Set(Array.from({length:10},(_,i)=>flowForVu(i))).size,4);
  const counts={};for(let i=0;i<1000;i++){const key=flowForVu(i);counts[key]=(counts[key]||0)+1;}
  assert.deepEqual(counts,{dashboard:250,video:400,quiz:200,leaderboard:150});
});
test('Quiz think time respects server deadline and reserves request plus safety margin',()=>{
  assert.equal(quizThinkSeconds(167000,0,30,168),127);
  assert.equal(quizThinkSeconds(600000,0,30,150),150);
  assert.throws(()=>quizThinkSeconds(30000,0,30,120));
});
test('Child env does not inherit cloud credentials',()=>{
  process.env.RESEND_API_KEY='test-should-not-be-inherited';
  const env=safeEnv('postgresql://a:b@127.0.0.1:55432/bbe_loadtest');
  assert.equal(env.RESEND_API_KEY,undefined);assert.equal(env.R2_ENDPOINT,'http://127.0.0.1:1');
  delete process.env.RESEND_API_KEY;
});
test('Integrity audit catches regression, lost submit and over-award',()=>{
  const before={progress:[{user_id:'u',lesson_id:'l',furthest_watched_position_seconds:20,completed:true}],cycleProgress:[],replay:[],attempts:[],ledger:[]};
  const after={...before,progress:[{user_id:'u',lesson_id:'l',furthest_watched_position_seconds:10,completed:false}],ledger:[{user_id:'u',source_type:'ASSESSMENT',source_id:'a',amount:11,reward_key:'r'}]};
  const r=compare(before,after,{metrics:{submit_acks:{values:{count:1}}}});
  assert.equal(r.passed,false);assert.equal(r.errors.length,3);
});
test('Distinct reward keys still cannot exceed video semantic budget',()=>{
  const before={progress:[],cycleProgress:[],replay:[],attempts:[],ledger:[]};
  const row={user_id:'u',source_type:'VIDEO',source_id:'short',amount:1,competition_month_id:'m',learning_cycle_id:'c'};
  const after={...before,ledger:[{...row,reward_key:'r1'},{...row,reward_key:'r2'}]};
  const result=compare(before,after,{metrics:{video_stars_acknowledged:{values:{count:2}}}},{users:[{videoId:'long',quizVideoId:'quiz',completionVideoId:'short'}]});
  assert.equal(result.passed,false);assert.ok(result.errors.includes('Video semantic reward budget exceeded despite distinct keys'));
});
