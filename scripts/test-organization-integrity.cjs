const { Client } = require('pg')
const fs = require('node:fs/promises')
const path = require('node:path')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const url = process.env.ORGANIZATION_TEST_DATABASE_URL
if (!url || !['127.0.0.1', 'localhost'].includes(new URL(url).hostname) || !new URL(url).pathname.startsWith('/org_integrity')) {
  throw new Error('An explicit isolated localhost org_integrity* database is required; never uses DATABASE_URL as a fallback.')
}
process.env.DATABASE_URL = url
process.env.DIRECT_URL = url
process.env.JWT_ACCESS_SECRET = 'organization-test-secret-only-32-bytes-minimum'
require('ts-node').register({ project: 'tsconfig.test.json' })
const Module = require('node:module')
const resolve = Module._resolveFilename
Module._resolveFilename = function (request, ...args) { return resolve.call(this, request.startsWith('@/') ? path.resolve('src', request.slice(2)) : request, ...args) }
globalThis.prisma = new (require('@prisma/client').PrismaClient)({ log: [] })
const { prisma } = require('../src/lib/prisma')
const results = []
async function check(name, fn) {
  try { await fn(); results.push({ name, expected: 'Invariant holds', actual: 'As expected', status: 'PASS' }); console.log(`PASS ${name}`) }
  catch (error) { results.push({ name, expected: 'Invariant holds', actual: String(error.message).slice(0, 300), status: 'FAIL' }); console.log(`FAIL ${name}: ${error.message}`); process.exitCode = 1 }
}
async function fixture(role = 'MEMBER') {
  const key = randomUUID()
  const user = await prisma.user.create({ data: { email: `${key}@org-test.invalid`, password_hash: 'test-only', role } })
  const unit = await prisma.organizationUnit.create({ data: { name: `Phoenix-${key}`, type: 'CHAPTER' } })
  const chapter = await prisma.chapter.create({ data: { name: unit.name, organization_unit_id: unit.id } })
  const otherUnit = await prisma.organizationUnit.create({ data: { name: `Pegasus-${key}`, type: 'CHAPTER' } })
  const other = await prisma.chapter.create({ data: { name: otherUnit.name, organization_unit_id: otherUnit.id } })
  const department = await prisma.organizationUnit.create({ data: { name: `Marketing-${key}`, type: 'DEPARTMENT', parent_id: unit.id } })
  const dna = await prisma.organizationUnit.create({ data: { name: `DNA-${key}`, type: 'DNA' } })
  const position = await prisma.position.upsert({ where: { code: 'CHAPTER_MANAGER' }, update: {}, create: { code: 'CHAPTER_MANAGER', name: 'Lead Chapter', scope: 'CHAPTER', is_manager: true } })
  return { user, chapter, unit, other, otherUnit, department, dna, position }
}
const appoint = f => prisma.positionAssignment.create({ data: { user_id: f.user.id, unit_id: f.unit.id, position_id: f.position.id } })
async function rawTransaction(fn, isolation = 'READ COMMITTED') {
  const client = new Client({ connectionString: url })
  await client.connect()
  try { await client.query("SET TIME ZONE 'UTC'"); await client.query(`BEGIN ISOLATION LEVEL ${isolation}`); const value = await fn(client); await client.query('COMMIT'); return { ok: true, value } }
  catch (error) { await client.query('ROLLBACK'); return { ok: false, code: error.code, message: error.message } }
  finally { await client.end() }
}
(async () => {
  const db = new Client({ connectionString: url }); await db.connect()
  try {
    const installed = await db.query("SELECT 1 FROM pg_proc WHERE proname='assert_organization_integrity'")
    if (!installed.rowCount) {
      const legacy = await db.query("SELECT 1 FROM pg_proc WHERE proname='record_learning_chapter_affiliation'")
      if (!legacy.rowCount) await db.query(await fs.readFile('prisma/migrations/20261022_learning_guards/migration.sql', 'utf8'))
      await db.query(await fs.readFile('prisma/migrations/20261025_organization_integrity/migration.sql', 'utf8'))
    }
    const dnaGuard = await db.query("SELECT 1 FROM pg_proc WHERE proname='assert_organization_integrity' AND prosrc LIKE '%LeadChapterCannotJoinDna%'")
    if (!dnaGuard.rowCount) await db.query(await fs.readFile('prisma/migrations/20261025_lead_binding_guards/migration.sql', 'utf8'))
  } finally { await db.end() }
  await check('first Lead succeeds; second Chapter rejected at database', async () => {
    const f = await fixture(); await appoint(f)
    await assert.rejects(() => prisma.positionAssignment.create({ data: { user_id: f.user.id, unit_id: f.otherUnit.id, position_id: f.position.id } }), /ChapterLeadPermanentBinding/)
    assert.equal(await prisma.positionAssignment.count({ where: { user_id: f.user.id } }), 1)
  })
  await check('revocation preserves history and permanent Chapter binding', async () => {
    const f = await fixture(); const first = await appoint(f)
    await prisma.positionAssignment.update({ where: { id: first.id }, data: { ends_at: new Date() } })
    await assert.rejects(() => prisma.positionAssignment.create({ data: { user_id: f.user.id, unit_id: f.otherUnit.id, position_id: f.position.id } }), /ChapterLeadPermanentBinding/)
    await appoint(f)
    assert.equal(await prisma.positionAssignment.count({ where: { user_id: f.user.id } }), 2)
    assert.equal((await prisma.chapterLeadBinding.findUnique({ where: { user_id: f.user.id } })).chapter_id, f.chapter.id)
  })
  await check('a permanently bound Lead cannot join DNA, even after revocation or through a future raw import', async () => {
    const { prepareOrganizationTransition } = require('../src/lib/organization-transition')
    const f = await fixture(), assignment = await appoint(f)
    await prisma.positionAssignment.update({ where: { id: assignment.id }, data: { ends_at: new Date() } })
    await assert.rejects(() => prisma.$transaction(tx => prepareOrganizationTransition(tx, f.user.id, f.dna.id)), /DNA/)
    await assert.rejects(() => prisma.organizationMembership.create({ data: { user_id: f.user.id, unit_id: f.dna.id } }), /LeadChapterCannotJoinDna/)
    await assert.rejects(() => prisma.organizationMembership.create({ data: { user_id: f.user.id, unit_id: f.dna.id, starts_at: new Date(Date.now() + 86400000) } }), /LeadChapterCannotJoinDna/)
    assert.equal(await prisma.organizationMembership.count({ where: { user_id: f.user.id } }), 0)
  })
  await check('a binding cannot be changed/deleted and imports cannot fabricate a past tenure elsewhere', async () => {
    const f = await fixture(); await appoint(f)
    await assert.rejects(() => prisma.chapterLeadBinding.update({ where: { user_id: f.user.id }, data: { chapter_id: f.other.id } }), /ChapterLeadPermanentBinding/)
    await assert.rejects(() => prisma.chapterLeadBinding.delete({ where: { user_id: f.user.id } }), /ChapterLeadPermanentBinding/)
    await assert.rejects(() => prisma.positionAssignment.create({ data: { user_id: f.user.id, unit_id: f.otherUnit.id, position_id: f.position.id, starts_at: new Date('2025-01-01T00:00:00Z'), ends_at: new Date('2025-02-01T00:00:00Z') } }), /ChapterLeadPermanentBinding/)
  })
  await check('retyping a unit through import cannot bypass the permanent Lead/DNA guard', async () => {
    const f = await fixture(); await appoint(f)
    await assert.rejects(() => prisma.organizationUnit.update({ where: { id: f.unit.id }, data: { type: 'DNA' } }), /LeadChapterCannotJoinDna/)
    assert.equal((await prisma.organizationUnit.findUnique({ where: { id: f.unit.id } })).type, 'CHAPTER')
  })
  for (const isolation of ['READ COMMITTED', 'REPEATABLE READ', 'SERIALIZABLE']) {
    await check(`concurrent raw imports to two Lead Chapters at ${isolation}`, async () => {
      const f = await fixture()
      let arrived = 0, release
      const barrier = new Promise(resolve => { release = resolve })
      const attempt = unitId => rawTransaction(async client => {
        await client.query('SELECT count(*) FROM position_assignments WHERE user_id=$1', [f.user.id])
        if (++arrived === 2) release()
        await barrier
        await client.query('INSERT INTO position_assignments(id,user_id,unit_id,position_id) VALUES($1,$2,$3,$4)', [randomUUID(), f.user.id, unitId, f.position.id])
      }, isolation)
      const responses = await Promise.all([attempt(f.unit.id), attempt(f.otherUnit.id)])
      assert.equal(responses.filter(row => row.ok).length, 1, JSON.stringify(responses))
      assert.equal(await prisma.positionAssignment.count({ where: { user_id: f.user.id } }), 1)
    })
  }
  await check('actual Admin API refuses second Chapter with the bound Chapter name', async () => {
    const { NextRequest } = require('next/server')
    const { SignJWT } = await import('jose')
    const { POST } = require('../src/app/api/v1/admin/organization/route')
    const admin = await fixture('ADMIN'), f = await fixture()
    await prisma.chapterMember.create({ data: { user_id: f.user.id, chapter_id: f.chapter.id } })
    const token = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject(admin.user.id).setExpirationTime('1h').sign(new TextEncoder().encode(process.env.JWT_ACCESS_SECRET))
    const request = unitId => new NextRequest('http://localhost/api/v1/admin/organization', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'APPOINT_POSITION', userId: f.user.id, unitId, positionId: f.position.id }) })
    assert.equal((await POST(request(f.unit.id))).status, 201)
    const response = await POST(request(f.otherUnit.id))
    assert.equal(response.status, 409)
    const body = await response.json()
    assert.equal(body.error.code, 'ChapterLeadPermanentBinding')
    assert.equal(body.error.chapterName, f.chapter.name)
  })
  await check('revocation is immediate for the same JWT and authorization rejects foreign Chapter', async () => {
    const { chapterLeadScope } = require('../src/lib/chapter-lead')
    const { canAccessChapterPermission, listAccessibleChapterIds } = require('../src/lib/authorization')
    const { authenticate } = require('../src/lib/auth')
    const { NextRequest } = require('next/server')
    const { SignJWT } = await import('jose')
    const f = await fixture('CHAPTER_LEADER')
    await prisma.chapterMember.create({ data: { user_id: f.user.id, chapter_id: f.chapter.id } })
    const assignment = await appoint(f)
    for (const code of ['VIEW_MEMBER_PROGRESS', 'MANAGE_CHAPTER_MEMBERS']) {
      const permission = await prisma.permission.upsert({ where: { code }, update: {}, create: { code } })
      await prisma.positionPermission.upsert({ where: { position_id_permission_id: { position_id: f.position.id, permission_id: permission.id } }, update: {}, create: { position_id: f.position.id, permission_id: permission.id } })
    }
    const token = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject(f.user.id).setExpirationTime('1h').sign(new TextEncoder().encode(process.env.JWT_ACCESS_SECRET))
    const request = () => new NextRequest('http://localhost/api/v1/auth/me', { headers: { Authorization: `Bearer ${token}` } })
    const first = await authenticate(request())
    assert.equal(first.context.chapterId, f.chapter.id)
    assert.equal(await canAccessChapterPermission(first.context, f.chapter.id, 'VIEW_MEMBER_PROGRESS'), true)
    assert.equal(await canAccessChapterPermission(first.context, f.other.id, 'VIEW_MEMBER_PROGRESS'), false)
    await prisma.positionAssignment.update({ where: { id: assignment.id }, data: { ends_at: new Date() } })
    const after = await authenticate(request())
    assert.equal(after.context.chapterId, undefined)
    assert.equal((await chapterLeadScope(f.user.id)).chapterId, null)
    assert.equal(await canAccessChapterPermission(first.context, f.chapter.id, 'VIEW_MEMBER_PROGRESS'), false)
    assert.deepEqual(await listAccessibleChapterIds(first.context, 'VIEW_MEMBER_PROGRESS'), [])
  })
  await check('Chapter to DNA transaction preserves progress/stars/history, cancels Ban and scheduled positions', async () => {
    const { prepareOrganizationTransition } = require('../src/lib/organization-transition')
    const { listChapterMembers } = require('../src/lib/chapter-members')
    const { updateChapterDepartment } = require('../src/lib/chapter-department-update')
    const f = await fixture()
    await prisma.chapterMember.create({ data: { user_id: f.user.id, chapter_id: f.chapter.id } })
    await prisma.organizationMembership.create({ data: { user_id: f.user.id, unit_id: f.department.id } })
    const position = await prisma.position.upsert({ where: { code: 'DEPARTMENT_LEAD' }, update: {}, create: { code: 'DEPARTMENT_LEAD', name: 'LT', scope: 'DEPARTMENT', is_manager: true } })
    await prisma.positionAssignment.create({ data: { user_id: f.user.id, position_id: position.id, unit_id: f.department.id } })
    await prisma.positionAssignment.create({ data: { user_id: f.user.id, position_id: position.id, unit_id: f.department.id, starts_at: new Date(Date.now() + 86400000) } })
    const course = await prisma.course.create({ data: { title: 'Preserved course', created_by: f.user.id } })
    const session = await prisma.session.create({ data: { course_id: course.id, title: 'Session', sort_order: 1 } })
    const lesson = await prisma.lesson.create({ data: { session_id: session.id, title: 'Lesson', sort_order: 1 } })
    const progress = await prisma.lessonProgress.create({ data: { user_id: f.user.id, lesson_id: lesson.id, completed: true, completed_at: new Date(), furthest_watched_position_seconds: 100, last_position_seconds: 100 } })
    await prisma.starLedger.create({ data: { user_id: f.user.id, amount: 7, reason: 'VIDEO_COMPLETION', reward_key: randomUUID(), source_type: 'LESSON', source_id: lesson.id, chapter_at_award_id: f.chapter.id } })
    let at
    await prisma.$transaction(async tx => {
      at = await prepareOrganizationTransition(tx, f.user.id, f.dna.id)
      await tx.organizationMembership.create({ data: { user_id: f.user.id, unit_id: f.dna.id, starts_at: at } })
    })
    assert.equal(await prisma.chapterMember.count({ where: { user_id: f.user.id } }), 0)
    assert.equal(await prisma.organizationMembership.count({ where: { user_id: f.user.id, status: 'ACTIVE' } }), 1)
    assert.equal(await prisma.positionAssignment.count({ where: { user_id: f.user.id, ends_at: null } }), 0)
    assert.equal((await prisma.chapterAffiliationInterval.findFirst({ where: { user_id: f.user.id } })).ends_at.toISOString(), at.toISOString())
    assert.deepEqual(await prisma.lessonProgress.findUnique({ where: { id: progress.id } }), progress)
    assert.equal((await prisma.starLedger.aggregate({ where: { user_id: f.user.id }, _sum: { amount: true } }))._sum.amount, 7)
    assert.equal((await listChapterMembers(f.chapter.id)).some(row => row.userId === f.user.id), false)
    await assert.rejects(() => updateChapterDepartment({ userId: f.user.id, chapterId: f.chapter.id, departmentUnitId: f.department.id, makeLead: false, actorId: f.user.id }), /DNA/)
    await prisma.$transaction(async tx => { await prepareOrganizationTransition(tx, f.user.id, f.dna.id) })
    assert.equal(await prisma.organizationMembership.count({ where: { user_id: f.user.id, status: 'ACTIVE' } }), 1)
  })
  await check('same-Chapter overlapping aliases cannot create two active tenures', async () => {
    const f = await fixture(); await appoint(f)
    await assert.rejects(() => appoint(f), /ChapterLeadConflict/)
  })
  await check('Admin transfer retry is idempotent; old Lead cannot read or add the DNA learner', async () => {
    const { POST: adminPost } = require('../src/app/api/v1/admin/organization/route')
    const { POST: managerPost } = require('../src/app/api/v1/organization/units/[unitId]/members/route')
    const { GET: progressGet } = require('../src/app/api/v1/organization/units/[unitId]/members/[userId]/progress/route')
    const { NextRequest } = require('next/server')
    const { SignJWT } = await import('jose')
    const admin = await fixture('ADMIN'), lead = await fixture('CHAPTER_LEADER')
    await prisma.chapterMember.create({ data: { user_id: lead.user.id, chapter_id: lead.chapter.id } })
    await appoint(lead)
    const learner = await prisma.user.create({ data: { email: `${randomUUID()}@org-test.invalid`, password_hash: 'test-only', role: 'MEMBER' } })
    await prisma.chapterMember.create({ data: { user_id: learner.id, chapter_id: lead.chapter.id } })
    await prisma.organizationMembership.create({ data: { user_id: learner.id, unit_id: lead.department.id } })
    const token = userId => new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject(userId).setExpirationTime('1h').sign(new TextEncoder().encode(process.env.JWT_ACCESS_SECRET))
    const adminToken = await token(admin.user.id), leadToken = await token(lead.user.id)
    const request = (bearer, body) => new NextRequest('http://localhost/api', { method: 'POST', headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    for (let i = 0; i < 2; i++) assert.equal((await adminPost(request(adminToken, { action: 'ADD_MEMBERSHIP', userId: learner.id, unitId: lead.dna.id }))).status, 201)
    assert.equal(await prisma.organizationMembership.count({ where: { user_id: learner.id, unit_id: lead.dna.id, status: 'ACTIVE' } }), 1)
    assert.equal(await prisma.chapterMember.count({ where: { user_id: learner.id } }), 0)
    const add = await managerPost(request(leadToken, { action: 'ADD_MEMBER', email: learner.email }), { params: { unitId: lead.department.id } })
    assert.equal(add.status, 409)
    assert.equal((await add.json()).error.code, 'DnaMembershipConflict')
    const progress = await progressGet(new NextRequest('http://localhost/api', { headers: { Authorization: `Bearer ${leadToken}` } }), { params: { unitId: lead.unit.id, userId: learner.id } })
    assert.equal(progress.status, 404)
  })
  await check('DNA month/term include all same-period stars; previous Chapter month history stays intact', async () => {
    const { individualPeriodRows, historicalChapterMonthRows } = require('../src/lib/competition-snapshots')
    const f = await fixture()
    const monthStart = new Date('2026-05-01T00:00:00Z'), joined = new Date('2026-05-15T00:00:00Z'), end = new Date('2026-06-01T00:00:00Z')
    await prisma.accountStateInterval.updateMany({ where: { user_id: f.user.id }, data: { starts_at: new Date('2026-03-01T00:00:00Z') } })
    await prisma.organizationMembership.create({ data: { user_id: f.user.id, unit_id: f.dna.id, starts_at: joined, created_at: joined } })
    await prisma.chapterAffiliationInterval.create({ data: { user_id: f.user.id, chapter_id: f.chapter.id, starts_at: new Date('2026-03-01T00:00:00Z'), ends_at: joined } })
    const month = await prisma.competitionMonth.upsert({ where: { key: '2026-05' }, update: {}, create: { key: '2026-05', starts_at: monthStart, ends_at: end } })
    for (const [at, amount] of [['2026-04-20T00:00:00Z', 3], ['2026-05-10T00:00:00Z', 5], ['2026-05-20T00:00:00Z', 7], ['2026-03-20T00:00:00Z', 99]]) {
      await prisma.starLedger.create({ data: { user_id: f.user.id, amount, reason: 'VIDEO_COMPLETION', reward_key: randomUUID(), source_type: 'TEST', source_id: randomUUID(), awarded_at: new Date(at), provenance: 'NATIVE', competition_month_id: at.startsWith('2026-05') ? month.id : null, chapter_at_award_id: f.chapter.id } })
    }
    const dnaMonth = (await individualPeriodRows(prisma, monthStart, end, 'DNA')).find(row => row.userId === f.user.id)
    const dnaTerm = (await individualPeriodRows(prisma, new Date('2026-04-01T00:00:00Z'), end, 'DNA')).find(row => row.userId === f.user.id)
    assert.equal(dnaMonth.stars, 12)
    assert.equal(dnaTerm.stars, 15)
    const chapterMay = (await historicalChapterMonthRows(prisma, month, end)).find(row => row.chapterId === f.chapter.id)
    assert.equal(chapterMay.stages.reduce((sum, stage) => sum + stage.stars, 0), 0)
    const april = await prisma.competitionMonth.upsert({ where: { key: '2026-04' }, update: {}, create: { key: '2026-04', starts_at: new Date('2026-04-01T00:00:00Z'), ends_at: monthStart } })
    await prisma.learningSnapshot.create({ data: { key: `test-finalized:${randomUUID()}`, kind: 'RANKING', captured_at: monthStart, payload: { monthId: april.id, chapterId: f.chapter.id, stars: 3 } } })
    assert.equal((await prisma.starLedger.aggregate({ where: { user_id: f.user.id }, _sum: { amount: true } }))._sum.amount, 114)
    const priorCohort = await require('../src/lib/competition-snapshots').competitionCohortAt(prisma, monthStart)
    assert.equal(priorCohort.find(row => row.userId === f.user.id).chapterId, f.chapter.id)
  })
  await check('email casing/whitespace cannot create a second identity or escape binding', async () => {
    const f = await fixture(); await appoint(f)
    await prisma.user.update({ where: { id: f.user.id }, data: { email: `  ${f.user.email.toUpperCase()}  ` } })
    assert.equal((await prisma.user.findUnique({ where: { id: f.user.id } })).email, f.user.email)
    await assert.rejects(() => prisma.user.create({ data: { email: f.user.email.toUpperCase(), password_hash: 'test-only', role: 'MEMBER' } }), /Unique constraint/)
  })
  await check('organization history is Admin-only and explicitly labels ended Chapter affiliation', async () => {
    const { GET } = require('../src/app/api/v1/admin/organization/history/route')
    const { prepareOrganizationTransition } = require('../src/lib/organization-transition')
    const { NextRequest } = require('next/server')
    const { SignJWT } = await import('jose')
    const f = await fixture(), admin = await fixture('ADMIN')
    await prisma.chapterMember.create({ data: { user_id: f.user.id, chapter_id: f.chapter.id } })
    await prisma.$transaction(async tx => {
      const at = await prepareOrganizationTransition(tx, f.user.id, f.dna.id)
      await tx.organizationMembership.create({ data: { user_id: f.user.id, unit_id: f.dna.id, starts_at: at } })
    })
    const request = async id => new NextRequest(`http://localhost/api/v1/admin/organization/history?userId=${f.user.id}`, { headers: { Authorization: `Bearer ${await new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject(id).setExpirationTime('1h').sign(new TextEncoder().encode(process.env.JWT_ACCESS_SECRET))}` } })
    assert.equal((await GET(await request(f.user.id))).status, 403)
    const response = await GET(await request(admin.user.id))
    assert.equal(response.status, 200)
    const data = await response.json()
    assert.equal(data.chapters[0].label, 'Đã rời Chapter')
    assert(data.chapters[0].ends_at)
  })
  await check('browser cache never reuses current organization or auth scope across requests', async () => {
    const { apiFetch, getCachedApiData, clearApiCache } = require('../src/lib/api/client')
    const old = { window: global.window, localStorage: global.localStorage, sessionStorage: global.sessionStorage, fetch: global.fetch }
    const store = new Map(), storage = { getItem: key => store.get(key) || null, setItem: (key, value) => store.set(key, value), removeItem: key => store.delete(key), length: 0, key: () => null }
    global.window = {}; global.localStorage = storage; global.sessionStorage = storage
    let calls = 0
    global.fetch = async () => new Response(JSON.stringify({ current: ++calls }), { status: 200, headers: { 'content-type': 'application/json' } })
    try {
      for (const endpoint of ['/api/v1/auth/me', '/api/v1/users?chapterId=test', '/api/v1/organization/managed-units']) {
        const a = await apiFetch(endpoint), b = await apiFetch(endpoint)
        assert.notEqual(a.data.current, b.data.current)
        assert.equal(getCachedApiData(endpoint), null)
      }
      const a = await apiFetch('/api/v1/courses'), b = await apiFetch('/api/v1/courses')
      assert.equal(a.data.current, b.data.current)
      clearApiCache()
    } finally { Object.assign(global, old) }
  })
  await check('Admin retains unrestricted global management', async () => {
    const f = await fixture('ADMIN'); await appoint(f)
    await prisma.positionAssignment.create({ data: { user_id: f.user.id, unit_id: f.otherUnit.id, position_id: f.position.id } })
    assert.equal(await prisma.chapterLeadBinding.count({ where: { user_id: f.user.id } }), 0)
  })
  await check('Chapter/DNA exclusivity works before cutover, including raw import', async () => {
    const f = await fixture()
    await prisma.chapterMember.create({ data: { user_id: f.user.id, chapter_id: f.chapter.id } })
    await assert.rejects(() => prisma.organizationMembership.create({ data: { user_id: f.user.id, unit_id: f.dna.id } }), /SingleOrganizationAffiliationRequired/)
    assert.equal(await prisma.organizationMembership.count({ where: { user_id: f.user.id, unit_id: f.dna.id } }), 0)
  })
  for (const isolation of ['READ COMMITTED', 'REPEATABLE READ', 'SERIALIZABLE']) {
    await check(`concurrent Chapter/DNA imports at ${isolation}`, async () => {
      const f = await fixture(); let arrived = 0, release
      const barrier = new Promise(resolve => { release = resolve })
      const attempt = unit => rawTransaction(async client => {
        await client.query('SELECT count(*) FROM organization_memberships WHERE user_id=$1', [f.user.id])
        if (++arrived === 2) release()
        await barrier
        await client.query('INSERT INTO organization_memberships(id,user_id,unit_id) VALUES($1,$2,$3)', [randomUUID(), f.user.id, unit])
      }, isolation)
      const responses = await Promise.all([attempt(f.unit.id), attempt(f.dna.id)])
      assert.equal(responses.filter(row => row.ok).length, 1, JSON.stringify(responses))
      assert.equal(await prisma.organizationMembership.count({ where: { user_id: f.user.id } }), 1)
    })
  }
  await fs.mkdir('scratch/organization-integrity', { recursive: true })
  await fs.writeFile('scratch/organization-integrity/tests.json', JSON.stringify(results, null, 2))
})().catch(error => { console.error(error.message); process.exitCode = 1 }).finally(() => prisma.$disconnect())
