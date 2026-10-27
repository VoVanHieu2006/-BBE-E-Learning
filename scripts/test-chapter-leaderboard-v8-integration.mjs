// Independent current-spec API oracle. Does not import the score implementation.
// Writes only fixtures into a registered, backed-up development namespace.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { SignJWT } from 'jose'
import guard from './development-integration-target.cjs'
const target=guard.loadDevelopmentTarget(process.env.TEST_DATABASE_URL,'leaderboard')
if(!target)throw Error('Explicit verified development namespace required')
const app=new URL(process.env.TEST_APP_URL)
guard.assertServerAttestation(target,app)
const prisma=new PrismaClient({datasourceUrl:process.env.TEST_DATABASE_URL})
const prefix=`lb-v8-${randomUUID()}`
const results=[]
const check=(name,fn)=>fn().then(()=>{results.push({name,status:'PASS'});console.log(`PASS ${name}`)})
try{
  await guard.assertPrismaIsolation(prisma,target)
  assert.equal(await prisma.user.count(),0,'This oracle requires a fresh registered namespace')
  const now=new Date(),start=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1)),end=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+1,1))
  const month=await prisma.competitionMonth.create({data:{key:start.toISOString().slice(0,7),starts_at:start,ends_at:end}})
  const admin=await prisma.user.create({data:{email:`${prefix}-admin@example.invalid`,password_hash:'test-only',role:'ADMIN'}})
  const unit=await prisma.organizationUnit.create({data:{name:prefix,type:'CHAPTER'}})
  const chapter=await prisma.chapter.create({data:{name:prefix,organization_unit_id:unit.id}})
  const dept=await prisma.organizationUnit.create({data:{name:prefix+'-department',type:'DEPARTMENT',parent_id:unit.id}})
  const program=await prisma.learningProgram.create({data:{code:'CORE_MEMBER',name:'Fixture core',is_core:true,sort_order:0}})
  const course=await prisma.course.create({data:{title:prefix,created_by:admin.id,program_id:program.id,status:'PUBLISHED'}})
  const session=await prisma.session.create({data:{course_id:course.id,title:'Fixture session',sort_order:0}})
  const lesson=await prisma.lesson.create({data:{session_id:session.id,title:'Fixture lesson',sort_order:0}})
  const members=[]
  for(let i=0;i<28;i++){
    const user=await prisma.user.create({data:{email:`${prefix}-${i}@example.invalid`,password_hash:'test-only',role:'MEMBER'}})
    members.push(user)
    await prisma.chapterMember.create({data:{user_id:user.id,chapter_id:chapter.id}})
    // Same Chapter through three aliases must still count once.
    await prisma.organizationMembership.createMany({data:[unit.id,dept.id].map(unit_id=>({user_id:user.id,unit_id}))})
    const cycle=await prisma.learningCycle.create({data:{user_id:user.id,chapter_id:chapter.id,trigger_key:`${prefix}-${i}`,starts_at:new Date()}})
    if(i<20)await prisma.cycleLessonProgress.create({data:{user_id:user.id,lesson_id:lesson.id,learning_cycle_id:cycle.id,completed_at:new Date()}})
  }
  await prisma.starLedger.create({data:{user_id:members[0].id,chapter_at_award_id:chapter.id,competition_month_id:month.id,amount:126,reason:'ADMIN_ADJUSTMENT',reward_key:prefix,source_type:'USER',source_id:members[0].id,provenance:'NATIVE'}})
  const token=await new SignJWT({role:'ADMIN'}).setProtectedHeader({alg:'HS256'}).setSubject(admin.id).setIssuedAt().setExpirationTime('15m').sign(new TextEncoder().encode(process.env.JWT_ACCESS_SECRET))
  const put=(status,access=token)=>fetch(`${app.origin}/api/v1/chapters/${chapter.id}/kpi`,{method:'PUT',headers:{'content-type':'application/json',...(access?{authorization:`Bearer ${access}`}:{})},body:JSON.stringify({month:month.key,status})})
  const board=async()=>{const r=await fetch(`${app.origin}/api/v1/leaderboard/chapters`);assert.equal(r.status,200);return r.json()}
  await check('KPI unauthenticated mutation rejected',async()=>assert.equal((await put('YELLOW',null)).status,401))
  await check('KPI invalid status rejected',async()=>assert.equal((await put('INVALID')).status,400))
  await check('Yellow: 126 / 28 = 4.5; aliases deduplicated; 20 / 28 qualified',async()=>{
    assert.equal((await put('YELLOW')).status,200)
    const b=await board();assert.equal(b.formulaVersion,'chapter-v8-a-over-n');assert.equal(b.items.length,1)
    const r=b.items[0];assert.equal(r.chapterId,chapter.id);assert.equal(r.memberCount,28);assert.equal(r.totalStars,126);assert.equal(r.score,4.5);assert.equal(r.kpi.bonus,0);assert.equal(r.completion.atLeast70Percent,71.4)
  })
  await check('Green keeps score 4.5; KPI mutation invalidates cached board',async()=>{
    assert.equal((await put('GREEN')).status,200);const b=await board();assert.equal(b.items[0].score,4.5);assert.equal(b.items[0].kpi.status,'GREEN');assert.equal(b.items[0].kpi.bonus,0)
  })
  await check('Red excludes the Chapter without changing star ledger',async()=>{
    assert.equal((await put('RED')).status,200);const b=await board();assert.equal(b.items.length,0);assert.equal(b.excluded.length,1);assert.equal(b.excluded[0].chapterId,chapter.id);assert.equal((await prisma.starLedger.aggregate({_sum:{amount:true}}))._sum.amount,126)
  })
  console.log(JSON.stringify({status:'PASS',oracle:'docs/PHASE_3_COMPREHENSIVE_REPORT.md + independent 126/28',assertions:results.length,prefix,schema:target.schema,cleanup:'All fixtures retained'}))
}catch(error){console.error(error.stack);process.exitCode=1}
finally{console.log(`Fixture namespace retained: ${target.schema}; prefix ${prefix}`);await prisma.$disconnect()}
