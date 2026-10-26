// Owner-authorized additive fixture. Reuses content; never changes real users,
// course publication, policies, periods, permissions, schema, or migrations.
import fs from 'node:fs';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {configuredSupabase} from '../supabase-profile.mjs';
import {ROOT,save,id} from '../lib.mjs';
const require=createRequire(import.meta.url),{PrismaClient}=require('@prisma/client'),bcrypt=require('bcryptjs');
const db=configuredSupabase(),p=new PrismaClient({datasources:{db:{url:db}}});
const resumeIndex=process.argv.indexOf('--resume');
const name=resumeIndex<0?'supabase-'+id()+'.private.json':process.argv[resumeIndex+1];
if(!/^supabase-[a-zA-Z0-9_-]+\.private\.json$/.test(name))throw new Error('Invalid fixture name');
const out=ROOT+'/fixtures/'+name,prior=resumeIndex<0?null:JSON.parse(fs.readFileSync(out,'utf8'));
const now=new Date(),run=prior?.run||crypto.randomUUID(),users=prior?.users||[];
const fingerprint=crypto.createHash('sha256').update(db).digest('hex');
if(prior && (prior.databaseFingerprint!==fingerprint || prior.complete || prior.scope!=='SUPABASE_BASELINE'))throw new Error('Unsafe resume');
const result=prior||{scope:'SUPABASE_BASELINE',run,createdAt:now,complete:false,databaseFingerprint:fingerprint,users};
let stage='read-prerequisites';
function persist(){fs.writeFileSync(out,JSON.stringify(result,null,2),{flag:fs.existsSync(out)?'w':'wx'});}
try {
  const [policy,month,courses]=await Promise.all([
    p.learningPolicy.findUnique({where:{id:'default'}}),
    p.competitionMonth.findFirst({where:{starts_at:{lte:now},ends_at:{gt:now},state:'OPEN'}}),
    p.course.findMany({where:{status:'PUBLISHED',visibility:'PUBLIC'},relationLoadStrategy:'join',include:{sessions:{orderBy:[{sort_order:'asc'},{id:'asc'}],include:{lessons:{orderBy:[{sort_order:'asc'},{id:'asc'}],include:{video:true,assessment:{include:{questions:{include:{options:true}},question_pools:true}}}}}}}}),
  ]);
  if(!policy?.cutover_at || !policy.mapping_approved_at || policy.cutover_at>now || !month)throw new Error('Existing learning policy/month not ready; no changes made');
  const first=courses.map(c=>({course:c,lesson:c.sessions.flatMap(s=>s.lessons)[0]})).filter(r=>r.lesson?.video?.duration_seconds>30);
  function validQuiz(r) {
    const a=r.lesson.assessment;if(!a||a.question_count<1||a.question_count>10||a.questions.length<a.question_count)return false;
    if(a.questions.some(q=>q.options.filter(o=>o.is_correct).length!==1))return false;
    if(a.question_pools.length){const sizes=a.question_pools.map(pool=>a.questions.filter(q=>q.pool_id===pool.id).length);if(a.questions.some(q=>!q.pool_id)||a.question_count<a.question_pools.length||a.question_count>a.question_pools.length*Math.min(...sizes))return false;}
    return true;
  }
  const quiz=first.find(validQuiz),watch=first.filter(r=>r!==quiz).sort((a,b)=>b.lesson.video.duration_seconds-a.lesson.video.duration_seconds)[0];
  if(!quiz||!watch)throw new Error('Need two existing published first lessons, one with valid <=10-question quiz; no content will be edited');
  if(process.argv.includes('--inspect-only')) {
    console.log(JSON.stringify({eligibleCourses:first.length,quizQuestionCount:quiz.lesson.assessment.question_count,watchDuration:watch.lesson.video.duration_seconds,quizDuration:quiz.lesson.video.duration_seconds,writes:0}));
  } else {
    const password=crypto.randomBytes(24).toString('base64url'),hash=await bcrypt.hash(password,12);
    if(await p.user.count({where:{email:{startsWith:`baseline-${run}-`}}})!==users.length)throw new Error('Recorded and database cohort differ; no further writes');
    stage='create-test-groups';
    const dna=prior?.dnaId?await p.organizationUnit.findUnique({where:{id:prior.dnaId}}):await p.organizationUnit.create({data:{name:'LOADTEST '+run,type:'DNA',status:'ACTIVE'}});
    const chapter=prior?.chapterId?await p.chapter.findUnique({where:{id:prior.chapterId}}):await p.chapter.create({data:{name:'LOADTEST '+run,status:'ACTIVE'}});
    if(dna?.name!=='LOADTEST '+run || chapter?.name!=='LOADTEST '+run)throw new Error('Group identity mismatch');
    Object.assign(result,{chapterId:chapter.id,dnaId:dna.id,quizQuestionCount:quiz.lesson.assessment.question_count});
    const correctAnswers=Object.fromEntries(quiz.lesson.assessment.questions.map(q=>[q.id,q.options.find(o=>o.is_correct).id]));
    persist();
    for(let i=users.length;i<10;i++) {
      stage='user-transaction';
      const user=await p.$transaction(async tx=>{
        stage='user-create';
        const u=await tx.user.create({data:{email:`baseline-${run}-${i}@loadtest.invalid`,display_name:`LOADTEST ${i+1}`,password_hash:hash,role:'MEMBER',status:'ACTIVE'}});
        stage='memberships-create';
        await tx.organizationMembership.create({data:{user_id:u.id,unit_id:dna.id,status:'ACTIVE',starts_at:now}});
        stage='cycle-create';
        const cycle=await tx.learningCycle.create({data:{user_id:u.id,trigger_key:`load:${run}:${u.id}`,starts_at:now}});
        stage='path-create';
        await tx.learningPath.create({data:{user_id:u.id,learning_cycle_id:cycle.id,starts_at:now}});
        stage='assignments-create';
        await tx.userLearningAssignment.createMany({data:[watch,quiz].map(r=>({user_id:u.id,course_id:r.course.id,learning_cycle_id:cycle.id,mandatory:false,status:'ASSIGNED'}))});
        const duration=quiz.lesson.video.duration_seconds;
        stage='progress-create';
        await tx.lessonProgress.create({data:{user_id:u.id,lesson_id:quiz.lesson.id,furthest_watched_position_seconds:duration,last_position_seconds:duration,last_watched_at:now}});
        await tx.cycleLessonProgress.create({data:{user_id:u.id,lesson_id:quiz.lesson.id,learning_cycle_id:cycle.id,furthest_seconds:duration,unlocked_at:now}});
        stage='replay-create';
        await tx.monthlyVideoReplay.create({data:{user_id:u.id,video_id:quiz.lesson.video.id,learning_cycle_id:cycle.id,competition_month_id:month.id,furthest_seconds:duration,completed_at:now,last_heartbeat_at:now}});
        stage='history-stars-create';
        await tx.starLedger.create({data:{user_id:u.id,amount:Math.max(1,Math.floor(duration/60)),reason:'VIDEO_COMPLETION',source_type:'VIDEO',source_id:quiz.lesson.video.id,reward_key:`video:${u.id}:${quiz.lesson.video.id}:${month.id}:${cycle.id}`,learning_cycle_id:cycle.id,competition_month_id:month.id,provenance:'NATIVE'}});
        return {id:u.id,email:u.email,password,dnaId:dna.id,cycleId:cycle.id,courseId:watch.course.id,lessonId:watch.lesson.id,videoId:watch.lesson.video.id,duration:watch.lesson.video.duration_seconds,assessmentId:quiz.lesson.assessment.id,correctAnswers,quizVideoId:quiz.lesson.video.id,quizDuration:duration};
      },{maxWait:5000,timeout:20000});
      users.push(user);persist();console.log(`Created synthetic learner ${i+1}/10`);
    }
    result.complete=true;persist();
    console.log(JSON.stringify({fixture:name,accounts:users.length,reusedPublishedContent:true,realAccountsModified:false}));
  }
}catch(e){
  const diagnostic={stage,name:e.name,code:e.code||null,hints:String(e.message).split('\n').filter(l=>/Unknown argument|^Argument `|Error in connector|violates.*constraint/.test(l))};
  result.failure=diagnostic;
  if(result.chapterId){persist();console.error('Partial additive fixture preserved; no cleanup/delete performed');}
  console.error(JSON.stringify(diagnostic));process.exitCode=1;
}finally{await p.$disconnect();}
