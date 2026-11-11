import { it } from 'node:test'
import assert from 'node:assert/strict'
const stub = (name: string, exports: unknown) => { const filename = require.resolve(name); require.cache[filename] = { id: filename, filename, loaded: true, exports } as NodeJS.Module }
const chapter = { id: 'chapter-a' }
const rows = [
  { id: 'legacy', chapter_id: 'chapter-a', organization_unit_id: null, organization_unit: null },
  { id: 'department', chapter_id: null, organization_unit_id: 'ban-a', organization_unit: { type: 'DEPARTMENT', parent: { chapter } } },
  { id: 'chapter-unit', chapter_id: null, organization_unit_id: 'unit-a', organization_unit: { type: 'CHAPTER', chapter } },
  { id: 'other-chapter', chapter_id: 'chapter-b', organization_unit_id: null, organization_unit: null },
  { id: 'dna', chapter_id: null, organization_unit_id: 'dna', organization_unit: { type: 'DNA', chapter: null, parent: null } },
].map(row => ({ ...row, role: 'MEMBER', status: 'PENDING', email: `${row.id}@example.test` }))
function matches(row: any, where: any): boolean {
  return Object.entries(where).every(([key, value]: [string, any]) => key === 'OR' ? value.some((condition: any) => matches(row, condition))
    : value && typeof value === 'object' ? row?.[key] && matches(row[key], value) : row?.[key] === value)
}
stub('../lib/prisma', { prisma: { invitation: {
  updateMany: async () => {}, findMany: async ({ where }: any) => rows.filter(row => matches(row, where)), count: async ({ where }: any) => rows.filter(row => matches(row, where)).length,
} } })
stub('../lib/email', { sendInvitationEmail: async () => {} })
stub('../lib/learning-assignments', { reconcileLearningAssignmentsForUser: async () => {} })
const { getInvitations } = require('../lib/invitations')
it('Chapter list and count include legacy, Chapter-unit and department invitations without DNA or another Chapter', async () => {
  const result = await getInvitations({ actorId: 'lead', actorRole: 'LEAD', chapterId: 'chapter-a', page: 1, limit: 20 })
  assert.deepEqual(result.items.map((row: any) => row.id), ['legacy', 'department', 'chapter-unit'])
  assert.equal(result.totalItems, 3)
})
it('an unscoped manager sees no invitations', async () => {
  assert.deepEqual(await getInvitations({ actorId: 'lead', actorRole: 'LEAD', page: 1, limit: 20 }), { items: [], totalItems: 0, totalPages: 0 })
})
