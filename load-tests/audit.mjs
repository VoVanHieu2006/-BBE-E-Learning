import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {PrismaClient}=require('@prisma/client');
export async function snapshot(db, fixture) {
  const p=new PrismaClient({datasources:{db:{url:db}}});
  const ids=fixture.users.map(u=>u.id);
  try {
    const [progress,cycleProgress,replay,attempts,ledger] = await Promise.all([
      p.lessonProgress.findMany({where:{user_id:{in:ids}}}),
      p.cycleLessonProgress.findMany({where:{user_id:{in:ids}}}),
      p.monthlyVideoReplay.findMany({where:{user_id:{in:ids}}}),
      p.attempt.findMany({where:{user_id:{in:ids}},select:{id:true,user_id:true,assessment_id:true,status:true,passed:true,score:true,submitted_at:true}}),
      p.starLedger.findMany({where:{user_id:{in:ids}},select:{user_id:true,amount:true,source_type:true,source_id:true,reward_key:true,competition_month_id:true,learning_cycle_id:true}}),
    ]);
    return {at:new Date().toISOString(),progress,cycleProgress,replay,attempts,ledger};
  } finally {await p.$disconnect();}
}
export function compare(before,after,summary,fixture) {
  const errors=[];
  for(const [table,key,field,completed] of [
    ['progress',r=>r.user_id+':'+r.lesson_id,'furthest_watched_position_seconds','completed'],
    ['cycleProgress',r=>r.user_id+':'+r.lesson_id+':'+r.learning_cycle_id,'furthest_seconds','completed_at'],
    ['replay',r=>r.user_id+':'+r.video_id+':'+r.learning_cycle_id+':'+r.competition_month_id,'furthest_seconds','completed_at'],
  ]) {
    const rows=new Map(after[table].map(r=>[key(r),r]));
    for(const old of before[table]) {
      const current=rows.get(key(old));
      if(!current || (current[field]||0)<(old[field]||0) || (old[completed]&&!current[completed])) errors.push(`${table}: missing/regressed progress`);
    }
  }
  const rewardKeys=after.ledger.map(r=>r.reward_key);
  if(new Set(rewardKeys).size!==rewardKeys.length) errors.push('Duplicate reward_key');
  const quizRewards=new Map();
  for(const r of after.ledger.filter(r=>r.source_type==='ASSESSMENT')) {
    const key=[r.user_id,r.source_id,r.competition_month_id,r.learning_cycle_id].join(':');
    quizRewards.set(key,(quizRewards.get(key)||0)+r.amount);
  }
  if([...quizRewards.values()].some(n=>n>10)) errors.push('Synthetic 10-question quiz reward exceeded 10');
  const oldIds=new Set(before.attempts.filter(a=>a.status==='SUBMITTED').map(a=>a.id));
  const submitted=after.attempts.filter(a=>a.status==='SUBMITTED'&&!oldIds.has(a.id));
  const ack=summary.metrics?.submit_acks?.values?.count||0;
  if(submitted.length!==ack) errors.push('DB newly submitted attempts != acknowledged submissions');
  if(submitted.some(a=>!a.passed || Number(a.score)!==1)) errors.push('Synthetic correct answers not graded 100%');
  if(fixture) {
    const sum=(rows,type)=>rows.filter(r=>r.source_type===type).reduce((n,r)=>n+r.amount,0);
    const quizBudget=fixture.quizQuestionCount||10;
    if(sum(after.ledger,'ASSESSMENT')-sum(before.ledger,'ASSESSMENT')!==ack*quizBudget) errors.push('Quiz ledger delta differs from expected stars per fresh correct submission');
    if(sum(after.ledger,'VIDEO')-sum(before.ledger,'VIDEO')!==(summary.metrics?.video_stars_acknowledged?.values?.count||0)) errors.push('Video ledger delta differs from acknowledged stars; investigate lost response or write');
    const caps=new Map();
    for(const u of fixture.users){caps.set(u.videoId,Math.max(1,Math.floor(u.duration/60)));caps.set(u.quizVideoId,Math.max(1,Math.floor((u.quizDuration||600)/60)));caps.set(u.completionVideoId,Math.max(1,Math.floor((u.completionDuration||20)/60)));}
    const groups=new Map();
    for(const r of after.ledger.filter(r=>r.source_type==='VIDEO')){
      const key=[r.user_id,r.source_id,r.competition_month_id,r.learning_cycle_id].join(':');
      const amount=(groups.get(key)||0)+r.amount;groups.set(key,amount);
      if(caps.has(r.source_id) && amount>caps.get(r.source_id))errors.push('Video semantic reward budget exceeded despite distinct keys');
    }
  }
  return {passed:errors.length===0,errors:[...new Set(errors)],newSubmissions:submitted.length,acknowledgedSubmissions:ack,
    limitations:['Heartbeat overwrites latest position; cannot prove every heartbeat persisted without durable event IDs.','No audit of users outside synthetic fixture.','Connection/latency recovery requires time-series inspection.']};
}
