import { it } from 'node:test'
import assert from 'node:assert/strict'

const now = new Date('2026-11-10T00:00:00Z')
function stub(name: string, exports: unknown) {
  const filename = require.resolve(name)
  require.cache[filename] = { id: filename, filename, loaded: true, exports } as NodeJS.Module
}
stub('../lib/learning-periods', { lockLearningUser: async () => now })
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

it('schedules replacement without ending the current membership prematurely', async () => {
  const f = fixture()
  const future = new Date('2026-12-01')
  await replaceUserPosition(f.tx, { userId: 'member', unitId: 'BND', positionId: 'position', startsAt: future })
  assert.equal(f.memberships.find(row => row.id === 'old-ban')!.status, 'ACTIVE')
  assert.equal(f.memberships.find(row => row.id === 'old-ban')!.ends_at, future)
  assert.equal(f.oldPositions[0].ends_at, future)
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
