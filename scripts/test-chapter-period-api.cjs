const assert = require('node:assert/strict'), path = require('node:path')
const { test } = require('node:test')
require('ts-node').register({ project: 'tsconfig.test.json' })
const Module = require('node:module'), resolve = Module._resolveFilename
Module._resolveFilename = function (name, ...args) { return resolve.call(this, name.startsWith('@/') ? path.resolve('src', name.slice(2)) : name, ...args) }
const RealDate = Date, at = s => new RealDate(`${s}T00:00:00+07:00`)
const spring = { id:'11111111-1111-1111-1111-111111111111', starts_at:at('2026-03-01'),ends_at:at('2026-05-01'),reward_boundary_at:at('2026-04-01') }
const fall = { id:'22222222-2222-2222-2222-222222222222', starts_at:at('2026-09-01'),ends_at:at('2026-11-01'),reward_boundary_at:at('2026-10-01') }
let snapshot = null
global.prisma = {
  learningPolicy: {findUnique:async()=>({cutover_at:at('2026-01-01'),mapping_approved_at:at('2026-01-01')})},
  transferSeason: {findFirst:async({where})=>[fall,spring].find(s=>where.id?s.id===where.id:where.reward_boundary_at?s.reward_boundary_at<=where.reward_boundary_at.lte:s.starts_at<=where.starts_at.lte),findUnique:async({where})=>[spring,fall].find(s=>s.id===where.id)},
  learningSnapshot: {findUnique:async()=>snapshot},
  chapter: {findMany:async()=>[]},chapterCompetitionTerm:{findMany:async()=>[]},
}
const { periodLeaderboard }=require('../src/lib/period-leaderboard')
const { NextRequest }=require('next/server')
test('September official default keeps April-September result interval until October boundary',async()=>{
  global.Date=class extends RealDate{constructor(...args){super(...(args.length?args:['2026-09-15T00:00:00+07:00']))}static now(){return at('2026-09-15').getTime()}}
  try {
    const response=await periodLeaderboard(new NextRequest('http://localhost/api/v1/leaderboard?group=CHAPTER&periodType=TERM'))
    const body=await response.json()
    assert.equal(body.period.id,spring.id)
  }finally{global.Date=RealDate}
})
test('final term snapshot missing allocation fields reports data missing without rewriting it',async()=>{
  snapshot={payload:{state:'FINALIZED',items:[{chapterId:'c',eligible:true,score:5}]}}
  try{
    const response=await periodLeaderboard(new NextRequest(`http://localhost/api/v1/leaderboard?group=CHAPTER&periodType=TERM&periodId=${fall.id}`))
    const body=await response.json()
    assert.equal(body.state,'AWAITING_SNAPSHOT');assert.equal(body.reasonCode,'SNAPSHOT_DATA_MISSING')
    assert.equal(snapshot.payload.state,'FINALIZED')
  }finally{snapshot=null}
})
