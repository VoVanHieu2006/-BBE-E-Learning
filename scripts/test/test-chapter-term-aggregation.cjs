const assert = require('node:assert/strict')
const { test } = require('node:test')
const path = require('node:path')
require('ts-node').register({ project: 'tsconfig.test.json' })
const Module = require('node:module'), resolve = Module._resolveFilename
Module._resolveFilename = function (name, ...args) { return resolve.call(this, name.startsWith('@/') ? path.resolve('src', name.slice(2)) : name, ...args) }
global.prisma = {} // aggregation uses only the supplied transaction, never a database
const { chapterSeasonRows } = require('../../src/lib/competition-snapshots')
const at = s => new Date(`${s}T00:00:00+07:00`)
const season = { id: 'spring', starts_at: at('2026-03-01'), ends_at: at('2026-05-01'), reward_boundary_at: at('2026-04-01') }
const term = { id: 'initial', chapter_id: 'chapter', season_id: null, starts_at: at('2026-06-01'), ends_at: null }
const months = [6,7,8,9].map((m, i) => ({ id: `m${m}`, key: `2026-0${m}`, starts_at: at(`2026-0${m}-01`), ends_at: at(`2026-${m===9?'10':`0${m+1}`}-01`), state: i===3?'OPEN':'CLOSED' }))
const tx = {
  chapter: { findMany: async () => [{ id: 'chapter', name: 'June Chapter', created_at: term.starts_at }] },
  transferSeason: { findUnique: async () => season },
  chapterCompetitionTerm: { findMany: async ({ where }) => where.season_id ? [] : [term] },
  competitionMonth: { findMany: async ({ where }) => months.filter(m => m.starts_at < where.starts_at.lt && m.ends_at > where.ends_at.gt) },
  learningSnapshot: { findUnique: async ({ where }) => {
    const month = months.find(m=>where.key===`ranking:CHAPTER:${m.id}`)
    return month && month.state==='CLOSED' ? { payload: { state: 'FINALIZED', items: [{ chapterId: 'chapter', eligible: true, score: 2, totalStars: 42, stages: [{ startsAt: month.starts_at, endsAt: month.ends_at, memberCount: 21, stars: 42, stageScore: 2 }] }] } } : null
  } },
}
test('initial null-season term contributes closed June-August without treating it as not started', async () => {
  // No open-month fixture here: stop exactly at the close of August.
  const result = await chapterSeasonRows(tx, season.id, at('2026-09-01'))
  assert.equal(result.items[0].score, 6)
  assert.equal(result.items[0].qualifiedMonthCount, 3)
  assert.equal(result.items[0].eligible, true)
})
const { readChapterTermResult } = require('../../src/lib/chapter-term-results')
test('open month is provisional and cannot add official score or qualified months', async () => {
  const result = await readChapterTermResult(tx, 'chapter', at('2026-06-01'), null, at('2026-09-15'), async () => [{ chapterId: 'chapter', eligible: true, score: 3, stages: [{ startsAt: at('2026-09-01'), endsAt: at('2026-09-15'), stars: 63, stageScore: 3 }] }])
  assert.equal(result.score, 6); assert.equal(result.qualifiedMonthCount, 3); assert.equal(result.provisionalScore, 3)
})
test('June-September and October-March initial competition intervals do not overlap', async () => {
  const saved = tx.learningSnapshot.findUnique
  const getMonths = tx.competitionMonth.findMany
  try {
    tx.competitionMonth.findMany = async ({where}) => [...months, { id: 'm10', key:'2026-10', starts_at:at('2026-10-01'), ends_at:at('2026-11-01') }].filter(m=>m.starts_at<where.starts_at.lt && m.ends_at>where.ends_at.gt)
    tx.learningSnapshot.findUnique = async ({where}) => { const m = where.key.endsWith('m10') ? { starts_at:at('2026-10-01'), ends_at:at('2026-11-01') } : months.find(m=>where.key.endsWith(m.id)); return { payload: {state:'FINALIZED',items:[{chapterId:'chapter',eligible:true,score:2,totalStars:42,stages:[{startsAt:m.starts_at,endsAt:m.ends_at,stageScore:2,stars:42}]}]}} }
    const first = await readChapterTermResult(tx, 'chapter',at('2026-06-01'),at('2026-10-01'),at('2026-11-01'),async()=>[],true)
    const second = await readChapterTermResult(tx, 'chapter',at('2026-10-01'),at('2027-04-01'),at('2026-11-01'),async()=>[],true)
    assert.equal(first.score,8); assert.equal(second.score,2); assert.equal(first.totalStars+second.totalStars,210)
  } finally {tx.learningSnapshot.findUnique=saved;tx.competitionMonth.findMany=getMonths}
})
test('missing snapshot is explicit and excludes incomplete totals from ranking', async () => {
  const result=await readChapterTermResult({...tx,learningSnapshot:{findUnique:async()=>null}},'chapter',at('2026-06-01'),at('2026-09-01'),at('2026-10-01'),async()=>[])
  assert.equal(result.missing,true);assert.equal(result.eligible,false);assert.deepEqual(result.exclusionReasons,['SNAPSHOT_MISSING'])
})
test('early September transfer allocates saved stages to separate actual terms', async () => {
  const month={id:'m9',key:'2026-09',starts_at:at('2026-09-01'),ends_at:at('2026-10-01')}
  const payload={state:'FINALIZED',items:[{chapterId:'chapter',eligible:true,score:5,stages:[{startsAt:month.starts_at,endsAt:at('2026-09-10'),stars:42,stageScore:2},{startsAt:at('2026-09-10'),endsAt:month.ends_at,stars:63,stageScore:3}]}]}
  const splitTx={...tx,competitionMonth:{findMany:async()=>[month]},learningSnapshot:{findUnique:async()=>({payload})}}
  const old=await readChapterTermResult(splitTx,'chapter',at('2026-04-01'),at('2026-09-10'),at('2026-10-01'),async()=>[])
  const next=await readChapterTermResult(splitTx,'chapter',at('2026-09-10'),null,at('2026-10-01'),async()=>[])
  assert.equal(old.score,2);assert.equal(next.score,3);assert.equal(old.totalStars+next.totalStars,105)
  assert.equal(payload.items[0].score,5,'snapshot stays immutable')
})
test('legacy unsplit snapshot cannot allocate a partial transfer month by midpoint', async () => {
  const broken={...tx,competitionMonth:{findMany:async()=>[months[2]]},learningSnapshot:{findUnique:async()=>({payload:{state:'FINALIZED',items:[{chapterId:'chapter',eligible:true,score:5,totalStars:105}]}})}}
  const result=await readChapterTermResult(broken,'chapter',at('2026-08-10'),null,at('2026-09-01'),async()=>[])
  assert.equal(result.missing,true);assert.equal(result.score,0)
})
test('missing calendar month cannot silently disappear from official totals',async()=>{
  const gap={...tx,competitionMonth:{findMany:async()=>[months[0],months[2]]}}
  const result=await readChapterTermResult(gap,'chapter',at('2026-06-01'),at('2026-09-01'),at('2026-10-01'),async()=>[])
  assert.equal(result.missing,true);assert.equal(result.eligible,false)
})
for(const [name,stages] of [
  ['gap',[{startsAt:at('2026-06-01'),endsAt:at('2026-06-10'),stars:42,stageScore:2}]],
  ['overlap',[{startsAt:at('2026-06-01'),endsAt:at('2026-06-20'),stars:42,stageScore:2},{startsAt:at('2026-06-10'),endsAt:at('2026-07-01'),stars:42,stageScore:2}]],
])test(`snapshot stage ${name} must report missing facts instead of ranking`,async()=>{
  const broken={...tx,competitionMonth:{findMany:async()=>[months[0]]},learningSnapshot:{findUnique:async()=>({payload:{state:'FINALIZED',items:[{chapterId:'chapter',eligible:true,score:4,stages}]}})}}
  const result=await readChapterTermResult(broken,'chapter',at('2026-06-01'),at('2026-07-01'),at('2026-10-01'),async()=>[])
  assert.equal(result.missing,true);assert.equal(result.eligible,false);assert.equal(result.score,0)
})
test('missing saved eligibility metadata is data missing, never an ordinary failed condition',async()=>{
  const broken={...tx,competitionMonth:{findMany:async()=>[months[0]]},learningSnapshot:{findUnique:async()=>({payload:{state:'FINALIZED',items:[{chapterId:'chapter',score:2,totalStars:42}]}})}}
  const result=await readChapterTermResult(broken,'chapter',at('2026-06-01'),at('2026-07-01'),at('2026-10-01'),async()=>[])
  assert.equal(result.missing,true)
})
for (const [name,item] of [['null chapter row',null],['null stage',{chapterId:'chapter',eligible:true,score:2,stages:[null]}]]) test(`malformed snapshot ${name} reports missing facts`,async()=>{
  const broken={...tx,competitionMonth:{findMany:async()=>[months[0]]},learningSnapshot:{findUnique:async()=>({payload:{state:'FINALIZED',items:[item]}})}}
  const result=await readChapterTermResult(broken,'chapter',at('2026-06-01'),at('2026-07-01'),at('2026-10-01'),async()=>[])
  assert.equal(result.missing,true)
})
