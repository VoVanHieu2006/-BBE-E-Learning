import { it } from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
const stub = (name: string, exports: unknown) => { const filename = require.resolve(name); require.cache[filename] = { id: filename, filename, loaded: true, exports } as NodeJS.Module }
const rows = [
  { user: { id: 'trainee', display_name: 'TT' }, unit: { id: 'parent', type: 'DNA', code: 'DNA', name: 'DNA' } },
  { user: { id: 'trainee', display_name: 'TT' }, unit: { id: 'tt', type: 'DNA_GROUP', code: 'TT', name: 'TT' } },
  { user: { id: 'learner', display_name: 'SGDC' }, unit: { id: 'sgdc', type: 'DNA_GROUP', code: 'SGDC', name: 'SGDC' } },
]
stub('../lib/auth', { authenticate: async () => ({ ok: true, context: { userId: 'lead', role: 'LEAD' } }) })
stub('../lib/manager-learning-access', { getLearningManagerKind: async () => 'LEAD_DNA' })
stub('../lib/authorization', { listManagedOrganizationUnits: async () => rows.map(row => ({ id: row.unit.id, type: row.unit.type })) })
stub('../lib/prisma', { prisma: {
  organizationMembership: { findMany: async () => rows },
  positionAssignment: { findMany: async ({ where }: any) => {
    assert.equal(where.position.code, 'DNA_MEMBER')
    assert.equal(where.unit.type, 'DNA_GROUP')
    assert.equal(where.user.role, 'MEMBER')
    assert.ok(where.starts_at.lte instanceof Date)
    return rows.filter(row => where.unit_id.in.includes(row.unit.id) && row.unit.type === where.unit.type && row.unit.code !== where.unit.code.not)
  } },
  starLedger: { findMany: async ({ where }: any) => { assert.deepEqual(where.user_id.in, ['learner']); return [{ user_id: 'learner', amount: 7, awarded_at: new Date('2026-01-01') }] } },
} })
const { GET } = require('../app/api/v1/organization/dna-leaderboard/route')
it('uses canonical DNA_MEMBER group placements, excluding TT even when its parent DNA membership remains', async () => {
  const response = await GET(new NextRequest('http://localhost/api/v1/organization/dna-leaderboard'))
  const result = await response.json()
  assert.equal(result.totalCount, 1)
  assert.deepEqual(result.items.map((row: any) => [row.userId, row.groupName, row.stars, row.rank]), [['learner', 'SGDC', 7, 1]])
})
