import { it } from 'node:test'
import assert from 'node:assert/strict'
import { learningTargetsForUser } from '../lib/learning-targets'
import { LEARNING_TARGETS } from '../lib/learning-catalog'

function stub(name: string, exports: unknown) {
  const filename = require.resolve(name)
  require.cache[filename] = { id: filename, filename, loaded: true, exports } as NodeJS.Module
}
const now = new Date('2026-11-10')
let otherRestriction = false
stub('../lib/account-restrictions', { hasActiveAccountRestrictions: async () => otherRestriction })
stub('../lib/learning-periods', { lockLearningUser: async () => now, learningContext: () => { throw new Error('Managers must not initialize a learning cycle') } })
const { reconcileLearningAssignmentsForUser } = require('../lib/learning-assignments')

it('all 18 canonical positions resolve to exactly their one learning group', async () => {
  for (const target of LEARNING_TARGETS) {
    const tx: any = {
      user: { findUnique: async () => ({ role: 'MEMBER' }) },
      positionAssignment: { findMany: async () => [{ position: { code: target.position_code }, unit: { code: target.department_code || target.dna_unit_code, type: target.department_code ? 'DEPARTMENT' : target.dna_unit_code ? 'DNA_GROUP' : 'CHAPTER' } }] },
    }
    assert.deepEqual(Array.from(await learningTargetsForUser(tx, 'member', now)), [target.code])
  }
})

it('ADMIN and LEAD have no targets even if obsolete memberships remain', async () => {
  for (const role of ['ADMIN', 'LEAD']) {
    const tx: any = { user: { findUnique: async () => ({ role }) } }
    assert.deepEqual(Array.from(await learningTargetsForUser(tx, 'manager', now)), [])
  }
})

it('fails closed on multiple active positions instead of granting multiple targets', async () => {
  const tx: any = { user: { findUnique: async () => ({ role: 'MEMBER' }) }, positionAssignment: { findMany: async () => [{}, {}] } }
  await assert.rejects(learningTargetsForUser(tx, 'member', now), /SinglePositionRequired/)
})

for (const role of ['ADMIN', 'LEAD']) it(`${role} ends existing assignments without initializing a cycle or replacing other locks`, async () => {
  for (const scenario of [
    { status: 'LOCKED', reason: 'OVERDUE_LOCK', restricted: false, expected: 'ACTIVE' },
    { status: 'LOCKED', reason: 'OVERDUE_LOCK', restricted: true, expected: 'LOCKED' },
    { status: 'LOCKED', reason: 'PASSWORD_LOCK', restricted: false, expected: 'LOCKED' },
    { status: 'INACTIVE', reason: null, restricted: false, expected: 'INACTIVE' },
  ]) {
    otherRestriction = scenario.restricted
    const user = { role, status: scenario.status, lock_reason: scenario.reason }
    const assignments = [{ completed_at: null, ended_at: null as Date | null, mandatory: true, status: 'OVERDUE' }, { completed_at: now, ended_at: null as Date | null, mandatory: true, status: 'COMPLETED' }]
    let lifted = false
    const tx: any = {
      user: { findUniqueOrThrow: async () => user, updateMany: async ({ where, data }: any) => { if (user.status === where.status && where.lock_reason.in.includes(user.lock_reason)) Object.assign(user, data) } },
      userLearningAssignment: { updateMany: async ({ where, data }: any) => {
        const rows = assignments.filter(row => !row.ended_at && (where.completed_at === null ? !row.completed_at : !!row.completed_at))
        rows.forEach(row => Object.assign(row, data)); return { count: rows.length }
      } },
      supplementalLearningRequirement: { updateMany: async () => ({ count: 0 }) },
      learningPath: { updateMany: async ({ data }: any) => assert.equal(data.due_at, null) },
      accessRestriction: { updateMany: async ({ where }: any) => { assert.equal(where.type, 'DEADLINE'); lifted = true } },
    }
    assert.deepEqual(await reconcileLearningAssignmentsForUser('manager', tx), { created: 0, ended: 2 })
    assert.equal(lifted, true)
    assert.equal(user.status, scenario.expected)
    assert.equal(assignments[1].status, 'COMPLETED')
    assert.equal(assignments.every(row => row.ended_at === now && !row.mandatory), true)
  }
})
