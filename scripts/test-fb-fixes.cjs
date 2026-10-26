// All writes are restricted to the dedicated FB cluster. Never loads .env.
const assert = require('node:assert/strict')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { Client } = require('pg')
const url = process.env.FB_TEST_DATABASE_URL
if (!url || new URL(url).hostname !== '127.0.0.1' || new URL(url).port !== '55438' || new URL(url).pathname !== '/fb_fixes_test') {
  throw new Error('Explicit FB_TEST_DATABASE_URL for 127.0.0.1:55438/fb_fixes_test required; no .env fallback.')
}
process.env.DATABASE_URL = url
process.env.DIRECT_URL = url
process.env.JWT_ACCESS_SECRET = 'fb-fixture-only-signing-secret-32-bytes'
process.env.TOKEN_HASH_PEPPER = 'fb-fixture-only-pepper'
require('ts-node').register({ project: 'tsconfig.test.json', transpileOnly: true })
const Module = require('node:module'), resolve = Module._resolveFilename
Module._resolveFilename = function(request, ...args) { return resolve.call(this, request.startsWith('@/') ? path.resolve('src', request.slice(2)) : request, ...args) }
const { prisma } = require('../src/lib/prisma')
const { NextRequest } = require('next/server')
const selected = process.argv[2]
let passed = 0, failed = 0
async function check(name, fn) {
  try { await fn(); passed++; console.log(`PASS ${name}`) }
  catch (error) { failed++; console.log(`FAIL ${name}: ${error.stack}`) }
}
async function user(role = 'MEMBER', status = 'ACTIVE') {
  return prisma.user.create({ data: { email: `fb-${randomUUID()}@test.invalid`, password_hash: 'fixture-only', role, status } })
}
async function chapter() {
  const unit = await prisma.organizationUnit.create({ data: { name: `FB-${randomUUID()}`, type: 'CHAPTER' } })
  const ch = await prisma.chapter.create({ data: { name: unit.name, organization_unit_id: unit.id } })
  const department = await prisma.organizationUnit.create({ data: { name: 'Ban FB', type: 'DEPARTMENT', parent_id: unit.id } })
  return { ...ch, unit, department }
}
async function req(actor, pathname, method = 'GET', body) {
  const { SignJWT } = await import('jose')
  const token = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject(actor.id).setExpirationTime('1h').sign(new TextEncoder().encode(process.env.JWT_ACCESS_SECRET))
  return new NextRequest(`http://localhost${pathname}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
}
async function staleLegacyIndex(member, ch) {
  // Test-only import corruption; production triggers stay installed and unchanged.
  const db = new Client({ connectionString: url }); await db.connect()
  try {
    await db.query('BEGIN'); await db.query('SET LOCAL session_replication_role=replica')
    await db.query('INSERT INTO chapter_members(id,chapter_id,user_id,joined_at) VALUES($1,$2,$3,now())', [randomUUID(), ch.id, member.id])
    await db.query('COMMIT')
  } catch (e) { await db.query('ROLLBACK'); throw e } finally { await db.end() }
}
async function invitations() {
  const { getInvitations } = require('../src/lib/invitations')
  const route = require('../src/app/api/v1/invitations/route')
  const admin = await user('ADMIN'), member = await user(), ch = await chapter()
  await prisma.organizationMembership.create({ data: { user_id: member.id, unit_id: ch.unit.id } })
  const ids = []
  for (const role of ['CHAPTER_LEADER', 'DNA_LEAD', 'MEMBER']) {
    const row = await prisma.invitation.create({ data: { email: `invite-${randomUUID()}@test.invalid`, role, chapter_id: ch.id, invited_by: admin.id, token_hash: randomUUID(), expires_at: new Date(Date.now() + 86400000) } })
    ids.push(row.id)
  }
  await check('FB04 LEAD filter applies before count and pagination', async () => {
    const first = await getInvitations({ actorId: admin.id, actorRole: 'ADMIN', chapterId: ch.id, kind: 'LEAD', page: 1, limit: 1 })
    const second = await getInvitations({ actorId: admin.id, actorRole: 'ADMIN', chapterId: ch.id, kind: 'LEAD', page: 2, limit: 1 })
    assert.equal(first.totalItems, 2); assert.equal(first.totalPages, 2)
    assert.ok([...first.items, ...second.items].every(row => row.role !== 'MEMBER'))
    assert.notEqual(first.items[0].id, second.items[0].id)
  })
  await check('FB04 API cache separates unfiltered and LEAD lists', async () => {
    const a = await (await route.GET(await req(admin, `/api/v1/invitations?chapterId=${ch.id}`))).json()
    const b = await (await route.GET(await req(admin, `/api/v1/invitations?chapterId=${ch.id}&kind=LEAD`))).json()
    assert.equal(a.totalItems, 3); assert.equal(b.totalItems, 2)
  })
  await check('FB04 non-Admin cannot use LEAD context; invalid kind rejected', async () => {
    assert.equal((await route.GET(await req(member, `/api/v1/invitations?organizationUnitId=${ch.unit.id}&kind=LEAD`))).status, 403)
    assert.equal((await route.GET(await req(admin, '/api/v1/invitations?kind=UNKNOWN'))).status, 400)
  })
  await check('FB04 accepting MEMBER does not promote role; cancel invalidates list cache', async () => {
    const { acceptInvitation } = require('../src/lib/invitations'), { hashToken } = require('../src/lib/tokens')
    const token = randomUUID()
    const inv = await prisma.invitation.create({ data: { email: `accept-${randomUUID()}@test.invalid`, role: 'MEMBER', chapter_id: ch.id, organization_unit_id: ch.unit.id, invited_by: admin.id, token_hash: hashToken(token), expires_at: new Date(Date.now() + 86400000) } })
    const accepted = await acceptInvitation(token, 'FixtureOnly!Password123')
    assert.equal(accepted.ok, true); assert.equal(accepted.role, 'MEMBER')
    assert.equal(await prisma.positionAssignment.count({ where: { user_id: accepted.userId } }), 0)
    const cancelRoute = require('../src/app/api/v1/invitations/[id]/route')
    await route.GET(await req(admin, `/api/v1/invitations?chapterId=${ch.id}&kind=LEAD`))
    const response = await cancelRoute.DELETE(await req(admin, `/api/v1/invitations/${ids[0]}`, 'DELETE'), { params: { id: ids[0] } })
    assert.equal(response.status, 200)
    const list = await (await route.GET(await req(admin, `/api/v1/invitations?chapterId=${ch.id}&kind=LEAD`))).json()
    assert.equal(list.items.find(row => row.id === ids[0]).status, 'CANCELLED')
    assert.equal((await prisma.invitation.findUnique({ where: { id: inv.id } })).status, 'ACCEPTED')
  })
}
async function roster() {
  // The old resolver is the regression baseline until the learner-specific resolver exists.
  const lib = require('../src/lib/chapter-members')
  const list = lib.listChapterLearners || lib.listChapterMembers
  for (const count of [2, 13]) await check(`FB02/06 ${count} learners exclude managers and inactive; deduplicate`, async () => {
    const ch = await chapter(), expected = []
    for (let i = 0; i < count; i++) {
      const u = await user(); expected.push(u.id)
      await prisma.chapterMember.create({ data: { user_id: u.id, chapter_id: ch.id } })
      await prisma.organizationMembership.create({ data: { user_id: u.id, unit_id: ch.department.id } })
    }
    for (const [role, status] of [['CHAPTER_LEADER', 'ACTIVE'], ['MEMBER', 'INACTIVE']]) {
      const u = await user(role, status)
      await prisma.chapterMember.create({ data: { user_id: u.id, chapter_id: ch.id } })
    }
    const manager = await user()
    await prisma.chapterMember.create({ data: { user_id: manager.id, chapter_id: ch.id } })
    const position = await prisma.position.upsert({ where: { code: 'CHAPTER_MANAGER' }, update: {}, create: { code: 'CHAPTER_MANAGER', name: 'Lead', scope: 'CHAPTER', is_manager: true } })
    await prisma.positionAssignment.create({ data: { user_id: manager.id, unit_id: ch.unit.id, position_id: position.id } })
    const rows = await list(ch.id)
    assert.deepEqual(rows.map(r => r.userId).sort(), expected.sort())
  })
  await check('FB02/06 ended/future memberships cannot be resurrected by a legacy index', async () => {
    const ch = await chapter()
    for (const future of [false, true]) {
      const u = await user()
      await prisma.chapterMember.create({ data: { user_id: u.id, chapter_id: ch.id } })
      await prisma.organizationMembership.create({ data: { user_id: u.id, unit_id: ch.unit.id, starts_at: new Date(Date.now() + (future ? 86400000 : -86400000)), ...(future ? {} : { status: 'ENDED', ends_at: new Date(Date.now() - 1000) }) } })
    }
    assert.equal((await list(ch.id)).length, 0)
  })
  await check('FB02/06 dashboard search keeps full denominator and ignores includeInactive', async () => {
    const ch = await chapter(), admin = await user('ADMIN'), a = await user(), b = await user(), inactive = await user('MEMBER', 'INACTIVE')
    for (const u of [a, b, inactive]) await prisma.chapterMember.create({ data: { user_id: u.id, chapter_id: ch.id } })
    const { GET } = require('../src/app/api/v1/chapters/[chapterId]/dashboard/members/route')
    const response = await GET(await req(admin, `/api/v1/chapters/${ch.id}/dashboard/members?search=${encodeURIComponent(a.email)}&includeInactive=1`), { params: { chapterId: ch.id } })
    assert.equal(response.status, 200); const data = await response.json()
    assert.equal(data.items.length, 1); assert.equal(data.summary.totalMembers, 2)
    assert.equal(data.rosterAsOf !== undefined, true)
  })
  await check('FB02/06 current DNA and foreign memberships override stale Chapter index', async () => {
    const ch = await chapter(), foreign = await chapter(), a = await user(), b = await user()
    const dna = await prisma.organizationUnit.create({ data: { name: `DNA-${randomUUID()}`, type: 'DNA' } })
    await prisma.organizationMembership.create({ data: { user_id: a.id, unit_id: dna.id } })
    await prisma.organizationMembership.create({ data: { user_id: b.id, unit_id: foreign.department.id } })
    await staleLegacyIndex(a, ch); await staleLegacyIndex(b, ch)
    assert.equal((await list(ch.id)).length, 0)
    const { GET } = require('../src/app/api/v1/learning/periods/route'), { periodLeaderboard } = require('../src/lib/period-leaderboard')
    const catalog = await (await GET(await req(a, '/api/v1/learning/periods'))).json()
    assert.deepEqual(catalog.scope.allowedGroups, ['DNA']); assert.deepEqual(catalog.scope.dnaUnitIds, [dna.id])
    assert.equal((await periodLeaderboard(await req(a, '/api/v1/leaderboard?group=DNA'))).status, 200)
    assert.equal((await periodLeaderboard(await req(a, '/api/v1/leaderboard?group=MEMBER'))).status, 403)
  })
  await check('FB02/06 LT belongs to the effective Chapter/Ban and retains president', async () => {
    const ch = await chapter(), foreign = await chapter(), expected = [], notLt = []
    const president = await prisma.position.upsert({ where: { code: 'CHAPTER_PRESIDENT' }, update: {}, create: { code: 'CHAPTER_PRESIDENT', name: 'Chủ tịch', scope: 'CHAPTER', is_manager: true } })
    const lt = await prisma.position.upsert({ where: { code: 'DEPARTMENT_LEAD' }, update: {}, create: { code: 'DEPARTMENT_LEAD', name: 'LT', scope: 'DEPARTMENT', is_manager: true } })
    for (const [pos, unitId, future] of [[president, ch.unit.id, false], [lt, ch.department.id, false], [lt, foreign.department.id, false], [lt, ch.department.id, true]]) {
      const u = await user()
      await prisma.organizationMembership.create({ data: { user_id: u.id, unit_id: ch.department.id } })
      await prisma.positionAssignment.create({ data: { user_id: u.id, unit_id: unitId, position_id: pos.id, starts_at: new Date(Date.now() + (future ? 86400000 : -1000)) } })
      ;(!future && [ch.unit.id, ch.department.id].includes(unitId) ? expected : notLt).push(u.id)
    }
    const rows = await list(ch.id)
    assert.deepEqual(rows.filter(row => row.isLead).map(row => row.userId).sort(), expected.sort())
    assert.ok(notLt.every(id => rows.find(row => row.userId === id)?.isLead === false))
  })
}
async function quiz() {
  await check('FB01 save 5 then 7 minutes returns persisted duration across refresh', async () => {
    const admin = await user('ADMIN')
    const course = await prisma.course.create({ data: { title: `FB quiz ${randomUUID()}`, created_by: admin.id } })
    const session = await prisma.session.create({ data: { course_id: course.id, title: 'Fixture', sort_order: 1 } })
    const lesson = await prisma.lesson.create({ data: { session_id: session.id, title: 'Fixture', sort_order: 1 } })
    const { GET, POST } = require('../src/app/api/v1/lessons/[lessonId]/assessment/route')
    for (const durationMinutes of [5, 7]) {
      const body = { title: 'Quiz fixture', questionCount: 1, durationMinutes, questions: [{ questionText: 'Q?', type: 'SINGLE_CHOICE', points: 1, options: [{ optionText: 'Yes', isCorrect: true }, { optionText: 'No', isCorrect: false }] }] }
      const response = await POST(await req(admin, `/api/v1/lessons/${lesson.id}/assessment`, 'POST', body), { params: { lessonId: lesson.id } })
      const saved = await response.json(); assert.equal(response.status, 201, JSON.stringify(saved)); assert.equal(saved.durationMinutes, durationMinutes)
      const refreshed = await (await GET(await req(admin, `/api/v1/lessons/${lesson.id}/assessment`), { params: { lessonId: lesson.id } })).json()
      assert.equal(refreshed.durationMinutes, durationMinutes)
      assert.equal((await prisma.assessment.findUnique({ where: { lesson_id: lesson.id } })).duration_minutes, durationMinutes)
    }
  })
}
async function leaderboardRules() {
  const { chapterCompetitionScore } = require('../src/lib/competition-ranking-rules')
  const stage = (n, q) => ({ startsAt: new Date(0), endsAt: new Date(86400000), memberCount: n, qualifiedCount: q, stars: 42 })
  await check('FB03 missing CORE keeps independently measured roster and all 3 conditions', async () => {
    const r = chapterCompetitionScore([stage(21, 0)], 'GREEN', { coreLessonCount: 0 })
    assert.equal(r.averageMemberCount, 21); assert.equal(r.score, null)
    assert.equal(r.conditions.length, 3)
    assert.deepEqual(r.conditions.map(c => c.state), ['PASS', 'MISSING_DATA', 'PASS'])
    assert.equal(r.conditions[1].value, null)
  })
  await check('FB03 boundary matrix and missing KPI', async () => {
    for (const [n, q, kpi, eligible] of [[0,0,'GREEN',false], [1,1,'GREEN',false], [20,20,'GREEN',false], [21,11,'GREEN',true], [100,49,'YELLOW',false], [100,50,'YELLOW',true], [21,21,'RED',false], [21,21,'BLACK',false], [21,21,null,false]]) {
      const r = chapterCompetitionScore([stage(n, q)], kpi, { coreLessonCount: 100 })
      assert.equal(r.eligible, eligible, `${n}/${q}/${kpi}`); assert.equal(r.conditions.length, 3)
    }
    assert.equal(chapterCompetitionScore([], null, { coreLessonCount: 0 }).conditions.length, 3)
  })
}
async function leaderboardData() {
  await check('FB03 only published lessons in three CORE programs enter denominator; EXTENDED excluded', async () => {
    const { historicalChapterMonthRows } = require('../src/lib/competition-snapshots')
    const f = await videoFixture(), now = new Date(), startsAt = new Date(Date.now() - 86400000)
    const core = await prisma.learningProgram.upsert({ where: { code: 'CORE_MEMBER' }, update: {}, create: { code: 'CORE_MEMBER', name: 'CORE Member', is_core: true, sort_order: 0 } })
    const extended = await prisma.learningProgram.upsert({ where: { code: 'EXTENDED' }, update: {}, create: { code: 'EXTENDED', name: 'EXTENDED', is_core: false, sort_order: 3 } })
    await prisma.course.update({ where: { id: f.course.id }, data: { program_id: core.id } })
    const cycle = await prisma.learningCycle.create({ data: { user_id: f.member.id, chapter_id: f.ch.id, starts_at: startsAt, trigger_key: randomUUID(), provenance: 'NATIVE' } })
    await prisma.cycleLessonProgress.create({ data: { user_id: f.member.id, lesson_id: f.lesson.id, learning_cycle_id: cycle.id, furthest_seconds: 862, completed_at: now } })
    const month = { id: randomUUID(), key: '2026-10', starts_at: startsAt, ends_at: new Date(Date.now() + 86400000) }
    const initial = (await historicalChapterMonthRows(prisma, month, new Date())).find(row => row.chapterId === f.ch.id)
    assert.equal(initial.at70Rate, 1)
    // A published optional lesson and an unpublished CORE lesson must not dilute 100%.
    for (const [program, status] of [[extended, 'PUBLISHED'], [core, 'DRAFT']]) {
      const c = await prisma.course.create({ data: { title: randomUUID(), program_id: program.id, status, created_by: f.admin.id } })
      const s = await prisma.session.create({ data: { course_id: c.id, title: 'Fixture', sort_order: 1 } })
      await prisma.lesson.create({ data: { session_id: s.id, title: 'Excluded', sort_order: 1 } })
    }
    const result = (await historicalChapterMonthRows(prisma, month, new Date())).find(row => row.chapterId === f.ch.id)
    assert.equal(result.at70Rate, 1); assert.equal(result.averageMemberCount, 1)
    await prisma.course.update({ where: { id: f.course.id }, data: { program_id: null } })
  })
}
async function readiness() {
  const admin = await user('ADMIN')
  const catalog = require('../src/app/api/v1/learning/periods/route')
  const { periodLeaderboard } = require('../src/lib/period-leaderboard')
  const old = await prisma.learningPolicy.findUnique({ where: { id: 'default' } })
  try {
    for (const [data, reason] of [[null, 'POLICY_MISSING'], [{}, 'MAPPING_NOT_APPROVED'], [{ mapping_approved_at: new Date() }, 'CUTOVER_NOT_SET'], [{ mapping_approved_at: new Date(), cutover_at: new Date(Date.now() + 86400000) }, 'CUTOVER_FUTURE']]) {
      await prisma.learningPolicy.deleteMany()
      if (data) await prisma.learningPolicy.create({ data: { id: 'default', ...data } })
      await check(`FB08 catalog and board agree on ${reason}; GET creates no periods`, async () => {
        const before = await prisma.competitionMonth.count()
        const a = await (await catalog.GET(await req(admin, '/api/v1/learning/periods'))).json()
        const b = await (await periodLeaderboard(await req(admin, '/api/v1/leaderboard?group=CHAPTER&periodType=MONTH'))).json()
        assert.equal(a.readiness.reasonCode, reason); assert.equal(b.reasonCode, reason)
        assert.equal(await prisma.competitionMonth.count(), before)
      })
    }
    await prisma.learningPolicy.update({ where: { id: 'default' }, data: { cutover_at: new Date(Date.now() - 86400000) } })
    for (const [query, reason] of [['group=CHAPTER&periodType=MONTH&periodId=1990-01', 'MONTH_NOT_CONFIGURED'], [`group=MEMBER&periodType=TERM&periodId=${randomUUID()}&chapterId=${randomUUID()}`, 'TERM_NOT_CONFIGURED'], [`group=DNA&periodType=TERM&periodId=${randomUUID()}`, 'SEASON_NOT_CONFIGURED']]) {
      await check(`FB08 distinguishes ${reason}`, async () => {
        const body = await (await periodLeaderboard(await req(admin, `/api/v1/leaderboard?${query}`))).json()
        assert.equal(body.reasonCode, reason)
      })
    }
    await check('FB08 closed board requires exact snapshot and never rewrites saved scores', async () => {
      const month = await prisma.competitionMonth.upsert({ where: { key: '1991-01' }, update: {}, create: { key: '1991-01', starts_at: new Date('1990-12-31T17:00:00Z'), ends_at: new Date('1991-01-31T17:00:00Z'), state: 'FINALIZED' } })
      await prisma.learningSnapshot.deleteMany({ where: { key: `ranking:CHAPTER:${month.id}` } })
      const query = '/api/v1/leaderboard?group=CHAPTER&periodType=MONTH&periodId=1991-01'
      const missing = await (await periodLeaderboard(await req(admin, query))).json()
      assert.equal(missing.reasonCode, 'SNAPSHOT_MISSING')
      const payload = { state: 'FINALIZED', items: [{ chapterId: randomUUID(), chapterName: 'Frozen', eligible: true, score: 42.125, rank: 1 }] }
      await prisma.learningSnapshot.create({ data: { key: `ranking:CHAPTER:${month.id}`, kind: 'RANKING', payload, captured_at: new Date() } })
      const result = await (await periodLeaderboard(await req(admin, query))).json()
      assert.equal(result.items[0].score, 42.125)
      assert.deepEqual((await prisma.learningSnapshot.findUnique({ where: { key: `ranking:CHAPTER:${month.id}` } })).payload, payload)
    })
  } finally { await prisma.learningPolicy.deleteMany(); if (old) await prisma.learningPolicy.create({ data: old }) }
}
async function videoFixture() {
  const member = await user(), admin = await user('ADMIN'), ch = await chapter()
  await prisma.chapterMember.create({ data: { user_id: member.id, chapter_id: ch.id } })
  const course = await prisma.course.create({ data: { title: `FB video ${randomUUID()}`, created_by: admin.id, status: 'PUBLISHED', visibility: 'PUBLIC' } })
  const session = await prisma.session.create({ data: { course_id: course.id, title: 'Video fixture', sort_order: 1 } })
  const lesson = await prisma.lesson.create({ data: { session_id: session.id, title: '862s', sort_order: 1 } })
  const video = await prisma.video.create({ data: { lesson_id: lesson.id, youtube_video_id: 'fb-fixture-video', duration_seconds: 862 } })
  return { member, admin, ch, course, lesson, video }
}
async function videoRewards() {
  const old = await prisma.learningPolicy.findUnique({ where: { id: 'default' } })
  const { recordVideoHeartbeat } = require('../src/lib/video-heartbeat')
  const route = require('../src/app/api/v1/lessons/[lessonId]/progress/route')
  try {
    await prisma.learningPolicy.deleteMany()
    await check('FB07 lifetime completion with no policy/cycle is labelled separately', async () => {
      const f = await videoFixture()
      await prisma.lessonProgress.create({ data: { user_id: f.member.id, lesson_id: f.lesson.id, completed: true, completed_at: new Date(), furthest_watched_position_seconds: 862 } })
      const body = await (await route.GET(await req(f.member, `/api/v1/lessons/${f.lesson.id}/progress`), { params: { lessonId: f.lesson.id } })).json()
      assert.equal(body.progressContext.learningCycleId, null)
      assert.equal(body.lifetime.completed, true); assert.equal(body.cycleProgress, null)
      assert.equal(body.rewardStatus.reasonCode, 'POLICY_MISSING')
      assert.equal(await prisma.learningCycle.count({ where: { user_id: f.member.id } }), 0)
    })
    const now = new Date(), cutover = new Date(Date.now() - 86400000)
    await prisma.learningPolicy.create({ data: { id: 'default', cutover_at: cutover, mapping_approved_at: cutover } })
    const { chapterRewardBoundary, dnaSeasonEnd } = require('../src/lib/chapter-reward-gate')
    const boundary = chapterRewardBoundary(now)
    let season = await prisma.transferSeason.findUnique({ where: { reward_boundary_at: boundary } })
    if (!season) season = await prisma.transferSeason.create({ data: { code: `fb-${randomUUID()}`, starts_at: boundary, ends_at: dnaSeasonEnd(boundary), reward_boundary_at: boundary } })
    const f = await videoFixture()
    await prisma.chapterReorganization.create({ data: { chapter_id: f.ch.id, created_by_user_id: f.admin.id, effective_at: cutover, applied_at: cutover, status: 'APPLIED', transfer_season_id: season.id } })
    const beat = (position, event = 'HEARTBEAT') => recordVideoHeartbeat(f.member.id, f.lesson.id, position, position, false, 'fb-session', { event, playbackRate: 2, playerDurationSeconds: 862 })
    await check('FB07 actual writer grants 14 stars for 862s once, including concurrent retries and refresh', async () => {
      const start = await beat(0, 'PLAY'); assert.ok(!start.error)
      assert.equal(start.progressContext.monthlyReplayRequired, true)
      for (let position = 20; position <= 860; position += 20) {
        await prisma.monthlyVideoReplay.updateMany({ where: { user_id: f.member.id, video_id: f.video.id }, data: { last_heartbeat_at: new Date(Date.now() - 10050) } })
        const result = await beat(position); assert.ok(!result.error)
      }
      await prisma.monthlyVideoReplay.updateMany({ where: { user_id: f.member.id, video_id: f.video.id }, data: { last_heartbeat_at: new Date(Date.now() - 2000) } })
      const result = await beat(862, 'ENDED')
      assert.equal(result.starReward.amount, 14); assert.equal(result.rewardStatus.reasonCode, 'AWARDED')
      assert.equal(result.replay.learningCycleId, result.progressContext.learningCycleId)
      assert.equal(result.replay.competitionMonthId, result.progressContext.competitionMonthId)
      const retries = await Promise.all([beat(862, 'ENDED'), beat(862, 'ENDED'), beat(862)])
      assert.ok(retries.every(row => row.starReward.amount === 0))
      const entries = await prisma.starLedger.findMany({ where: { user_id: f.member.id, source_id: f.video.id } })
      assert.equal(entries.length, 1); assert.equal(entries[0].amount, 14)
      const refreshed = await (await route.GET(await req(f.member, `/api/v1/lessons/${f.lesson.id}/progress`), { params: { lessonId: f.lesson.id } })).json()
      assert.equal(refreshed.rewardStatus.reasonCode, 'ALREADY_AWARDED'); assert.equal(refreshed.videoStarsThisMonth.awardedStars, 14)
    })
    await check('FB07 forged seek/ENDED creates no reward and completed cycle is independent from new replay', async () => {
      const g = await videoFixture()
      const first = await recordVideoHeartbeat(g.member.id, g.lesson.id, 862, 862, false, 'forged', { event: 'ENDED', playbackRate: 2 })
      assert.equal(first.starReward.amount, 0); assert.equal(first.replay.completed, false)
      const cycle = await prisma.learningCycle.findFirst({ where: { user_id: g.member.id, ends_at: null } })
      await prisma.cycleLessonProgress.updateMany({ where: { user_id: g.member.id, lesson_id: g.lesson.id }, data: { furthest_seconds: 862, completed_at: now } })
      const oldMonth = await prisma.competitionMonth.upsert({ where: { key: '2020-01' }, update: {}, create: { key: '2020-01', starts_at: new Date('2019-12-31T17:00:00Z'), ends_at: new Date('2020-01-31T17:00:00Z'), state: 'FINALIZED' } })
      await prisma.monthlyVideoReplay.create({ data: { user_id: g.member.id, video_id: g.video.id, competition_month_id: oldMonth.id, learning_cycle_id: cycle.id, furthest_seconds: 862, completed_at: oldMonth.ends_at } })
      const data = await (await route.GET(await req(g.member, `/api/v1/lessons/${g.lesson.id}/progress`), { params: { lessonId: g.lesson.id } })).json()
      assert.equal(data.progressContext.learningCycleId, cycle.id); assert.equal(data.cycleProgress.completed, true)
      assert.equal(data.replay.completed, false); assert.equal(data.replay.watchedSeconds, 0)
    })
    await check('FB07 transfer pause suppresses completed replay and later transfer never backfills', async () => {
      const g = await videoFixture()
      await prisma.chapter.update({ where: { id: g.ch.id }, data: { created_at: new Date(season.starts_at.getTime() - 200 * 86400000) } })
      const send = () => recordVideoHeartbeat(g.member.id, g.lesson.id, 862, 862, false, 'suppression', { event: 'ENDED', playbackRate: 2 })
      await recordVideoHeartbeat(g.member.id, g.lesson.id, 0, 0, false, 'suppression', { event: 'PLAY', playbackRate: 2 })
      await prisma.monthlyVideoReplay.updateMany({ where: { user_id: g.member.id, video_id: g.video.id }, data: { furthest_seconds: 842, last_heartbeat_at: new Date(Date.now() - 10050) } })
      const suppressed = await send()
      assert.equal(suppressed.starReward.amount, 0); assert.equal(suppressed.replay.suppressed, true)
      assert.equal(suppressed.rewardStatus.reasonCode, 'CHAPTER_TRANSFER_OVERDUE')
      await prisma.chapterReorganization.create({ data: { chapter_id: g.ch.id, created_by_user_id: g.admin.id, effective_at: cutover, applied_at: cutover, status: 'APPLIED', transfer_season_id: season.id } })
      const retry = await send(); assert.equal(retry.starReward.amount, 0); assert.equal(retry.rewardStatus.reasonCode, 'SUPPRESSED')
      assert.equal(await prisma.starLedger.count({ where: { user_id: g.member.id } }), 0)
    })
  } finally { await prisma.learningPolicy.deleteMany(); if (old) await prisma.learningPolicy.create({ data: old }) }
}
async function history() {
  await check('FB05 typed membership history retains Chapter intervals and is read-only', async () => {
    const ch = await chapter(), admin = await user('ADMIN'), member = await user()
    await prisma.chapterMember.create({ data: { user_id: member.id, chapter_id: ch.id } })
    const membership = await prisma.organizationMembership.create({ data: { user_id: member.id, unit_id: ch.unit.id } })
    await prisma.organizationMembership.update({ where: { id: membership.id }, data: { status: 'ENDED', ends_at: new Date() } })
    const before = await prisma.chapterAffiliationInterval.count({ where: { user_id: member.id } })
    const { GET } = require('../src/app/api/v1/admin/organization/history/route')
    const body = await (await GET(await req(admin, `/api/v1/admin/organization/history?userId=${member.id}`))).json()
    assert.equal(body.chapters.length, before); assert.ok(before > 0)
    assert.equal(body.memberships[0].unit.type, 'CHAPTER')
    assert.equal(await prisma.chapterAffiliationInterval.count({ where: { user_id: member.id } }), before)
    assert.equal(await prisma.organizationMembership.count({ where: { user_id: member.id } }), 1)
  })
}
async function main() {
  const client = new Client({ connectionString: url }); await client.connect()
  try {
    const { rows: [target] } = await client.query("SELECT current_database() AS db, current_setting('data_directory') AS dir, host(inet_server_addr()) AS host, inet_server_port() AS port")
    assert.equal(target.db, 'fb_fixes_test'); assert.equal(target.host, '127.0.0.1'); assert.equal(target.port, 55438)
    assert.equal(path.resolve(target.dir).toLowerCase(), path.resolve('scratch/fb-fixes/pg-data').toLowerCase())
  } finally { await client.end() }
  if (!selected || selected === 'invitations') await invitations()
  if (!selected || selected === 'roster') await roster()
  if (!selected || selected === 'quiz') await quiz()
  if (!selected || selected === 'rules') await leaderboardRules()
  if (!selected || selected === 'leaderboard') await leaderboardData()
  if (!selected || selected === 'readiness') await readiness()
  if (!selected || selected === 'video') await videoRewards()
  if (!selected || selected === 'history') await history()
  console.log(`FB result: ${passed} PASS, ${failed} FAIL`)
  if (failed) process.exitCode = 1
}
main().catch(error => { console.error(error); process.exitCode = 1 }).finally(() => prisma.$disconnect())
