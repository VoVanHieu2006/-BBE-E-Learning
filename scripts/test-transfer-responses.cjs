const assert = require('node:assert/strict')
const path = require('node:path')
const { test } = require('node:test')
require('ts-node').register({ project: 'tsconfig.test.json' })
const Module = require('node:module'), resolve = Module._resolveFilename
Module._resolveFilename = function (name, ...args) { return resolve.call(this, name.startsWith('@/') ? path.resolve('src', name.slice(2)) : name, ...args) }
const stub = (file, exports) => { const id = require.resolve(file); require.cache[id] = { id, filename: id, loaded: true, exports } }
stub('../src/lib/auth', { authenticate: async () => ({ ok: true, context: { userId: 'admin', role: 'ADMIN' } }) })
stub('../src/lib/authorization', { canAccessChapterPermission: async () => true })
stub('../src/lib/learning-assignments', { getOrganizationUnitTreeIds: async () => ['chapter-unit', 'department'] })
stub('../src/lib/learning-periods', { activeLearningPolicy: async () => null })
stub('../src/lib/chapter-reorganizations', { applyDueChapterReorganizations: async () => 0 })
const db = {
  chapter: { findUnique: async () => ({ organization_unit_id: 'chapter-unit' }) },
  position: { upsert: async () => ({ id: 'president' }), findMany: async () => [] },
  organizationUnit: { findMany: async ({ where }) => where.name ? [] : [{ id: 'department', type: 'DEPARTMENT', name: 'Ban' }] },
  chapterMember: { count: async () => 1 },
  chapterReorganization: { findFirst: async () => null, count: async () => 0, create: async () => ({ id: 'batch' }), findUnique: async () => ({ id: 'batch', status: 'SCHEDULED', last_error: 'TransferDepartmentScopeChanged' }) },
  $queryRaw: async () => [],
}
db.$transaction = async fn => fn(db)
global.prisma = db
const { POST } = require('../src/app/api/v1/chapters/[chapterId]/reorganizations/route')
test('immediate application failure returns error and retained batch, never HTTP success', async () => {
  const response = await POST({ json: async () => ({ effectiveAt: new Date().toISOString(), termNumber: 2, items: [{ userId: 'member', departmentUnitId: 'department' }] }) }, { params: { chapterId: 'chapter' } })
  assert.equal(response.status, 409)
  const body = await response.json()
  assert.equal(body.error.code, 'TransferApplyFailed')
  assert.equal(body.item.status, 'SCHEDULED')
})
const batchRoute = require('../src/app/api/v1/chapters/[chapterId]/reorganizations/[batchId]/route')
test('retry of an already applied batch is successful without a second application', async () => {
  db.chapterReorganization.findFirst = async () => ({ id: 'batch', status: 'APPLIED' })
  const response = await batchRoute.POST({}, { params: { chapterId: 'chapter', batchId: 'batch' } })
  assert.equal(response.status, 200)
  assert.equal((await response.json()).appliedImmediately, true)
})
test('cancellation losing a race with application reports conflict, not success', async () => {
  db.chapterReorganization.findFirst = async () => ({ id: 'batch', status: 'SCHEDULED' })
  db.chapterReorganization.updateMany = async () => ({ count: 0 })
  assert.equal((await batchRoute.DELETE({}, { params: { chapterId: 'chapter', batchId: 'batch' } })).status, 409)
  db.chapterReorganization.updateMany = async () => ({ count: 1 })
  assert.equal((await batchRoute.DELETE({}, { params: { chapterId: 'chapter', batchId: 'batch' } })).status, 200)
})
