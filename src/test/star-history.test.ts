import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Prisma } from '@prisma/client'
import {
  formatStarMonthLabel, isValidStarUserId, normalizeStarHistoryPagination, parseStarHistoryMonth, parseStarHistorySource, starReasonsForSource, vnMonthBounds,
} from '../lib/star-history-rules'
import { StarHistoryEntry, enrichStarHistoryEntries, getAdminUserStarHistory, readStarHistoryPage } from '../lib/star-history'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const USER = id(1), VIDEO = id(2), LESSON = id(3), QUIZ = id(4), FINAL = id(5), ATTEMPT = id(6)
const at = new Date('2026-11-15T03:00:00Z')
const entry = (n: number, reason: StarHistoryEntry['reason'], sourceType: string, sourceId: string, metadata: StarHistoryEntry['metadata'] = null, amount = 3): StarHistoryEntry =>
  ({ id: id(100 + n), amount, reason, awarded_at: at, source_type: sourceType, source_id: sourceId, metadata })

describe('star history pure rules', () => {
  it('normalizes pagination: default 1/20, max limit 50, clamps the page, page 1 when empty', () => {
    assert.deepEqual(normalizeStarHistoryPagination(null, null, 0), { page: 1, limit: 20, totalPages: 0 })
    assert.deepEqual(normalizeStarHistoryPagination('9', '10', 25), { page: 3, limit: 10, totalPages: 3 })
    assert.deepEqual(normalizeStarHistoryPagination('2', '500', 120), { page: 2, limit: 50, totalPages: 3 })
    assert.deepEqual(normalizeStarHistoryPagination('abc', '-1', 5), { page: 1, limit: 20, totalPages: 1 })
    assert.deepEqual(normalizeStarHistoryPagination('4', '20', 0), { page: 1, limit: 20, totalPages: 0 })
  })
  it('accepts YYYY-MM months, treats blank/ALL as no filter and rejects malformed months', () => {
    assert.deepEqual(parseStarHistoryMonth('2026-11'), { ok: true, value: '2026-11' })
    assert.deepEqual(parseStarHistoryMonth(' 2026-01 '), { ok: true, value: '2026-01' })
    for (const blank of [null, undefined, '', '  ', 'ALL', 'all']) assert.deepEqual(parseStarHistoryMonth(blank), { ok: true, value: null })
    for (const bad of ['2026-13', '2026-00', 'abc', '2026-1', '26-11', '2026/11', '2026-11-01']) assert.equal(parseStarHistoryMonth(bad).ok, false, bad)
  })
  it('maps sources to ledger reasons case-insensitively and rejects unknown sources', () => {
    for (const blank of [null, '', ' all ', 'ALL']) assert.deepEqual(parseStarHistorySource(blank), { ok: true, value: 'ALL' })
    assert.deepEqual(parseStarHistorySource(' video '), { ok: true, value: 'VIDEO' })
    assert.deepEqual(parseStarHistorySource('lesson_quiz'), { ok: true, value: 'LESSON_QUIZ' })
    for (const bad of ['QUIZ', 'VIDEO_COMPLETION', 'constructor', '__proto__']) assert.equal(parseStarHistorySource(bad).ok, false, bad)
    assert.equal(starReasonsForSource('ALL'), null)
    assert.deepEqual(starReasonsForSource('VIDEO'), ['VIDEO_COMPLETION'])
    assert.deepEqual(starReasonsForSource('LESSON_QUIZ'), ['MODULE_QUIZ_PASS', 'MODULE_QUIZ_BONUS'])
    assert.deepEqual(starReasonsForSource('COURSE_FINAL'), ['COURSE_FINAL_PASS', 'COURSE_FINAL_BONUS'])
    assert.deepEqual(starReasonsForSource('ADMIN_ADJUSTMENT'), ['ADMIN_ADJUSTMENT'])
  })
  it('computes Vietnam UTC+7 month bounds including leap February and December rollover', () => {
    const iso = (key: string) => { const b = vnMonthBounds(key); return [b.startsAt.toISOString(), b.endsAt.toISOString()] }
    assert.deepEqual(iso('2026-11'), ['2026-10-31T17:00:00.000Z', '2026-11-30T17:00:00.000Z'])
    assert.deepEqual(iso('2024-02'), ['2024-01-31T17:00:00.000Z', '2024-02-29T17:00:00.000Z'])
    assert.deepEqual(iso('2026-02'), ['2026-01-31T17:00:00.000Z', '2026-02-28T17:00:00.000Z'])
    assert.deepEqual(iso('2026-12'), ['2026-11-30T17:00:00.000Z', '2026-12-31T17:00:00.000Z'])
    assert.deepEqual(iso('2027-01'), ['2026-12-31T17:00:00.000Z', '2027-01-31T17:00:00.000Z'])
    assert.deepEqual(iso('0001-01'), ['0000-12-31T17:00:00.000Z', '0001-01-31T17:00:00.000Z'])
    assert.deepEqual(iso('0099-12'), ['0099-11-30T17:00:00.000Z', '0099-12-31T17:00:00.000Z'])
    assert.throws(() => vnMonthBounds('2026-13'))
  })
  it('formats month labels and validates user IDs', () => {
    assert.equal(formatStarMonthLabel('2026-11'), 'Tháng 11/2026')
    assert.equal(formatStarMonthLabel('2027-01'), 'Tháng 01/2027')
    assert.equal(isValidStarUserId(USER), true)
    assert.equal(isValidStarUserId('8F14E45F-CEEA-467A-9575-0E1B1A2B3C4D'), true)
    for (const bad of ['', 'abc', '00000000-0000-4000-8000-00000000001', `${USER}x`, "' OR 1=1 --"]) assert.equal(isValidStarUserId(bad), false, bad)
  })
})

/** Title sources keyed by ID; anything missing behaves like a deleted video, lesson or assessment. */
function titleDb(present = true) {
  const course = { id: id(9), title: 'Khóa Kỹ năng' }
  const videos = present ? [{ id: VIDEO, title: 'Video 1', lesson: { id: LESSON, title: 'Bài mở đầu', session: { course } } }] : []
  const lessons = present ? [{ id: LESSON, title: 'Bài mở đầu', session: { course } }] : []
  const assessments = present ? [
    { id: QUIZ, title: 'Quiz mở đầu', lesson: { title: 'Bài mở đầu', session: { course } }, course: null },
    { id: FINAL, title: 'Thi cuối khóa', lesson: null, course },
  ] : []
  const pick = <T extends { id: string }>(rows: T[]) => ({ findMany: async ({ where }: any) => rows.filter(r => where.id.in.includes(r.id)) })
  return { video: pick(videos), lesson: pick(lessons), assessment: pick(assessments) }
}
const history = [
  entry(1, 'VIDEO_COMPLETION', 'VIDEO', VIDEO),
  entry(2, 'MODULE_QUIZ_PASS', 'ASSESSMENT', QUIZ),
  entry(3, 'MODULE_QUIZ_BONUS', 'ASSESSMENT', QUIZ),
  entry(4, 'COURSE_FINAL_PASS', 'ASSESSMENT', FINAL),
  entry(5, 'COURSE_FINAL_BONUS', 'ASSESSMENT', FINAL),
  entry(6, 'ADMIN_ADJUSTMENT', 'ADMIN', id(7), null, -2),
]

describe('enrichStarHistoryEntries', () => {
  it('adds lesson, course and quiz titles for every reason', async () => {
    const items = await enrichStarHistoryEntries(titleDb() as any, history)
    assert.deepEqual(items.map(i => [i.lessonTitle, i.courseTitle, i.quizTitle, i.detail]), [
      ['Bài mở đầu', 'Khóa Kỹ năng', null, 'Hoàn thành video: Bài mở đầu · Khóa Kỹ năng'],
      ['Bài mở đầu', 'Khóa Kỹ năng', 'Quiz mở đầu', 'Vượt qua bài kiểm tra: Quiz mở đầu · Bài mở đầu'],
      ['Bài mở đầu', 'Khóa Kỹ năng', 'Quiz mở đầu', 'Vượt qua bài kiểm tra: Quiz mở đầu · Bài mở đầu'],
      [null, 'Khóa Kỹ năng', null, 'Vượt qua bài thi cuối khóa: Khóa Kỹ năng'],
      [null, 'Khóa Kỹ năng', null, 'Vượt qua bài thi cuối khóa: Khóa Kỹ năng'],
      [null, null, null, 'Điều chỉnh Star bởi Ban Quản Trị'],
    ])
    assert.deepEqual(Object.keys(items[0]), ['id', 'amount', 'reason', 'awarded_at', 'source_type', 'lessonTitle', 'courseTitle', 'quizTitle', 'detail'])
    assert.equal(items[5].amount, -2)
  })
  it('falls back to generic labels when the video, lesson or assessment was deleted', async () => {
    const items = await enrichStarHistoryEntries(titleDb(false) as any, history)
    assert.deepEqual(items.map(i => i.detail), [
      'Hoàn thành video bài học',
      'Vượt qua bài kiểm tra: Bài kiểm tra',
      'Vượt qua bài kiểm tra: Bài kiểm tra',
      'Vượt qua bài thi cuối khóa',
      'Vượt qua bài thi cuối khóa',
      'Điều chỉnh Star bởi Ban Quản Trị',
    ])
    assert.equal(items[1].quizTitle, 'Bài kiểm tra')
  })
  it('uses the metadata lesson when the video row itself was deleted', async () => {
    const db = { ...titleDb(), video: { findMany: async () => [] } }
    const [item] = await enrichStarHistoryEntries(db as any, [entry(1, 'VIDEO_COMPLETION', 'VIDEO', VIDEO, { lessonId: LESSON })])
    assert.equal(item.detail, 'Hoàn thành video: Bài mở đầu · Khóa Kỹ năng')
  })
})

/** Records every raw query; answers summary, page and month queries from fixed rows. */
function historyDb(options: { summary?: { total: number; amount: number }; page?: StarHistoryEntry[]; months?: string[]; ledger?: number } = {}) {
  const queries: Prisma.Sql[] = []
  const db = {
    ...titleDb(),
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const query = Prisma.sql(strings, ...(values as Prisma.Sql[]))
      queries.push(query)
      if (query.sql.includes('to_char(')) return (options.months ?? []).map(key => ({ key }))
      if (query.sql.includes('count(DISTINCT history_key)')) return [options.summary ?? { total: 0, amount: 0 }]
      return options.page ?? []
    },
    starLedger: { aggregate: async ({ where }: any) => { assert.equal(where.user_id, USER); return { _sum: { amount: options.ledger ?? null } } } },
    user: { findUnique: async ({ where }: any) => where.id === USER ? { id: USER, display_name: 'Lan', email: 'lan@bbe.vn', role: 'LEAD', status: 'ACTIVE' } : null },
  }
  return { db: db as unknown as Prisma.TransactionClient, queries }
}
const query = (params: Record<string, string> = {}) => new URLSearchParams(params)
const notManager = { isLearningManager: async () => false }

describe('readStarHistoryPage filters and grouping', () => {
  it('without filters keeps the unfiltered query used by /stars/me', async () => {
    const { db, queries } = historyDb({ summary: { total: 1, amount: 3 }, page: [history[0]] })
    const result = await readStarHistoryPage(db, USER, null, null)
    assert.deepEqual({ ...result, items: result.items.length }, { items: 1, totalItems: 1, page: 1, limit: 20, totalPages: 1, filteredTotal: 3 })
    for (const q of queries) {
      assert.ok(!q.sql.includes('competition_month_id IS NULL') && !q.sql.includes('ANY('))
      assert.deepEqual(q.values.slice(0, 1), [USER])
    }
  })
  it('matches a month by competition month key or, for legacy rows without one, by VN award time', async () => {
    const { db, queries } = historyDb()
    await readStarHistoryPage(db, USER, null, null, { monthKey: '2026-11', source: 'ALL' })
    const [summary] = queries
    assert.match(summary.sql, /LEFT JOIN competition_months cm ON cm\.id = sl\.competition_month_id/)
    assert.match(summary.sql, /cm\.key = \? OR \(sl\.competition_month_id IS NULL\s+AND sl\.awarded_at >= timezone\('UTC', \?::timestamptz\)\s+AND sl\.awarded_at < timezone\('UTC', \?::timestamptz\)\)/)
    assert.deepEqual(summary.values, [USER, '2026-11', '2026-10-31T17:00:00.000Z', '2026-11-30T17:00:00.000Z'])
  })
  it('filters by source reasons as text', async () => {
    const { db, queries } = historyDb()
    await readStarHistoryPage(db, USER, null, null, { source: 'COURSE_FINAL' })
    assert.match(queries[0].sql, /sl\.reason::text = ANY\(\?::text\[\]\)/)
    assert.deepEqual(queries[0].values, [USER, ['COURSE_FINAL_PASS', 'COURSE_FINAL_BONUS']])
  })
  it('groups one quiz attempt before paging so it never splits across pages', async () => {
    const grouped = entry(2, 'MODULE_QUIZ_BONUS', 'ASSESSMENT', QUIZ, { attemptId: ATTEMPT }, 9)
    const { db, queries } = historyDb({ summary: { total: 21, amount: 69 }, page: [grouped] })
    const result = await readStarHistoryPage(db, USER, '2', '20', { source: 'LESSON_QUIZ' })
    assert.deepEqual([result.totalItems, result.totalPages, result.page, result.filteredTotal], [21, 2, 2, 69])
    assert.deepEqual(result.items, [grouped])
    const [count, page] = queries
    assert.match(count.sql, /count\(DISTINCT history_key\)::int AS total, COALESCE\(sum\(amount\), 0\)::int AS amount FROM scoped_history/)
    assert.match(count.sql, /jsonb_build_array\('QUIZ_ATTEMPT', sl\.source_id, lower\(sl\.metadata->>'attemptId'\),\s+sl\.learning_cycle_id, sl\.competition_month_id/)
    assert.ok(page.sql.indexOf('GROUP BY history_key') < page.sql.indexOf('OFFSET'))
    assert.deepEqual(page.values.slice(-2), [20, 20])
  })
})

describe('getAdminUserStarHistory', () => {
  it('returns balance, ledger total, filtered total, months, filters and enriched items', async () => {
    const { db } = historyDb({ summary: { total: 2, amount: 18 }, page: history.slice(0, 2), months: ['2026-11', '2026-10'], ledger: 42 })
    const result = await getAdminUserStarHistory(db, USER, query({ month: '2026-11', source: 'all' }), notManager)
    assert.ok(result.ok)
    const { items, ...body } = result.body
    assert.deepEqual(body, {
      user: { id: USER, displayName: 'Lan', email: 'lan@bbe.vn', role: 'LEAD', status: 'ACTIVE' },
      balance: 42, ledgerTotal: 42, filteredTotal: 18,
      availableMonths: [{ key: '2026-11', label: 'Tháng 11/2026' }, { key: '2026-10', label: 'Tháng 10/2026' }],
      filters: { month: '2026-11', source: 'ALL' }, page: 1, limit: 20, totalItems: 2, totalPages: 1,
    })
    assert.deepEqual(items.map(i => i.detail), ['Hoàn thành video: Bài mở đầu · Khóa Kỹ năng', 'Vượt qua bài kiểm tra: Quiz mở đầu · Bài mở đầu'])
  })
  it('a learning manager shows balance 0 but the real ledger total', async () => {
    const { db } = historyDb({ ledger: 42 })
    const result = await getAdminUserStarHistory(db, USER, query(), { isLearningManager: async (userId, role) => userId === USER && role === 'LEAD' })
    assert.ok(result.ok)
    assert.deepEqual([result.body.balance, result.body.ledgerTotal], [0, 42])
  })
  it('an empty filter result keeps balance and months with page 1 and no pages', async () => {
    const { db, queries } = historyDb({ months: ['2026-10'], ledger: 7 })
    const result = await getAdminUserStarHistory(db, USER, query({ month: '2026-11', source: 'VIDEO', page: '3' }), notManager)
    assert.ok(result.ok)
    assert.deepEqual(
      { ...result.body, user: undefined },
      { user: undefined, balance: 7, ledgerTotal: 7, filteredTotal: 0, availableMonths: [{ key: '2026-10', label: 'Tháng 10/2026' }],
        filters: { month: '2026-11', source: 'VIDEO' }, items: [], page: 1, limit: 20, totalItems: 0, totalPages: 0 },
    )
    assert.equal(queries.filter(q => q.sql.includes('GROUP BY history_key')).length, 0, 'no page query when empty')
  })
  it('derives available months from competition month or VN award month, newest first', async () => {
    const { db, queries } = historyDb({ ledger: 0 })
    await getAdminUserStarHistory(db, USER, query(), notManager)
    const months = queries.find(q => q.sql.includes('to_char('))!
    assert.match(months.sql, /CASE WHEN sl\.competition_month_id IS NOT NULL THEN cm\.key\s+ELSE to_char\(timezone\('Asia\/Ho_Chi_Minh', timezone\('UTC', sl\.awarded_at\)\), 'YYYY-MM'\) END AS key/)
    assert.match(months.sql, /ORDER BY key DESC/)
  })
  it('rejects invalid input with ValidationError and a missing user with UserNotFound', async () => {
    const { db } = historyDb()
    const cases: Array<[string, Record<string, string>, number, string]> = [
      ['not-a-uuid', {}, 400, 'ValidationError'],
      [USER, { month: '2026-13' }, 400, 'ValidationError'],
      [USER, { source: 'QUIZ' }, 400, 'ValidationError'],
      [id(99), {}, 404, 'UserNotFound'],
    ]
    for (const [userId, params, status, code] of cases) {
      const result = await getAdminUserStarHistory(db, userId, query(params), notManager)
      assert.ok(result.ok === false)
      assert.deepEqual([result.status, result.error.code], [status, code])
    }
  })
})
