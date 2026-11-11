import { describe, it, TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { competitionMonthBounds } from '../lib/learning-cycle-rules'
import { individualPeriodRows, hasNativeLearningEvidence, closeCompetitionTerms } from '../lib/competition-snapshots'
import { NextRequest } from 'next/server'
import { periodLeaderboard } from '../lib/period-leaderboard'

function replacePrisma(t: TestContext, db: any) {
  const module = require('../lib/prisma')
  const original = module.prisma
  module.prisma = db
  t.after(() => { module.prisma = original })
}

const root = path.resolve(__dirname, '../..')
const read = (file: string) => readFileSync(path.join(root, file), 'utf8')

const USER = '00000000-0000-4000-8000-000000000001'
const CHAPTER = '00000000-0000-4000-8000-0000000000c1'
const at = (iso: string) => new Date(iso)

// One MEMBER in one chapter whose competition term began before both months.
// October ledger: 10 stars, November ledger: 10 stars.
function stubTx() {
  const ledger = [
    { user_id: USER, amount: 10, awarded_at: at('2026-10-10T05:00:00Z') },
    { user_id: USER, amount: 10, awarded_at: at('2026-11-05T05:00:00Z') },
  ]
  const termCalls: unknown[] = []
  const tx: any = {
    accountStateInterval: { findMany: async () => [{ user_id: USER, role: 'MEMBER', status: 'ACTIVE' }] },
    chapterAffiliationInterval: { findMany: async () => [{ user_id: USER, chapter_id: CHAPTER }] },
    chapter: { findMany: async () => [{ id: CHAPTER, name: 'Chapter A' }] },
    positionAssignment: { findMany: async () => [] },
    organizationMembership: { findMany: async () => [] },
    chapterCompetitionTerm: {
      findMany: async (args: unknown) => { termCalls.push(args); return [{ chapter_id: CHAPTER, starts_at: at('2026-10-01T00:00:00Z'), ends_at: null }] },
    },
    starLedger: {
      findMany: async ({ where }: any) => ledger.filter((row) => row.awarded_at >= where.awarded_at.gte && row.awarded_at < where.awarded_at.lt),
    },
  }
  return { tx, termCalls }
}

describe('individual month board does not carry stars over', () => {
  const novStart = at('2026-10-31T17:00:00Z')
  const novEnd = at('2026-11-30T17:00:00Z')

  it('shows only the stars earned in the month, even when a chapter term started earlier', async () => {
    const { tx, termCalls } = stubTx()
    const [row] = await individualPeriodRows(tx, novStart, novEnd, 'MEMBER')
    assert.equal(row.stars, 10)
    assert.equal(termCalls.length, 0)
  })

  it('a TERM board still accumulates from the chapter term start', async () => {
    const { tx } = stubTx()
    const [row] = await individualPeriodRows(tx, novStart, novEnd, 'MEMBER', undefined, undefined, undefined, { chapterTerms: true })
    assert.equal(row.stars, 20)
  })
})

const dnaSeason = {
  id: '00000000-0000-4000-8000-0000000000d1',
  starts_at: at('2024-01-01T00:00:00+07:00'),
  ends_at: at('2024-07-01T00:00:00+07:00'),
  reward_boundary_at: at('2024-04-01T00:00:00+07:00'),
}
const dnaStart = dnaSeason.reward_boundary_at
const dnaEnd = at('2024-10-01T00:00:00+07:00')

function nativeEvidenceTx(rows: { provenance: string; awarded_at: Date }[]) {
  return { starLedger: { findFirst: async ({ where, select }: any) => {
    assert.equal(where.provenance, 'NATIVE')
    assert.deepEqual(select, { id: true })
    return rows.find(row => row.provenance === where.provenance && row.awarded_at >= where.awarded_at.gte && row.awarded_at < where.awarded_at.lt) || null
  } } }
}

describe('DNA historical season evidence', () => {
  it('excludes legacy and native evidence outside the half-open season window', async () => {
    const tx = nativeEvidenceTx([
      { provenance: 'LEGACY', awarded_at: dnaStart },
      { provenance: 'NATIVE', awarded_at: at('2024-03-31T16:59:59.999Z') },
      { provenance: 'NATIVE', awarded_at: dnaEnd },
    ])
    assert.equal(await hasNativeLearningEvidence(tx as any, dnaStart, dnaEnd), false)
  })

  it('includes native evidence exactly at the season start', async () => {
    assert.equal(await hasNativeLearningEvidence(nativeEvidenceTx([{ provenance: 'NATIVE', awarded_at: dnaStart }]) as any, dnaStart, dnaEnd), true)
  })

  for (const scenario of ['legacy-only', 'native', 'saved', 'saved-while-waiting'] as const) {
    it(`scheduler preserves historical seasons: ${scenario}`, async (t) => {
      const saved = { key: `ranking:DNA:${dnaSeason.id}`, payload: { state: 'FINALIZED', items: [{ stars: 9 }] } }
      const unchanged = JSON.stringify(saved)
      const created: any[] = []
      let evidenceReads = 0
      const events: string[] = []
      const evidence = nativeEvidenceTx([{ provenance: scenario === 'native' || scenario === 'saved-while-waiting' ? 'NATIVE' : 'LEGACY', awarded_at: dnaStart }])
      const tx: any = {
        user: { findMany: async () => { events.push('users'); return [{ id: USER }] } },
        $queryRaw: async (sql: TemplateStringsArray) => {
          if (sql.join('').includes('FOR UPDATE')) { events.push('lock'); return [{ id: USER }] }
          return [{ now: at('2026-11-10T05:00:00Z') }]
        },
        learningSnapshot: {
          findUnique: async () => {
            events.push('snapshot')
            return scenario === 'saved' || (scenario === 'saved-while-waiting' && events.includes('lock')) ? saved : null
          },
          create: async ({ data }: any) => { created.push(data); return data },
        },
        starLedger: { findFirst: async (args: any) => { events.push('evidence'); evidenceReads++; return evidence.starLedger.findFirst(args) } },
        accountStateInterval: { findMany: async () => [] },
        chapterAffiliationInterval: { findMany: async () => [] },
        chapter: { findMany: async () => [] },
        positionAssignment: { findMany: async () => [] },
        organizationMembership: { findMany: async () => [] },
      }
      replacePrisma(t, {
        chapterCompetitionTerm: { findMany: async () => [] },
        transferSeason: { findMany: async ({ where }: any) => where.reward_boundary_at ? [dnaSeason] : [] },
        $transaction: async (callback: any) => callback(tx),
      })
      assert.equal(await closeCompetitionTerms(), scenario === 'native' ? 1 : 0)
      assert.equal(created.length, scenario === 'native' ? 1 : 0)
      assert.equal(evidenceReads, scenario === 'saved' ? 0 : 1)
      assert.deepEqual(events, scenario === 'saved' ? ['snapshot'] : scenario === 'native'
        || scenario === 'saved-while-waiting' ? ['snapshot', 'evidence', 'users', 'lock', 'snapshot'] : ['snapshot', 'evidence'])
      assert.equal(JSON.stringify(saved), unchanged)
      if (scenario === 'native') {
        assert.equal(created[0].payload.period.starts_at, dnaStart.toISOString())
        assert.equal(created[0].payload.period.ends_at, dnaEnd.toISOString())
        assert.equal(created[0].payload.state, 'FINALIZED')
      }
    })
  }

  for (const scenario of ['legacy-only', 'native', 'saved'] as const) {
    it(`DNA board serves only supported history: ${scenario}`, async (t) => {
      const payload = { group: 'DNA', periodType: 'TERM', period: { ...dnaSeason, starts_at: dnaStart.toISOString(), ends_at: dnaEnd.toISOString() }, state: 'FINALIZED', items: [] }
      let evidenceReads = 0
      replacePrisma(t, {
        transferSeason: { findFirst: async () => dnaSeason },
        learningSnapshot: { findUnique: async () => scenario === 'saved' ? { payload } : null },
        starLedger: { findFirst: async () => { evidenceReads++; return scenario === 'native' ? { id: 'evidence' } : null } },
      })
      const response = await periodLeaderboard(new NextRequest(`http://localhost/api/v1/leaderboard?group=DNA&periodType=TERM&periodId=${dnaSeason.id}`))
      const body = await response.json()
      assert.equal(response.status, 200)
      assert.equal(body.state, scenario === 'saved' ? 'FINALIZED' : scenario === 'native' ? 'AWAITING_SNAPSHOT' : 'PERIOD_UNAVAILABLE')
      assert.equal(body.period.starts_at, dnaStart.toISOString())
      assert.equal(evidenceReads, scenario === 'saved' ? 0 : 1)
      if (scenario === 'saved') assert.deepEqual(body, JSON.parse(JSON.stringify(payload)))
      if (scenario === 'legacy-only') assert.equal(body.reasonCode, 'HISTORICAL_SEASON_UNAVAILABLE')
    })
  }
})

describe('Learning configuration route compatibility', () => {
  const handlers = () => require('../app/api/v1/admin/learning-config/route')

  it('forward migration changes only the activation guard and retains the affiliation check', () => {
    const functionSql = (source: string) => source.match(/CREATE(?: OR REPLACE)? FUNCTION enforce_single_learning_affiliation\(\)[\s\S]*?END \$\$;/)![0]
    const original = functionSql(read('prisma/migrations/20261022_learning_guards/migration.sql'))
    const expected = original.replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION').split('\n').filter(line => !line.trim().startsWith('IF NOT EXISTS(')).join('\n')
    const migration = read('prisma/migrations/20261110_learning_affiliation_without_policy/migration.sql')
    assert.equal(functionSql(migration), expected)
    assert.doesNotMatch(migration, /DROP TABLE|CREATE CONSTRAINT TRIGGER/)
  })

  it('admin learning config pages are removed while the API contract stays for rollback', () => {
    assert.equal(existsSync(path.join(root, 'src/app/admin/learning-config/page.tsx')), false)
    assert.equal(existsSync(path.join(root, 'src/app/admin/learning-policy/page.tsx')), false)
    assert.equal(existsSync(path.join(root, 'src/app/api/v1/admin/learning-config/route.ts')), true)
  })

  it('legacy API delegates both methods to the canonical handlers', () => {
    const current = handlers()
    const alias = require('../app/api/v1/admin/learning-policy/route')
    assert.equal(alias.GET, current.GET)
    assert.equal(alias.PUT, current.PUT)
  })

  it('denies non-admin reads and writes without reaching the database', async (t) => {
    t.mock.method(require('../lib/auth'), 'authenticate', async () => ({ ok: true, context: { role: 'MEMBER', userId: USER } }))
    replacePrisma(t, {})
    const request = new NextRequest('http://localhost/api/v1/admin/learning-config')
    assert.equal((await handlers().GET(request)).status, 403)
    assert.equal((await handlers().PUT(request)).status, 403)
  })

  it('keeps all configuration fields for admin GET', async (t) => {
    t.mock.method(require('../lib/auth'), 'authenticate', async () => ({ ok: true, context: { role: 'ADMIN', userId: USER } }))
    replacePrisma(t, {
      learningProgram: { findMany: async () => [{ code: 'CORE_DNA' }] },
      learningTarget: { findMany: async () => [{ code: 'MEMBER_DNA' }] },
      course: { findMany: async () => [{ id: 'course', title: 'Khóa học', program_id: null, status: 'DRAFT' }] },
      learningOutbox: { count: async () => 3, findMany: async () => [{ id: 'event' }] },
      transferSeason: { findMany: async () => [] },
    })
    const response = await handlers().GET(new NextRequest('http://localhost/api/v1/admin/learning-config'))
    const body = await response.json()
    assert.equal(response.status, 200)
    assert.deepEqual(Object.keys(body).sort(), ['programs', 'targets', 'courses', 'pending', 'failed', 'seasons'].sort())
    assert.equal(body.pending, 3)
    assert.equal(body.courses[0].id, 'course')
    assert.equal(body.failed[0].id, 'event')
  })

  it('keeps catalog, draft mapping and outbox retry writes with the renamed audit action', async (t) => {
    t.mock.method(require('../lib/auth'), 'authenticate', async () => ({ ok: true, context: { role: 'ADMIN', userId: USER } }))
    let courseUpdate: any, retryUpdate: any, audit: any
    const tx: any = {
      $queryRaw: async () => [],
      learningProgram: { upsert: async () => ({}), findUniqueOrThrow: async () => ({ id: 'program' }) },
      learningTarget: { upsert: async () => ({}) },
      course: { findUniqueOrThrow: async () => ({ status: 'DRAFT', program_id: null }), update: async (args: any) => { courseUpdate = args } },
      learningOutbox: { updateMany: async (args: any) => { retryUpdate = args } },
      auditLog: { create: async ({ data }: any) => { audit = data } },
    }
    replacePrisma(t, { $transaction: async (callback: any) => callback(tx) })
    const response = await handlers().PUT(new NextRequest('http://localhost/api/v1/admin/learning-config', {
      method: 'PUT', body: JSON.stringify({ courses: [{ courseId: 'course', programCode: 'CORE_DNA' }], retryOutboxIds: [USER] }),
    }))
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { saved: true })
    assert.equal(courseUpdate.data.program_id, 'program')
    assert.deepEqual(retryUpdate.where, { id: { in: [USER] }, processed_at: null })
    assert.equal(audit.action, 'CONFIGURE_LEARNING_CONFIG')
  })
})

describe('monthly star reset', () => {
  it('derives the current month from the calendar even before its row exists', () => {
    const bounds = competitionMonthBounds(new Date('2026-10-31T17:00:00Z'))
    assert.equal(bounds.key, '2026-11')
    assert.equal(bounds.startsAt.toISOString(), '2026-10-31T17:00:00.000Z')
  })

  it('quiz start gate does not skip the replay check when the month row is missing', () => {
    const source = read('src/app/api/v1/assessments/[assessmentId]/attempts/route.ts')
    assert.match(source, /const monthBounds = competitionMonthBounds\(now\)/)
    assert.match(source, /submitted_at: \{ lt: monthBounds\.startsAt \}/)
    assert.match(source, /competitionMonth\.findUnique\(\{ where: \{ key: monthBounds\.key \}/)
    assert.doesNotMatch(source, /competitionMonth\.findFirst/)
    // Without a month row there is no replay, so the learner is asked to replay.
    assert.match(source, /const replay = currentMonth && await prisma\.monthlyVideoReplay\.findUnique/)
    assert.match(source, /if \(!replay \|\| !replay\.completed_at\)/)
  })

  it('an attempt started last month needs a replay this month before earning stars', () => {
    const source = read('src/lib/quiz-submission.ts')
    assert.match(source, /attempt\.started_at < context\.month\.starts_at/)
    assert.match(source, /competition_month_id: context\.month\.id, learning_cycle_id: context\.cycle\.id \} \},\s*select: \{ completed_at: true \}/)
    assert.match(source, /if \(monthlyReplayDone && \(eligible \|\| paused\)\)/)
  })

  it('reward budgets stay keyed by month and learning cycle', () => {
    assert.match(read('src/lib/video-heartbeat.ts'), /`video:\$\{userId\}:\$\{lesson\.video\.id\}:\$\{context\.month\.id\}:\$\{context\.cycle\.id\}`/)
    assert.match(read('src/lib/quiz-submission.ts'), /competition_month_id: context\.month\.id, learning_cycle_id: context\.cycle\.id \}\s*const mark = await tx\.quizRewardHighWaterMark\.upsert/)
  })
})
