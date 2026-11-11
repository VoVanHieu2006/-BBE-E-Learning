import { it } from 'node:test'
import assert from 'node:assert/strict'

const now = new Date('2026-11-10T00:00:00Z')
function stub(name: string, exports: unknown) {
  const filename = require.resolve(name)
  require.cache[filename] = { id: filename, filename, loaded: true, exports } as NodeJS.Module
}
const syncUsers: string[] = []
const locks: string[] = []
stub('../lib/learning-periods', { lockLearningUser: async (_tx: unknown, userId: string) => { locks.push(`user:${userId}`); return now }, enqueueAssignmentSync: async (_tx: unknown, userId: string) => { syncUsers.push(userId) } })
stub('../lib/organization-transition', { prepareOrganizationTransition: async () => now })
const { replaceUserPosition, replacementEnd } = require('../lib/position-replacement')

function fixture(role = 'MEMBER', code = 'DEPARTMENT_MEMBER') {
  const events: string[] = []
  const oldPositions = [{ id: 'old', starts_at: new Date('2026-01-01'), ends_at: null as Date | null }, { id: 'future', starts_at: new Date('2027-01-01'), ends_at: null as Date | null }]
  const memberships = [
    { id: 'parent', unit_id: 'chapter', starts_at: new Date('2026-01-01'), ends_at: null, status: 'ACTIVE' },
    { id: 'old-ban', unit_id: 'BTV', starts_at: new Date('2026-01-01'), ends_at: null as Date | null, status: 'ACTIVE' },
  ]
  const tx: any = {
    user: { findUniqueOrThrow: async () => ({ role }), update: async () => events.push('version') },
    position: { findUniqueOrThrow: async () => ({ id: 'position', code, scope: 'DEPARTMENT' }) },
    organizationUnit: { findUniqueOrThrow: async () => ({ id: 'BND', parent_id: 'chapter', type: 'DEPARTMENT', status: 'ACTIVE' }), findUnique: async () => ({ parent_id: null }) },
    positionAssignment: {
      findMany: async () => oldPositions,
      update: async ({ where, data }: any) => { Object.assign(oldPositions.find(row => row.id === where.id)!, data); events.push('end') },
      create: async ({ data }: any) => { events.push('create'); return data },
    },
    organizationMembership: {
      findMany: async () => memberships,
      update: async ({ where, data }: any) => Object.assign(memberships.find(row => row.id === where.id)!, data),
      create: async ({ data }: any) => { memberships.push({ id: 'new', status: 'ACTIVE', ...data }) },
    },
  }
  return { tx, oldPositions, memberships, events }
}

it('replaces the previous ban and position, preserving the parent and history', async () => {
  const f = fixture()
  const result = await replaceUserPosition(f.tx, { userId: 'member', unitId: 'BND', positionId: 'position' })
  assert.equal(result.unit_id, 'BND')
  assert.deepEqual(f.events, ['end', 'end', 'create', 'version'])
  assert.equal(f.oldPositions[0].ends_at, now)
  assert.equal(f.oldPositions[1].ends_at, f.oldPositions[1].starts_at)
  assert.equal(f.memberships.find(row => row.id === 'parent')!.ends_at, null)
  assert.equal(f.memberships.find(row => row.id === 'old-ban')!.status, 'ENDED')
  assert.equal(f.memberships.filter(row => row.status === 'ACTIVE' && row.unit_id !== 'chapter').length, 1)
})

it('rejects future appointments before changing positions or memberships', async () => {
  const f = fixture()
  const future = new Date('2026-12-01')
  await assert.rejects(replaceUserPosition(f.tx, { userId: 'member', unitId: 'BND', positionId: 'position', startsAt: future }), { code: 'FutureAppointmentNotAllowed' })
  assert.equal(f.memberships.find(row => row.id === 'old-ban')!.status, 'ACTIVE')
  assert.equal(f.memberships.find(row => row.id === 'old-ban')!.ends_at, null)
  assert.deepEqual(f.events, [])
})

it('cancels a future membership in the target ban before creating the current membership', async () => {
  const f = fixture()
  const future = new Date('2027-01-01')
  f.memberships.push({ id: 'target-future', unit_id: 'BND', starts_at: future, ends_at: null, status: 'ACTIVE' })
  await replaceUserPosition(f.tx, { userId: 'member', unitId: 'BND', positionId: 'position' })
  const cancelled = f.memberships.find(row => row.id === 'target-future')!
  assert.equal(cancelled.status, 'ENDED')
  assert.equal(cancelled.ends_at, future)
  assert.equal(f.memberships.filter(row => row.status === 'ACTIVE' && row.unit_id === 'BND').length, 1)
})

it('rejects MEMBER to LEAD before ending any prior assignment', async () => {
  const f = fixture('MEMBER', 'CHAPTER_LEAD')
  await assert.rejects(replaceUserPosition(f.tx, { userId: 'member', unitId: 'BND', positionId: 'position' }), { code: 'PositionRoleMismatch' })
  assert.deepEqual(f.events, [])
})

it('never creates negative intervals when cancelling future appointments', () => {
  const future = new Date('2027-01-01')
  assert.equal(replacementEnd(future, now), future)
  assert.equal(replacementEnd(new Date('2026-01-01'), now), now)
})

it('replaces the Chapter PRESIDENT and syncs the displaced president without removing Chapter affiliation', async () => {
  const f = fixture('MEMBER', 'PRESIDENT')
  const incumbent = { id: 'incumbent', user_id: 'old-president', starts_at: new Date('2026-01-01'), ends_at: null as Date | null }
  let chapterLocked = false
  f.tx.$queryRaw = async () => { locks.push('chapter'); chapterLocked = true; return [] }
  f.tx.position.findUniqueOrThrow = async () => ({ id: 'president-position', code: 'PRESIDENT', scope: 'CHAPTER' })
  f.tx.organizationUnit.findUniqueOrThrow = async () => ({ id: 'chapter', type: 'CHAPTER', parent_id: null, status: 'ACTIVE' })
  const update = f.tx.positionAssignment.update
  f.tx.positionAssignment.findMany = async ({ where }: any) => {
    if (where.position?.code === 'PRESIDENT') { assert.equal(chapterLocked, true); return [incumbent] }
    return f.oldPositions
  }
  f.tx.positionAssignment.update = async (args: any) => args.where.id === incumbent.id ? Object.assign(incumbent, args.data) : update(args)
  syncUsers.length = 0
  locks.length = 0
  await replaceUserPosition(f.tx, { userId: 'member', unitId: 'chapter', positionId: 'president-position' })
  assert.equal(incumbent.ends_at, now)
  assert.deepEqual(syncUsers, ['old-president'])
  assert.deepEqual(locks.slice(0, 3), ['chapter', 'user:member', 'user:old-president'])
  assert.equal(f.memberships.find(row => row.id === 'parent')!.ends_at, null)
  assert.equal(f.memberships.filter(row => row.status === 'ACTIVE' && row.unit_id !== 'chapter').length, 0)
})

it('accepts DNA_MEMBER only at a DNA_GROUP and rejects the parent DNA before mutation', async () => {
  for (const type of ['DNA', 'DNA_GROUP']) {
    const f = fixture('MEMBER', 'DNA_MEMBER')
    f.tx.position.findUniqueOrThrow = async () => ({ id: 'dna-member', code: 'DNA_MEMBER', scope: 'DNA' })
    f.tx.organizationUnit.findUniqueOrThrow = async () => ({ id: 'group', parent_id: 'dna', type, status: 'ACTIVE' })
    if (type === 'DNA') {
      await assert.rejects(replaceUserPosition(f.tx, { userId: 'member', unitId: 'group', positionId: 'dna-member' }), { code: 'PositionScopeMismatch' })
      assert.deepEqual(f.events, [])
    } else {
      const assignment = await replaceUserPosition(f.tx, { userId: 'member', unitId: 'group', positionId: 'dna-member' })
      assert.equal(assignment.unit_id, 'group')
      assert.equal(assignment.starts_at, now)
      assert.equal(f.memberships.find(row => row.id === 'parent')!.status, 'ENDED')
    }
  }
})

it('keeps an existing current membership in the selected ban without appending a duplicate', async () => {
  const f = fixture()
  f.memberships.push({ id: 'target-current', unit_id: 'BND', starts_at: new Date('2026-01-01'), ends_at: null, status: 'ACTIVE' })
  await replaceUserPosition(f.tx, { userId: 'member', unitId: 'BND', positionId: 'position' })
  assert.equal(f.memberships.filter(row => row.unit_id === 'BND').length, 1)
  assert.equal(f.memberships.find(row => row.id === 'target-current')!.status, 'ACTIVE')
})
