import { it } from 'node:test'
import assert from 'node:assert/strict'
import { replaceChapterPlacements, normalizeTransferPlacements } from '../lib/chapter-placement-replacement'

it('replaces current and future placements, retaining history and unassigned Chapter members', async () => {
  const now = new Date('2026-11-11T00:00:00Z')
  const future = new Date('2027-01-01T00:00:00Z')
  const positions = [
    { id: 'current', unit_id: 'ban', starts_at: new Date('2026-01-01'), ends_at: future },
    { id: 'future', unit_id: 'chapter', starts_at: future, ends_at: null as Date | null },
  ]
  const memberships = [
    { id: 'future-ban', unit_id: 'ban', starts_at: future, ends_at: null as Date | null, status: 'ACTIVE' },
    { id: 'current-ban', unit_id: 'ban', starts_at: new Date('2026-01-01'), ends_at: future as Date | null, status: 'ACTIVE' },
  ]
  const created: any[] = []
  const tx: any = {
    positionAssignment: {
      findMany: async ({ where }: any) => {
        assert.deepEqual(where.unit_id.in, ['chapter', 'ban'])
        assert.deepEqual(where.OR, [{ ends_at: null }, { ends_at: { gt: now } }])
        return positions
      },
      update: async ({ where, data }: any) => Object.assign(positions.find(p => p.id === where.id)!, data),
      createMany: async ({ data }: any) => created.push(...data),
    },
    organizationMembership: {
      findMany: async ({ where }: any) => { assert.deepEqual(where.unit_id.in, ['ban']); return memberships },
      update: async ({ where, data }: any) => Object.assign(memberships.find(p => p.id === where.id)!, data),
      createMany: async () => {},
    },
    position: { upsert: async () => ({ id: 'department-member' }) },
  }
  await replaceChapterPlacements(tx, 'chapter', ['ban'], [
    { user_id: 'unassigned', department_unit_id: null, position_id: null, is_primary: false },
    { user_id: 'member', department_unit_id: 'ban', position_id: null, is_primary: false },
    { user_id: 'president', department_unit_id: null, position_id: 'president-position', is_primary: true },
  ], now, 'actor')
  assert.equal(positions[0].ends_at, now)
  assert.equal(positions[1].ends_at, future)
  assert.equal(memberships[0].ends_at, future)
  assert.equal(memberships[0].status, 'ENDED')
  assert.equal(memberships[1].ends_at, now)
  assert.equal(memberships[1].status, 'ENDED')
  assert.deepEqual(created.map(row => row.user_id), ['member', 'president'])
  assert.equal(created[0].position_id, 'department-member')
  assert.equal(created[1].unit_id, 'chapter')
})

it('normalizes legacy president units without turning unassigned transfer members into presidents', () => {
  assert.deepEqual(normalizeTransferPlacements([
    { departmentUnitId: 'legacy-president', positionId: null },
    { departmentUnitId: null, positionId: null },
    { departmentUnitId: 'ban', positionId: null },
  ], new Set(['legacy-president', 'chapter']), 'president'), [
    { departmentUnitId: null, positionId: 'president' },
    { departmentUnitId: null, positionId: null },
    { departmentUnitId: 'ban', positionId: null },
  ])
})
