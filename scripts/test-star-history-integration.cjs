// Real history API and PostgreSQL; refuse all application/remote databases.
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs')
const {randomUUID}=require('node:crypto')
const target=process.env.TEST_DATABASE_URL
if(target!=='postgresql://chapter_fix_test@127.0.0.1:55439/bbe_test_learning_cycles')throw new Error('Explicit isolated loopback test database required')
process.env.DATABASE_URL=target;process.env.DIRECT_URL=target
process.env.JWT_ACCESS_SECRET='star-history-local-test-signing-key'
require('ts-node').register({project:'tsconfig.test.json'})
const Module=require('node:module'),resolve=Module._resolveFilename
Module._resolveFilename=function(name,...args){return resolve.call(this,name.startsWith('@/')?path.resolve('src',name.slice(2)):name,...args)}
const {prisma:db}=require('../src/lib/prisma')
const {NextRequest}=require('next/server')
async function main(){
 const key=randomUUID(),now=new Date()
 const user=await db.user.create({data:{email:`history-${key}@example.invalid`,password_hash:'-',role:'MEMBER'}})
 const other=await db.user.create({data:{email:`history-other-${key}@example.invalid`,password_hash:'-',role:'MEMBER'}})
 const unit=await db.organizationUnit.create({data:{type:'CHAPTER',name:key}})
 const chapter=await db.chapter.create({data:{name:key,organization_unit_id:unit.id}})
 await db.chapterMember.create({data:{user_id:user.id,chapter_id:chapter.id}})
 await db.organizationMembership.create({data:{user_id:user.id,unit_id:unit.id}})
 const assessmentId=randomUUID(),attemptA=randomUUID(),attemptB=randomUUID()
 const {SignJWT}=await import('jose')
 const token=await new SignJWT({role:'MEMBER'}).setProtectedHeader({alg:'HS256'}).setSubject(user.id).setIssuedAt().setExpirationTime('2h').sign(new TextEncoder().encode(process.env.JWT_ACCESS_SECRET))
 const {GET}=require('../src/app/api/v1/stars/me/route')
 const call=async(page='1',limit='20',balanceOnly=false)=>{
  const response=await GET(new NextRequest(`http://127.0.0.1:3118/api/v1/stars/me?page=${page}&limit=${limit}${balanceOnly?'&balanceOnly=1':''}`,{headers:{Authorization:`Bearer ${token}`}}))
  assert.equal(response.status,200);return response.json()
 }
 const add=(amount,day,extra={})=>db.starLedger.create({data:{user_id:user.id,amount,reason:'MODULE_QUIZ_PASS',reward_key:randomUUID(),source_type:'ASSESSMENT',source_id:assessmentId,awarded_at:new Date(Date.UTC(2026,0,day)),metadata:{attemptId:attemptA},...extra}})
 const legacyIds=[]
 for(let i=0;i<9;i++)legacyIds.push((await add(1,1,{awarded_at:new Date(Date.UTC(2026,0,1,0,0,i))})).id)
 const first=await call('1','2')
 assert.equal(first.items.length,1,'nine +1 rewards from one Quiz attempt must display as one history event')
 assert.equal(first.items[0].amount,9)
 assert.equal(first.totalItems,1);assert.equal(first.totalPages,1);assert.equal(first.balance,9)
 assert.equal(await db.starLedger.count({where:{user_id:user.id}}),9,'read model must not rewrite reward ledger')
 console.log('PASS: nine +1 Quiz entries display as one +9 event before pagination')
 const oldCycle=await db.learningCycle.create({data:{user_id:user.id,starts_at:new Date('2025-01-01'),ends_at:new Date('2025-06-01'),trigger_key:randomUUID()}})
 const newCycle=await db.learningCycle.create({data:{user_id:user.id,starts_at:new Date('2025-06-01'),trigger_key:randomUUID()}})
 const month=await db.competitionMonth.findFirstOrThrow()
 const native={metadata:{attemptId:attemptB},provenance:'NATIVE',learning_cycle_id:oldCycle.id,competition_month_id:month.id}
 await add(9,2,native);await add(2,2,{...native,reason:'MODULE_QUIZ_BONUS'})
 const two=await call()
 assert.equal(two.totalItems,2,'separate attempts remain separate')
 assert.deepEqual(two.items.map(x=>x.amount),[11,9],'pass/bonus of the same attempt are one event; native aggregate remains intact')
 await add(4,3,{...native,learning_cycle_id:newCycle.id})
 assert.equal((await call()).totalItems,3,'different cycles must not merge')
 const videoId=randomUUID()
 for(let i=0;i<2;i++)await add(3,4,{reason:'VIDEO_COMPLETION',source_type:'VIDEO',source_id:videoId})
 for(let i=0;i<2;i++)await add(-2,5,{reason:'ADMIN_ADJUSTMENT',metadata:{attemptId:attemptB}})
 for(let i=0;i<2;i++)await add(1,6,{metadata:{}})
 await add(100,7,{user_id:other.id})
 const all=[]
 for(let page=1;page<=5;page++){
  const result=await call(String(page),'2')
  assert.equal(result.totalItems,9);assert.equal(result.totalPages,5);assert.equal(result.balance,28)
  all.push(...result.items)
 }
 assert.equal(all.length,9);assert.equal(new Set(all.map(x=>x.id)).size,9)
 assert.equal(all.reduce((sum,x)=>sum+x.amount,0),28,'paginated groups preserve balance and exclude other users')
 assert.equal((await call('999','2')).page,5)
 const onlyBalance=await call('1','20',true)
 assert.equal(onlyBalance.balance,28);assert.equal(onlyBalance.items,undefined)
 assert.equal(await db.starLedger.count({where:{user_id:user.id}}),18)
 // Keep a minimal, deterministic one-event fixture for the actual browser screen.
 await db.starLedger.deleteMany({where:{user_id:user.id,id:{notIn:legacyIds}}})
 assert.equal((await call()).items[0].amount,9)
 fs.mkdirSync('scratch/star-history',{recursive:true})
 fs.writeFileSync('scratch/star-history/browser-fixture.json',JSON.stringify({token,user:{id:user.id,role:'MEMBER',chapterId:chapter.id},rawCount:9}))
 console.log('PASS: attempt/cycle isolation, bonus grouping, videos/adjustments/unknown legacy untouched, grouped pagination, unchanged balances/ledger, account privacy, balance-only path')
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>db.$disconnect())
