import { beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'

// Small data-access modules, run against an in-memory stand-in for Prisma (no database).
const stub = (name: string, exports: unknown) => { const filename = require.resolve(name); require.cache[filename] = { id: filename, filename, loaded: true, exports } as any }
const NOW = new Date('2026-11-22T03:00:00.000Z')
const DAY = 86_400_000
const db: any = {}
let managers = new Set<string>()
let leadScope: any = { isLead: false, chapterId: null }
let rewardAllowed = true
const invalidated: string[] = []
stub('../lib/prisma', { prisma: db })
stub('../lib/manager-learning-access', { isLearningManager: async (userId: string) => managers.has(userId) })
stub('../lib/chapter-lead', { chapterLeadScope: async () => leadScope })
stub('../lib/learning-periods', { lockLearningUser: async () => NOW, rewardEligibility: async () => rewardAllowed })
stub('../lib/auth', { invalidateUserAuthCache: (id: string) => invalidated.push(id) })
const { getUserStarBalance, canEarnStarsForCourse, starsForVideoDuration } = require('../lib/stars')
const { canViewInactiveChapterMember } = require('../lib/inactive-member-access')
const { getParentChapterId, getActiveMetricChapterIds } = require('../lib/active-chapters')
const { countCompletedLessonsByCourse } = require('../lib/progress/completed-lesson-counts')
const bank = require('../lib/final-exam-bank')
const { createFinalExamVersion } = require('../lib/final-exam-version')
const { retireInactiveAccounts } = require('../lib/account-retirement')
const { normalizeLearningOrganization } = require('../lib/normalize-learning-organization')

beforeEach(() => { for (const key of Object.keys(db)) delete db[key]; managers = new Set(); leadScope = { isLead: false, chapterId: null }; rewardAllowed = true; invalidated.length = 0 })

describe('số dư sao', () => {
  it('sums the ledger for a learner and is 0 for a learner with no entries', async () => {
    let where: any
    db.starLedger = { aggregate: async (args: any) => { where = args.where; return { _sum: { amount: 37 } } } }
    assert.equal(await getUserStarBalance('member-1', 'MEMBER'), 37)
    assert.deepEqual(where, { user_id: 'member-1' })
    db.starLedger = { aggregate: async () => ({ _sum: { amount: null } }) }
    assert.equal(await getUserStarBalance('member-2', 'MEMBER'), 0)
  })
  it('Admin and Lead always show 0 stars, without reading the ledger', async () => {
    managers = new Set(['lead-1'])
    db.starLedger = { aggregate: async () => { throw new Error('ledger must not be read for a manager') } }
    assert.equal(await getUserStarBalance('lead-1', 'LEAD'), 0)
  })
  it('follows the reward-eligibility rule and re-exports the reward formula', async () => {
    assert.equal(await canEarnStarsForCourse('member-1', 'course-1'), true)
    rewardAllowed = false
    assert.equal(await canEarnStarsForCourse('member-1', 'course-1'), false)
    assert.deepEqual([59, 60, 600, 659].map(starsForVideoDuration), [1, 1, 10, 10])
  })
})

describe('ai được xem thành viên đã vô hiệu hóa của một Chapter', () => {
  beforeEach(() => {
    db.chapter = { findUnique: async ({ where }: any) => where.id === 'chapter-a' ? { organization_unit_id: 'unit-a' } : where.id === 'no-unit' ? { organization_unit_id: null } : null }
    db.positionAssignment = { findFirst: async () => null }
  })
  it('Admin can, for any Chapter', async () => assert.equal(await canViewInactiveChapterMember({ userId: 'admin', role: 'ADMIN' }, 'chapter-b'), true))
  it('a Chapter Lead can for the own Chapter only', async () => {
    leadScope = { isLead: true, chapterId: 'chapter-a' }
    assert.equal(await canViewInactiveChapterMember({ userId: 'lead', role: 'LEAD' }, 'chapter-a'), true)
    assert.equal(await canViewInactiveChapterMember({ userId: 'lead', role: 'LEAD' }, 'chapter-b'), false)
  })
  it('a Member cannot; an unknown Chapter or one without a unit is denied', async () => {
    assert.equal(await canViewInactiveChapterMember({ userId: 'member', role: 'MEMBER' }, 'chapter-a'), false)
    assert.equal(await canViewInactiveChapterMember({ userId: 'member', role: 'MEMBER' }, 'missing'), false)
    assert.equal(await canViewInactiveChapterMember({ userId: 'member', role: 'MEMBER' }, 'no-unit'), false)
  })
  it('only a current CHAPTER_LEAD appointment on that Chapter unit counts', async () => {
    let where: any
    db.positionAssignment = { findFirst: async (args: any) => { where = args.where; return { id: 'assignment' } } }
    assert.equal(await canViewInactiveChapterMember({ userId: 'lead-2', role: 'LEAD' }, 'chapter-a'), true)
    assert.deepEqual([where.user_id, where.unit_id, where.position], ['lead-2', 'unit-a', { code: 'CHAPTER_LEAD' }])
    assert.ok(where.starts_at.lte instanceof Date)
    assert.deepEqual([where.OR[0], Object.keys(where.OR[1].ends_at)], [{ ends_at: null }, ['gt']])
  })
})

describe('Chapter của một đơn vị', () => {
  const units: Record<string, any> = {
    department: { parent_id: 'chapter-unit', chapter: null }, 'chapter-unit': { parent_id: 'root', chapter: { id: 'chapter-a' } }, root: { parent_id: null, chapter: null },
    'dna-group': { parent_id: 'dna', chapter: null }, dna: { parent_id: 'root', chapter: null }, 'loop-a': { parent_id: 'loop-b', chapter: null }, 'loop-b': { parent_id: 'loop-a', chapter: null },
  }
  beforeEach(() => { db.organizationUnit = { findUnique: async ({ where }: any) => units[where.id] || null } })
  it('walks up from a department to its Chapter; a Chapter unit is its own Chapter', async () => {
    assert.equal(await getParentChapterId('department'), 'chapter-a')
    assert.equal(await getParentChapterId('chapter-unit'), 'chapter-a')
  })
  it('a DNA group, an unknown unit and a corrupted parent loop have no Chapter (and the loop terminates)', async () => {
    assert.equal(await getParentChapterId('dna-group'), null)
    assert.equal(await getParentChapterId('missing'), null)
    assert.equal(await getParentChapterId('loop-a'), null)
  })
  it('public metrics count only ACTIVE Chapters that have an active Lead', async () => {
    let where: any
    db.chapter = { findMany: async (args: any) => { where = args.where; return [{ id: 'chapter-a' }, { id: 'chapter-b' }] } }
    assert.deepEqual(await getActiveMetricChapterIds(NOW), ['chapter-a', 'chapter-b'])
    assert.equal(where.status, 'ACTIVE')
    assert.deepEqual(where.OR[0], { chapter_members: { some: { user: { status: 'ACTIVE', role: 'LEAD' } } } })
    const appointment = where.OR[1].organization_unit.positions.some
    assert.deepEqual([appointment.position, appointment.user, appointment.starts_at], [{ code: 'CHAPTER_LEAD' }, { status: 'ACTIVE' }, { lte: NOW }])
    assert.deepEqual(appointment.OR, [{ ends_at: null }, { ends_at: { gt: NOW } }])
  })
})

describe('đếm bài đã hoàn thành', () => {
  it('does not query when there are no learners or no courses', async () => {
    db.$queryRaw = async () => { throw new Error('must not query') }
    assert.deepEqual(await countCompletedLessonsByCourse([], ['course']), [])
    assert.deepEqual(await countCompletedLessonsByCourse(['user'], []), [])
  })
  it('counts only completed lessons, grouped per learner and course, with ids passed as parameters', async () => {
    let query: any
    db.$queryRaw = async (sql: any) => { query = sql; return [{ user_id: 'u1', course_id: 'c1', completed_count: BigInt(3) }] }
    assert.deepEqual(await countCompletedLessonsByCourse(['u1', "u2'; DROP TABLE users;--"], ['c1']), [{ user_id: 'u1', course_id: 'c1', completed_count: BigInt(3) }])
    assert.match(query.sql, /lp\.completed = true/)
    assert.match(query.sql, /GROUP BY lp\.user_id, s\.course_id/)
    assert.ok(!query.sql.includes('DROP TABLE'), 'ids never become part of the SQL text')
    assert.deepEqual(query.values, ['u1', "u2'; DROP TABLE users;--", 'c1'])
  })
})

describe('ngân hàng câu hỏi thi cuối khóa', () => {
  const tx = (available: number, final: any) => ({ question: { count: async () => available }, assessment: { findUnique: async () => final } })
  it('a course without a final exam needs no capacity', async () => assert.equal(await bank.assertFinalExamBankCapacity(tx(0, null), 'course'), undefined))
  it('accepts a bank with exactly enough questions and refuses one question short, in Vietnamese with both numbers', async () => {
    await bank.assertFinalExamBankCapacity(tx(10, { question_count: 10 }), 'course')
    await assert.rejects(() => bank.assertFinalExamBankCapacity(tx(9, { question_count: 10 }), 'course'), (error: any) => {
      // ts-node compiles tests to ES5, where a subclass of Error loses its prototype; restore it so the mapping below is exercised.
      Object.setPrototypeOf(error, bank.FinalExamBankTooSmall.prototype)
      assert.deepEqual([error.requested, error.available], [10, 9])
      assert.match(error.message, /cần 10 câu, nhưng sau thay đổi chỉ còn 9 câu/)
      assert.deepEqual(bank.finalExamBankError(error), { error: { code: 'FinalExamBankTooSmall', message: error.message, requested: 10, available: 9, scheduled: false } })
      return true
    })
    assert.equal(bank.finalExamBankError(new Error('khác')), null)
  })
  it('the bank is the active (non-archived) lesson questions of that course only', () => {
    assert.deepEqual(bank.lessonQuestionWhere('course-1'), { archived_at: null, assessment: { type: 'LESSON', lesson: { session: { course_id: 'course-1' } } } })
  })

  const option = (id: string, correct: boolean) => ({ option_text: id, is_correct: correct, sort_order: 0 })
  const question = (id: string, options = [option('a', true), option('b', false)]) => ({ id, assessment_id: `lesson-${id}`, question_text: `Câu ${id}`, question_type: 'SINGLE_CHOICE', points: 1, sort_order: 0, explanation: null, options })
  function examTx(source: any[], latestVersion: number | null) {
    const log: any = { deactivated: 0, questions: [], options: [], locked: 0 }
    return { log, tx: {
      $queryRaw: async () => { log.locked += 1 },
      question: { count: async () => source.length, findMany: async () => source, createMany: async ({ data }: any) => { log.questions = data } },
      questionOption: { createMany: async ({ data }: any) => { log.options = data } },
      assessment: { upsert: async (args: any) => { log.upsert = args; return { id: 'final' } } },
      finalExamVersion: {
        findFirst: async () => latestVersion === null ? null : { version_number: latestVersion },
        updateMany: async ({ where }: any) => { log.deactivated += 1; log.deactivateWhere = where },
        create: async ({ data }: any) => { log.version = data; return { id: 'version-new', ...data } },
      },
    } }
  }
  const config = { title: 'Thi cuối khóa', description: null, questionCount: 2, durationMinutes: 30 }
  it('creates version 1 as a frozen copy of the lesson questions with new ids', async () => {
    const { tx: fake, log } = examTx([question('q1'), question('q2'), question('q3')], null)
    const result = await createFinalExamVersion(fake, 'course', config, 'admin')
    assert.equal(log.locked, 1, 'the course row is locked first')
    assert.deepEqual([log.version.version_number, log.version.is_active, log.version.question_count, log.version.duration_minutes], [1, true, 2, 30])
    assert.equal(result.availableQuestions, 3)
    assert.equal(log.questions.length, 3)
    assert.deepEqual(log.questions.map((copy: any) => copy.source_assessment_id), ['lesson-q1', 'lesson-q2', 'lesson-q3'])
    assert.ok(log.questions.every((copy: any) => copy.final_exam_version_id === 'version-new' && !['q1', 'q2', 'q3'].includes(copy.id)))
    assert.equal(log.options.length, 6)
    assert.deepEqual(new Set(log.options.map((copy: any) => copy.question_id)), new Set(log.questions.map((copy: any) => copy.id)))
  })
  it('a new version increments the number and retires the active one, keeping old attempts intact', async () => {
    const { tx: fake, log } = examTx([question('q1'), question('q2')], 4)
    await createFinalExamVersion(fake, 'course', config, 'admin')
    assert.equal(log.version.version_number, 5)
    assert.deepEqual(log.deactivateWhere, { assessment_id: 'final', is_active: true })
  })
  it('refuses more questions than the bank holds, and a source question without a correct answer or with one option', async () => {
    await assert.rejects(() => createFinalExamVersion(examTx([question('q1')], null).tx, 'course', config, 'admin'), (error: any) => error.requested === 2 && error.available === 1)
    await assert.rejects(() => createFinalExamVersion(examTx([question('q1'), question('q2', [option('a', false), option('b', false)])], null).tx, 'course', config, 'admin'), /InvalidFinalExamSourceQuestion/)
    const broken = examTx([question('q1'), question('q2', [option('a', true)])], null)
    await assert.rejects(() => createFinalExamVersion(broken.tx, 'course', config, 'admin'), /InvalidFinalExamSourceQuestion/)
    assert.equal(broken.log.version, undefined, 'nothing is written when validation fails')
  })
})

describe('ẩn danh tài khoản đã vô hiệu hóa quá 30 ngày', () => {
  function world(user: any) {
    const log: any = { deleted: [], updates: {}, audit: [] }
    const model = (name: string) => ({ deleteMany: async ({ where }: any) => { log.deleted.push([name, where]) }, updateMany: async ({ where, data }: any) => { log.updates[name] = { where, data } } })
    const tx: any = {
      user: { findUniqueOrThrow: async () => user, update: async ({ data }: any) => { log.user = data } },
      refreshToken: model('refreshToken'), passwordResetToken: model('passwordResetToken'), invitation: model('invitation'), chapterMember: model('chapterMember'),
      organizationMembership: model('organizationMembership'), positionAssignment: model('positionAssignment'), chapterReorganizationItem: model('chapterReorganizationItem'), lessonComment: model('lessonComment'),
      $queryRaw: async () => [{ id: 'audit-1', metadata: { email: user.email, note: `Mời ${user.display_name} (${user.email})`, other: 'giữ nguyên' } }],
      auditLog: { update: async ({ data }: any) => { log.redacted = data.metadata }, create: async ({ data }: any) => { log.audit.push(data) } },
    }
    db.user = { findMany: async (args: any) => { log.candidateQuery = args; return [{ id: user.id }] } }
    db.$transaction = async (work: any) => work(tx)
    return log
  }
  const inactive = (daysAgo: number, extra = {}) => ({ id: 'user-1', email: 'an@bbe.example', display_name: 'Nguyễn An', status: 'INACTIVE', anonymized_at: null, deactivated_at: new Date(NOW.getTime() - daysAgo * DAY), ...extra })
  it('removes credentials and identifying data but keeps the historical identity', async () => {
    const log = world(inactive(31))
    assert.equal(await retireInactiveAccounts(), 1)
    assert.deepEqual([log.candidateQuery.where.status, log.candidateQuery.where.anonymized_at, log.candidateQuery.take], ['INACTIVE', null, 100])
    assert.deepEqual(log.deleted, [['refreshToken', { user_id: 'user-1' }], ['passwordResetToken', { user_id: 'user-1' }], ['invitation', { email: 'an@bbe.example' }], ['chapterMember', { user_id: 'user-1' }]])
    assert.equal(log.user.email, 'retired-user-1@anonymous.invalid')
    assert.equal(log.user.display_name, null)
    assert.equal(log.user.password_hash, '!RETIRED')
    assert.deepEqual(log.user.auth_version, { increment: 1 })
    assert.equal(log.user.anonymized_at, NOW)
    assert.deepEqual(log.updates.organizationMembership.data, { status: 'ENDED', ends_at: NOW })
    assert.deepEqual(log.updates.positionAssignment.data, { ends_at: NOW })
    assert.deepEqual(log.updates.lessonComment.data, { content: '[Đã gỡ tài khoản]' })
    assert.deepEqual(log.redacted, { email: '[removed]', note: 'Mời [removed] ([removed])', other: 'giữ nguyên' })
    assert.deepEqual(log.audit.map((entry: any) => [entry.action, entry.entity_id]), [['ANONYMIZE_INACTIVE_ACCOUNT', 'user-1']])
    assert.ok(!JSON.stringify(log.audit).includes('an@bbe.example'))
    assert.deepEqual(invalidated, ['user-1'])
  })
  for (const [title, user] of [
    ['an account deactivated 29 days ago', inactive(29)],
    ['an account Admin reactivated in the meantime', inactive(40, { status: 'ACTIVE' })],
    ['an account that is already anonymised', inactive(40, { anonymized_at: NOW })],
  ] as const) it(`leaves ${title} untouched`, async () => {
    const log = world(user)
    assert.equal(await retireInactiveAccounts(), 0)
    assert.equal(log.user, undefined)
    assert.deepEqual(log.deleted, [])
    assert.deepEqual(invalidated, [])
  })
})

describe('chuẩn hóa tổ chức học tập', () => {
  function orgTx(departments: any[], dnaGroups: any[] = []) {
    const log: any = { created: [], updated: [], audit: [] }
    return { log, tx: {
      organizationUnit: {
        findMany: async ({ where }: any) => where.type === 'CHAPTER' ? [{ id: 'chapter-unit' }] : where.type === 'DEPARTMENT' ? departments : dnaGroups,
        update: async ({ where, data }: any) => { log.updated.push([where.id, data]) },
        create: async ({ data }: any) => { log.created.push(data.code); return { id: `new-${data.code}` } },
      },
      position: { upsert: async () => ({ id: 'president' }) },
      auditLog: { create: async ({ data }: any) => { log.audit.push(data) } },
    } }
  }
  const standard = [['BTV', 'Ban Thành Viên'], ['BTK', 'Ban Thư Ký'], ['BND', 'Ban Nội Dung'], ['BCL', 'Ban Chất Lượng'], ['BDHU', 'Ban Định Hướng'], ['BKM', 'Ban Khách Mời'], ['BTTSK', 'Ban TT&SK']]
  it('a Chapter that already has the seven coded departments is left alone and nothing is audited', async () => {
    const { tx, log } = orgTx(standard.map(([code, name]) => ({ id: code, code, name })))
    assert.deepEqual(await normalizeLearningOrganization(tx, 'admin'), [])
    assert.deepEqual([log.created, log.updated, log.audit], [[], [], []])
  })
  it('gives a stable code to a department matched by name (accents, case, spacing, missing "Ban") and creates the missing ones', async () => {
    const { tx, log } = orgTx([{ id: 'd1', code: null, name: '  ban   THÀNH viên ' }, { id: 'd2', code: null, name: 'Thu Ky' }, { id: 'd3', code: 'BND', name: 'Tên khác' }])
    const changes = await normalizeLearningOrganization(tx, 'admin')
    assert.deepEqual(log.updated, [['d1', { code: 'BTV' }], ['d2', { code: 'BTK' }]])
    assert.deepEqual(log.created, ['BCL', 'BDHU', 'BKM', 'BTTSK'])
    assert.equal(changes.length, 6)
    assert.deepEqual([log.audit.length, log.audit[0].action, log.audit[0].actor_user_id], [1, 'NORMALIZE_LEARNING_ORGANIZATION', 'admin'])
  })
  it('stops for Admin review when two units claim the same department', async () => {
    const { tx, log } = orgTx([{ id: 'd1', code: 'BTV', name: 'Ban Thành Viên' }, { id: 'd2', code: null, name: 'Thành Viên' }])
    await assert.rejects(() => normalizeLearningOrganization(tx, 'admin'), /DuplicateDepartment:chapter-unit:BTV/)
    assert.deepEqual(log.audit, [])
  })
  it('codes the three DNA groups by name and ignores any other group', async () => {
    const { tx, log } = orgTx(standard.map(([code, name]) => ({ id: code, code, name })), [{ id: 'g1', name: ' ldc ', code: null }, { id: 'g2', name: 'TT', code: 'TT' }, { id: 'g3', name: 'Nhóm khác', code: null }])
    assert.deepEqual(await normalizeLearningOrganization(tx), [{ unitId: 'g1', action: 'ASSIGN_STABLE_DNA_CODE', code: 'LDC' }])
    assert.deepEqual(log.updated, [['g1', { code: 'LDC' }]])
  })
})
