import { it } from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
const stub = (name: string, exports: unknown) => { const filename = require.resolve(name); require.cache[filename] = { id: filename, filename, loaded: true, exports } as NodeJS.Module }
let query: any
const created: string[] = []
const people = [
  { id: 'admin', role: 'ADMIN', status: 'ACTIVE' }, { id: 'lead', role: 'LEAD', status: 'ACTIVE' },
  { id: 'member', role: 'MEMBER', status: 'ACTIVE' }, { id: 'wrong-target', role: 'MEMBER', status: 'ACTIVE' },
  { id: 'unassigned', role: 'MEMBER', status: 'ACTIVE' }, { id: 'inactive', role: 'MEMBER', status: 'INACTIVE' },
]
stub('../lib/auth', { authenticate: async () => ({ ok: true, context: { role: 'ADMIN' } }) })
stub('../lib/learning-assignments', { getOrganizationUnitTreeIds: async () => [] })
stub('../lib/learning-targets', { learningTargetsForUser: async (_tx: unknown, id: string) => new Set(id === 'unassigned' ? [] : [id === 'wrong-target' ? 'DNA_MEMBER_TT' : 'DEPARTMENT_MEMBER_BTV']) })
stub('../lib/prisma', { prisma: {
  learningRule: { findUnique: async () => ({ id: 'rule', course_id: 'course', effective_from: new Date('2020-01-01'), target_code: 'DEPARTMENT_MEMBER_BTV' }) },
  user: { findMany: async ({ where }: any) => { query = where; return people.filter(p => p.status === where.status && (!where.role || p.role === where.role)) } },
  userLearningAssignment: { findFirst: async () => null, create: async ({ data }: any) => created.push(data.user_id) },
} })
const { POST } = require('../app/api/v1/admin/learning-rules/[ruleId]/materialize/route')
it('materializes only eligible MEMBERs matching the target, excluding managers and unassigned accounts', async () => {
  const response = await POST(new NextRequest('http://localhost/api/v1/admin/learning-rules/x/materialize', { method: 'POST', body: '{}' }), { params: { ruleId: '00000000-0000-4000-8000-000000000001' } })
  assert.equal(response.status, 200)
  assert.equal(query.role, 'MEMBER')
  assert.deepEqual(created, ['member'])
  assert.equal((await response.json()).eligibleUsers, 1)
})
