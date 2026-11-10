import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { Prisma } from '@prisma/client'
import { validSessionOrder, reorderCourseSessions } from '../lib/session-reorder'
import { PoolUpdateError, updateLessonPools } from '../lib/assessment-pools'

const ID = '11111111-1111-1111-1111-111111111111'
describe('session reorder', () => {
  it('rejects malformed, duplicate, fractional, negative and overflowing input', () => {
    for (const rows of [null, [], [null], [{ sessionId: 'bad', sortOrder: 0 }], [{ sessionId: ID, sortOrder: -1 }], [{ sessionId: ID, sortOrder: 0.5 }], [{ sessionId: ID, sortOrder: 2147483648 }], [{ sessionId: ID, sortOrder: 0 }, { sessionId: ID, sortOrder: 1 }]]) assert.equal(validSessionOrder(rows), false)
    assert.equal(validSessionOrder([{ sessionId: ID, sortOrder: 0 }]), true)
  })
  for (const status of ['DRAFT', 'PUBLISHED']) it(`checks ownership and published status before writing (${status})`, async () => {
    let writes = 0
    const tx = { $queryRaw: async () => [], course: { findUnique: async () => ({ status }) }, session: { findMany: async ({ where }: any) => { assert.equal(where.course_id, 'course'); return [] }, update: async () => { writes++ } } } as unknown as Prisma.TransactionClient
    const result = await reorderCourseSessions(tx, 'course', [{ sessionId: ID, sortOrder: 0 }])
    assert.equal(result?.code, status === 'DRAFT' ? 'SessionCourseMismatch' : 'CoursePublished')
    assert.equal(writes, 0)
  })
  it('updates scoped sessions after checking all belong to the course', async () => {
    const writes: any[] = []
    const tx = { $queryRaw: async () => [], course: { findUnique: async () => ({ status: 'DRAFT' }) }, session: { findMany: async () => [{ id: ID }], update: async (args: any) => { writes.push(args) } } } as unknown as Prisma.TransactionClient
    assert.equal(await reorderCourseSessions(tx, 'course', [{ sessionId: ID, sortOrder: 2 }]), null)
    assert.deepEqual(writes, [{ where: { id: ID, course_id: 'course' }, data: { sort_order: 2 } }])
  })
})

function poolFixture(sizes: number[], count: number, attempts = 0) {
  const events: string[] = []
  const questions = sizes.flatMap((size, poolIndex) => Array.from({ length: size }, (_, i) => ({ id: `q${poolIndex}-${i}`, poolIndex })))
  const pools = sizes.map((_, i) => ({ name: `Pool ${i}` }))
  const tx = {
    $queryRaw: async () => { events.push('lock'); return [] },
    assessment: { findUnique: async () => ({ type: 'LESSON', question_count: count, lesson: { session: { course_id: 'course' } } }) },
    course: { findUnique: async () => ({ status: 'DRAFT' }) },
    attempt: { count: async () => { events.push('attempt-check'); return attempts } },
    question: { findMany: async () => { events.push('questions'); return questions }, updateMany: async () => { events.push('write') } },
    questionPool: { deleteMany: async () => { events.push('write') }, createMany: async () => { events.push('write') }, findMany: async () => pools.map((p, i) => ({ id: String(i), name: p.name, sort_order: i })) },
  } as unknown as Prisma.TransactionClient
  return { events, tx, pools, assignments: questions.map(q => ({ questionId: q.id, poolIndex: q.poolIndex })) }
}
describe('lesson pools under course lock', () => {
  for (const count of [1, 2, 5, 20]) it(`accepts ${count} pools`, async () => {
    const f = poolFixture(Array.from({ length: count }, () => 2), count)
    assert.equal((await updateLessonPools(f.tx, 'quiz', f.pools, f.assignments)).length, count)
    assert.ok(f.events.indexOf('lock') < f.events.indexOf('attempt-check'))
    assert.ok(f.events.indexOf('attempt-check') < f.events.indexOf('write'))
  })
  for (const [sizes, target, code] of [[[1, 4], 3, 'QuestionPoolQuotaExceeded'], [[2, 2], 1, 'QuestionPoolCountInvalid'], [[1, 0], 2, 'QuestionPoolIncomplete']] as [number[], number, string][]) it(`rejects ${code} without writes`, async () => {
    const f = poolFixture(sizes, target)
    await assert.rejects(updateLessonPools(f.tx, 'quiz', f.pools, f.assignments), (error: unknown) => error instanceof PoolUpdateError && error.code === code)
    assert.ok(!f.events.includes('write'))
  })
  it('rejects missing/duplicate/foreign question mappings', async () => {
    for (const assignments of [[], [{ questionId: 'foreign', poolIndex: 0 }], [{ questionId: 'q0-0', poolIndex: 0 }, { questionId: 'q0-0', poolIndex: 0 }]]) {
      const f = poolFixture([2], 1)
      await assert.rejects(updateLessonPools(f.tx, 'quiz', f.pools, assignments), (error: unknown) => error instanceof PoolUpdateError && error.status === 400)
      assert.ok(!f.events.includes('write'))
    }
  })
  it('observes an attempt after acquiring the same course lock as attempt creation', async () => {
    const f = poolFixture([2], 1, 1)
    await assert.rejects(updateLessonPools(f.tx, 'quiz', f.pools, f.assignments), (error: unknown) => error instanceof PoolUpdateError && error.code === 'AssessmentVersionRequired')
    assert.deepEqual(f.events, ['lock', 'attempt-check'])
  })
})
