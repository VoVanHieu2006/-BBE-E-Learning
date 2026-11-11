import { it } from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
const stub = (name: string, exports: unknown) => { const filename = require.resolve(name); require.cache[filename] = { id: filename, filename, loaded: true, exports } as NodeJS.Module }
stub('../lib/auth', { authenticate: async () => ({ ok: true, context: { userId: 'admin', role: 'ADMIN' } }) })
stub('../lib/authorization', { canAccessChapterPermission: async () => false })
stub('../lib/learning-assignments', { getOrganizationUnitTreeIds: async () => [] })
stub('../lib/chapter-reorganizations', { applyDueChapterReorganizations: async () => {} })
stub('../lib/prisma', { prisma: {
  chapterReorganization: { findMany: async () => [{ effective_at: new Date(), applied_at: new Date(), items: [
    { user_id: 'president', department_unit_id: null, position_id: 'president-position' },
    { user_id: 'unassigned', department_unit_id: null, position_id: null },
  ] }] },
  user: { findMany: async () => [{ id: 'president', display_name: 'President' }, { id: 'unassigned', display_name: 'Unassigned' }] },
} })
const { GET } = require('../app/api/v1/chapters/[chapterId]/reorganizations/route')
it('history distinguishes a PRESIDENT from a Chapter member without a department or position', async () => {
  const response = await GET(new NextRequest('http://localhost/api/v1/chapters/chapter/reorganizations'), { params: { chapterId: 'chapter' } })
  const result = await response.json()
  assert.deepEqual(result.items[0].items.map((row: any) => row.departmentName), ['Chủ Tịch', 'Chưa phân ban'])
})
