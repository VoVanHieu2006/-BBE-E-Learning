import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { PrismaClient } from '@prisma/client'
import { enforceOverdueAssignments } from '../lib/deadline-enforcement'

const NOW = new Date('2026-05-20T10:00:00.000Z')

type Role = 'MEMBER' | 'ADMIN' | 'CHAPTER_LEADER'
interface FakeUser { id: string; role: Role; status: 'ACTIVE' | 'INACTIVE' | 'LOCKED'; lock_reason: string | null; leadPositions: string[] }
interface FakeAssignment { id: string; user_id: string; course_id: string; status: string; courseStatus: 'PUBLISHED' | 'DRAFT'; title: string }

/** In-memory double of exactly the Prisma calls the enforcer makes. */
function fakeDb(users: FakeUser[], assignments: FakeAssignment[]) {
  const restrictions: { user_id: string; source_reference: string; created_by_user_id: string | null }[] = []
  const userOf = (id: string) => users.find((row) => row.id === id)
  const eligible = (row: FakeAssignment, where: { status?: { in: string[] }; course?: { status: string }; id?: string | { gt: string } }) =>
    (!where.status || where.status.in.includes(row.status)) &&
    (!where.course || row.courseStatus === where.course.status) &&
    (typeof where.id === 'string' ? row.id === where.id : !where.id || row.id > where.id.gt)
  const tx = {
    userLearningAssignment: {
      findMany: async ({ where, take }: { where: any; take: number }) => assignments
        .filter((row) => eligible(row, where))
        .sort((a, b) => a.id.localeCompare(b.id))
        .slice(0, take)
        .map((row) => ({ id: row.id, user_id: row.user_id, course_id: row.course_id, course: { title: row.title }, user: { role: userOf(row.user_id)!.role, status: userOf(row.user_id)!.status } })),
      updateMany: async ({ where, data }: { where: any; data: { status: string } }) => {
        const rows = assignments.filter((row) => eligible(row, where))
        rows.forEach((row) => { row.status = data.status })
        return { count: rows.length }
      },
    },
    user: {
      findUnique: async ({ where }: { where: { id: string } }) => userOf(where.id) ?? null,
      updateMany: async ({ where, data }: { where: { id: string; role: { notIn: string[] }; status: string }; data: { status: 'LOCKED'; lock_reason: string } }) => {
        const user = userOf(where.id)
        if (!user || where.role.notIn.includes(user.role) || user.status !== where.status) return { count: 0 }
        user.status = data.status; user.lock_reason = data.lock_reason
        return { count: 1 }
      },
    },
    accessRestriction: {
      findFirst: async ({ where }: { where: { user_id: string; source_reference: string } }) => restrictions.find((row) => row.user_id === where.user_id && row.source_reference === where.source_reference) ?? null,
      create: async ({ data }: { data: { user_id: string; source_reference: string; created_by_user_id: string | null } }) => { restrictions.push(data); return {} },
    },
  }
  const db = {
    ...tx,
    positionAssignment: {
      findMany: async ({ where }: { where: { user_id: string } }) => (userOf(where.user_id)?.leadPositions ?? []).map((code) => ({ position: { code } })),
    },
    $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
  } as unknown as PrismaClient
  return { db, restrictions }
}

const member = (id: string, patch: Partial<FakeUser> = {}): FakeUser => ({ id, role: 'MEMBER', status: 'ACTIVE', lock_reason: null, leadPositions: [], ...patch })
const overdue = (id: string, user_id: string, patch: Partial<FakeAssignment> = {}): FakeAssignment => ({ id, user_id, course_id: `course-${id}`, status: 'ASSIGNED', courseStatus: 'PUBLISHED', title: `Khóa ${id}`, ...patch })

const run = (db: PrismaClient, extra: Partial<Parameters<typeof enforceOverdueAssignments>[0]> = {}) => {
  const invalidated: string[] = []
  return enforceOverdueAssignments({
    db, now: NOW, actorId: null,
    syncCompletion: async () => true,
    invalidateAuth: (id) => { invalidated.push(id) },
    ...extra,
  }).then((summary) => ({ summary, invalidated }))
}

describe('Overdue enforcement (KHBB 7.1)', () => {
  it('locks an ordinary overdue learner, marks the assignment OVERDUE and records a DEADLINE restriction', async () => {
    const users = [member('u1')]
    const assignments = [overdue('a1', 'u1')]
    const { db, restrictions } = fakeDb(users, assignments)
    const { summary, invalidated } = await run(db)
    assert.equal(users[0].status, 'LOCKED')
    assert.equal(users[0].lock_reason, 'OVERDUE_LOCK')
    assert.equal(assignments[0].status, 'OVERDUE')
    assert.deepEqual(restrictions.map((row) => row.source_reference), ['learning-assignment:a1'])
    assert.deepEqual(summary.lockedUsers, ['u1'])
    assert.deepEqual(invalidated, ['u1'])
    assert.equal(summary.processed, 1)
    assert.equal(summary.failed, 0)
  })

  it('never locks ADMIN, LEAD by role, LEAD by position, or an INACTIVE account, and leaves their assignments untouched', async () => {
    const users = [
      member('admin', { role: 'ADMIN' }),
      member('lead', { role: 'CHAPTER_LEADER' }),
      member('dna-lead', { leadPositions: ['DNA_LEAD'] }),
      member('chapter-manager', { leadPositions: ['CHAPTER_MANAGER'] }),
      member('inactive', { status: 'INACTIVE' }),
    ]
    const assignments = users.map((user, index) => overdue(`a${index}`, user.id))
    const { db, restrictions } = fakeDb(users, assignments)
    const { summary, invalidated } = await run(db)
    assert.deepEqual(users.map((user) => user.status), ['ACTIVE', 'ACTIVE', 'ACTIVE', 'ACTIVE', 'INACTIVE'], 'an INACTIVE account is not turned into LOCKED')
    assert.ok(assignments.every((row) => row.status === 'ASSIGNED'), 'no OVERDUE marker for exempt accounts')
    assert.equal(restrictions.length, 0)
    assert.equal(invalidated.length, 0)
    assert.deepEqual(summary.skipped, { ADMIN: 1, LEAD: 3, INACTIVE: 1, total: 5 })
    assert.equal(summary.processed, 0)
    assert.equal(summary.adminAssignmentsSkipped, 1)
    assert.deepEqual(summary.lockedUsers, [])
  })

  it('ignores an overdue assignment of a course that is no longer PUBLISHED', async () => {
    const users = [member('u1')]
    const assignments = [overdue('a1', 'u1', { courseStatus: 'DRAFT' })]
    const { db, restrictions } = fakeDb(users, assignments)
    const { summary } = await run(db)
    assert.equal(users[0].status, 'ACTIVE')
    assert.equal(assignments[0].status, 'ASSIGNED')
    assert.equal(restrictions.length, 0)
    assert.equal(summary.evaluated, 0)
  })

  it('locks on the published course only when a learner has both a draft and a published overdue course', async () => {
    const users = [member('u1')]
    const assignments = [overdue('a1', 'u1', { courseStatus: 'DRAFT' }), overdue('a2', 'u1')]
    const { db, restrictions } = fakeDb(users, assignments)
    await run(db)
    assert.equal(users[0].status, 'LOCKED')
    assert.deepEqual(restrictions.map((row) => row.source_reference), ['learning-assignment:a2'])
  })

  it('does not overwrite the lock reason of an account that is already locked for another cause, but still records DEADLINE', async () => {
    const users = [member('u1', { status: 'LOCKED', lock_reason: 'PASSWORD_LOCK' })]
    const { db, restrictions } = fakeDb(users, [overdue('a1', 'u1')])
    await run(db)
    assert.equal(users[0].lock_reason, 'PASSWORD_LOCK')
    assert.equal(restrictions.length, 1)
  })

  it('one learner failing does not stop the run; the failure is counted and reported', async () => {
    const users = [member('u1'), member('bad'), member('u3')]
    const assignments = [overdue('a1', 'u1'), overdue('a2', 'bad'), overdue('a3', 'u3')]
    const { db } = fakeDb(users, assignments)
    const { summary } = await run(db, {
      syncCompletion: async (userId) => { if (userId === 'bad') throw new Error('sync exploded') },
    })
    assert.equal(summary.failed, 1)
    assert.equal(summary.processed, 2)
    assert.deepEqual(summary.errors, [{ assignmentId: 'a2', message: 'sync exploded' }])
    assert.deepEqual(users.map((user) => user.status), ['LOCKED', 'ACTIVE', 'LOCKED'])
  })

  it('works through several batches and visits exempt rows only once', async () => {
    const users = [member('admin', { role: 'ADMIN' }), ...Array.from({ length: 7 }, (_, i) => member(`u${i}`))]
    const assignments = users.map((user, index) => overdue(`a${String(index).padStart(2, '0')}`, user.id))
    const { db } = fakeDb(users, assignments)
    const { summary } = await run(db, { batchSize: 3 })
    assert.equal(summary.evaluated, 8)
    assert.equal(summary.processed, 7)
    assert.equal(summary.skipped.ADMIN, 1)
    assert.equal(summary.lockedUsers.length, 7)
  })

  it('does not lock when the learner completed the course between the scan and the transition', async () => {
    const users = [member('u1')]
    const assignments = [overdue('a1', 'u1')]
    const { db } = fakeDb(users, assignments)
    const { summary } = await run(db, { syncCompletion: async () => { assignments[0].status = 'COMPLETED' } })
    assert.equal(users[0].status, 'ACTIVE')
    assert.equal(summary.unchanged, 1)
    assert.equal(summary.processed, 0)
  })
})
