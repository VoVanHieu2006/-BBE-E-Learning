// Read-only content discovery. This file has no model mutation calls.
import {createRequire} from 'node:module';
import {configuredSupabase} from './supabase-profile.mjs';
const require=createRequire(import.meta.url),{PrismaClient}=require('@prisma/client');
const p=new PrismaClient({datasources:{db:{url:configuredSupabase()}}});
try {
  const courses=await p.course.findMany({where:{status:'PUBLISHED',visibility:'PUBLIC'},relationLoadStrategy:'join',select:{id:true,sessions:{orderBy:[{sort_order:'asc'},{id:'asc'}],select:{lessons:{orderBy:[{sort_order:'asc'},{id:'asc'}],select:{video:{select:{duration_seconds:true}},assessment:{select:{question_count:true,questions:{select:{options:{select:{is_correct:true}}}}}}}}}}}});
  const first=courses.map(c=>c.sessions.flatMap(s=>s.lessons)[0]).filter(l=>l?.video?.duration_seconds>30);
  console.log(JSON.stringify({kind:'READONLY_CONTENT_DISCOVERY',publishedPublicCourses:courses.length,firstLessonsWithVideo:first.length,quizCandidates:first.filter(l=>l.assessment && l.assessment.question_count<=10 && l.assessment.questions.length>=l.assessment.question_count && l.assessment.questions.every(q=>q.options.filter(o=>o.is_correct).length===1)).map(l=>({questionCount:l.assessment.question_count,videoDuration:l.video.duration_seconds})),writes:0}));
}finally{await p.$disconnect();}
