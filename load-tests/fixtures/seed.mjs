import fs from 'node:fs';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { ROOT, localDatabase, save } from '../lib.mjs';
const require=createRequire(import.meta.url);
const {PrismaClient}=require('@prisma/client');
const bcrypt=require('bcryptjs');
const db=localDatabase(process.env.LOAD_DATABASE_URL);
const outIndex=process.argv.indexOf('--out');
const outputName=outIndex<0?'users.private.json':process.argv[outIndex+1];
if(!/^[a-zA-Z0-9_-]+\.private\.json$/.test(outputName)) throw new Error('Invalid private fixture name');
const out=ROOT+'/fixtures/'+outputName;
if(fs.existsSync(out)) throw new Error('Fixture exists; never overwrite accounts/run evidence');
const prisma=new PrismaClient({datasources:{db:{url:db}}});
const run=crypto.randomUUID(), now=new Date(), old=new Date(Date.now()-86400000);
const password=crypto.randomBytes(24).toString('base64url');
const hash=await bcrypt.hash(password,12);
const users=[];
try {
  // Refuse real accounts. Repeats create a fresh cohort to preserve cooldown rules.
  if (await prisma.user.count({where:{NOT:{email:{endsWith:'@loadtest.invalid'}}}})) throw new Error('Non-synthetic accounts detected; use a dedicated DB');
  const policy=await prisma.learningPolicy.findUnique({where:{id:'default'}});
  if(policy && (!policy.cutover_at || !policy.mapping_approved_at || policy.cutover_at>now)) throw new Error('Existing policy incompatible; no policy overwrite');
  if(!policy) await prisma.learningPolicy.create({data:{id:'default',cutover_at:old,mapping_approved_at:old}});
  const local=new Date(now.getTime()+7*3600000), y=local.getUTCFullYear(), m=local.getUTCMonth();
  const monthKey=`${y}-${String(m+1).padStart(2,'0')}`;
  const month=await prisma.competitionMonth.findUnique({where:{key:monthKey}}) || await prisma.competitionMonth.create({data:{key:monthKey,starts_at:old,ends_at:new Date(Date.UTC(y,m+1,1)-7*3600000)}});
  if(month.state!=='OPEN')throw new Error('Competition month closed');
  const dna=await prisma.organizationUnit.create({data:{name:'LOADTEST '+run,type:'DNA',status:'ACTIVE'}});
  const chapter=await prisma.chapter.create({data:{name:'LOADTEST '+run,status:'ACTIVE'}});
  const admin=await prisma.user.create({data:{email:`admin-${run}@loadtest.invalid`,password_hash:hash,role:'ADMIN'}});
  // Separate first lessons avoid progression shortcuts and preserve quiz prerequisites.
  const resources=[];
  for(let c=0;c<3;c++) {
    const course=await prisma.course.create({data:{title:`LOADTEST ${run} ${c}`,created_by:admin.id,status:'PUBLISHED',visibility:'PUBLIC',published_at:now}});
    const session=await prisma.session.create({data:{course_id:course.id,title:'Chương giả lập',sort_order:1}});
    const lesson=await prisma.lesson.create({data:{session_id:session.id,title:'Bài giả lập',sort_order:1}});
    const duration=c===2?20:c===0?1800:600;
    const video=await prisma.video.create({data:{lesson_id:lesson.id,youtube_video_id:'LOADTEST_NO_MEDIA',duration_seconds:duration}});
    let assessment, correctAnswers={};
    if(c===1) {
      assessment=await prisma.assessment.create({data:{lesson_id:lesson.id,title:'Quiz giả lập',created_by:admin.id,question_count:10,duration_minutes:30}});
      for(let q=0;q<10;q++) {
        const question=await prisma.question.create({data:{assessment_id:assessment.id,question_text:`Câu giả lập ${q+1}`,sort_order:q}});
        const option=await prisma.questionOption.create({data:{question_id:question.id,option_text:'Đúng',is_correct:true,sort_order:0}});
        await prisma.questionOption.create({data:{question_id:question.id,option_text:'Sai',sort_order:1}});
        correctAnswers[question.id]=option.id;
      }
    }
    resources.push({course,lesson,video,duration,assessment,correctAnswers});
  }
  // Sequential bounded batches: seeding itself is not a hidden load test.
  for(let start=0;start<1000;start+=25) {
    const batch=Array.from({length:25},(_,j)=>({id:crypto.randomUUID(),email:`learner-${run}-${start+j}@loadtest.invalid`,password_hash:hash,role:'MEMBER',status:'ACTIVE'}));
    await prisma.user.createMany({data:batch});
    await prisma.organizationMembership.createMany({data:batch.map(u=>({user_id:u.id,unit_id:dna.id,status:'ACTIVE',starts_at:now}))});
    for(const u of batch) {
      const cycle=await prisma.learningCycle.create({data:{user_id:u.id,trigger_key:`load:${run}:${u.id}`,starts_at:now}});
      await prisma.learningPath.create({data:{user_id:u.id,learning_cycle_id:cycle.id,starts_at:now}});
      await prisma.userLearningAssignment.createMany({data:resources.map(r=>({user_id:u.id,course_id:r.course.id,learning_cycle_id:cycle.id,mandatory:false,status:'ASSIGNED'}))});
      const quiz=resources[1];
      await prisma.lessonProgress.create({data:{user_id:u.id,lesson_id:quiz.lesson.id,furthest_watched_position_seconds:600,last_position_seconds:600,last_watched_at:now}});
      await prisma.cycleLessonProgress.create({data:{user_id:u.id,lesson_id:quiz.lesson.id,learning_cycle_id:cycle.id,furthest_seconds:600,unlocked_at:now}});
      await prisma.monthlyVideoReplay.create({data:{user_id:u.id,video_id:quiz.video.id,learning_cycle_id:cycle.id,competition_month_id:month.id,furthest_seconds:600,completed_at:now,last_heartbeat_at:now}});
      await prisma.starLedger.create({data:{user_id:u.id,amount:10,reason:'VIDEO_COMPLETION',source_type:'VIDEO',source_id:quiz.video.id,reward_key:`load-history:${run}:${u.id}`,learning_cycle_id:cycle.id,competition_month_id:month.id,provenance:'LOADTEST'}});
      users.push({id:u.id,email:u.email,password,dnaId:dna.id,cycleId:cycle.id,courseId:resources[0].course.id,lessonId:resources[0].lesson.id,videoId:resources[0].video.id,duration:1800,assessmentId:quiz.assessment.id,correctAnswers:quiz.correctAnswers,quizVideoId:quiz.video.id,completionLessonId:resources[2].lesson.id,completionVideoId:resources[2].video.id,completionDuration:20});
    }
    console.log(`Seeded ${start+25}/1000 synthetic learners`);
  }
  save(out,{run,createdAt:now,databaseFingerprint:crypto.createHash('sha256').update(db).digest('hex'),users});
  console.log('Private fixture saved; no credentials printed. No reset/delete performed.');
} finally {await prisma.$disconnect();}
