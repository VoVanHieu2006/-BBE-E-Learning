import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'

const courseId = '00000000-0000-4000-8000-000000000001'
const now = new Date('2026-11-10T08:00:00Z')
const content = { title: 'Khóa học', description: null, visibility: 'PRIVATE', sessions: [{ id: '00000000-0000-4000-8000-000000000002', title: 'Buổi học', lessons: [{ id: '00000000-0000-4000-8000-000000000003', title: 'Bài học', video: null, assessment: null, documents: [] }] }], finalAssessment: null }
let role = 'ADMIN', version = 4, draft: any = null, status = 'PUBLISHED'
let visibility = 'PRIVATE', documents: any[] = []
let events: string[] = [], publishes = 0, applied = 0
const course = () => ({ id: courseId, content_version: version, status, visibility, title: 'Khóa học', description: null, final_assessment: null,
  sessions: [{ id: content.sessions[0].id, title: 'Buổi học', lessons: [{ id: content.sessions[0].lessons[0].id, title: 'Bài học', video: null, assessment: null, documents }] }], draft })
const tx: any = {
  $queryRaw: async (strings: TemplateStringsArray) => { const sql = strings.join(''); if (sql.includes('courses')) events.push('course-lock'); return [{ now }] },
  course: { findUnique: async () => course(), update: async ({ data }: any) => {
    if (typeof data.content_version === 'number') version = data.content_version
    else if (data.content_version?.increment) version += data.content_version.increment
    status = data.status ?? status; visibility = data.visibility ?? visibility
    return course()
  } },
  attempt: { count: async () => 0 }, lessonProgress: { findMany: async () => [] },
  userLearningAssignment: { findMany: async () => [{ user_id: 'u1' }, { user_id: 'u1' }, { user_id: 'u2' }] },
  courseDraft: {
    findUnique: async () => draft,
    create: async ({ data }: any) => { draft = { id: 'draft-1', ...data }; return draft },
    update: async ({ data }: any) => { draft = { ...draft, content: data.content, draft_version: draft.draft_version + 1 }; return draft },
    delete: async () => { events.push('delete-draft'); draft = null },
  },
  auditLog: { create: async () => { events.push('audit') } },
}
let queue = Promise.resolve()
const prisma = { course: tx.course, attempt: tx.attempt, lessonProgress: tx.lessonProgress, $transaction: (fn: any) => {
  const result = queue.then(() => fn(tx))
  queue = result.then(() => { events.push('commit') }, () => {})
  return result
} }
// Scope route dependencies to deterministic in-memory collaborators, before loading handlers.
const stub = (path: string, exports: unknown) => { const resolved = require.resolve(path); require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports } as NodeModule }
stub('../lib/auth', { authenticate: async () => ({ ok: true, context: { userId: 'admin', role } }) })
stub('../lib/prisma', { prisma })
stub('../lib/server-cache', { invalidateCoursesServerCache: () => {} })
stub('../lib/progress/calculator', { invalidateSystemDataCache: () => {} })
stub('../lib/course-status-outbox', { enqueueCourseStatusReconcile: async () => {} })
stub('../lib/course-edit-guard', { invalidateCourseContentCaches: (id: string) => { assert.equal(id, courseId); events.push('cache') } })
stub('../lib/apply-course-draft', { applyCourseDraft: async () => { applied++; events.push('apply') } })
stub('../lib/course-requirements', {
  executePublishCourseRequirements: async () => { publishes++; events.push('requirements'); return course() },
  publishCourseRequirements: async () => { status = 'PUBLISHED'; return course() }, // unchanged requirement fingerprint on republish
})
stub('../lib/learning-periods', { lockLearningUser: async (_tx: unknown, id: string) => { events.push(`user-${id}`) }, lockCompetitionScope: async () => ({ now }) })
const publish = require('../app/api/v1/courses/[courseId]/draft/publish/route') as typeof import('../app/api/v1/courses/[courseId]/draft/publish/route')
const drafts = require('../app/api/v1/courses/[courseId]/draft/route') as typeof import('../app/api/v1/courses/[courseId]/draft/route')
const courses = require('../app/api/v1/courses/[courseId]/route') as typeof import('../app/api/v1/courses/[courseId]/route')
const unpublish = require('../app/api/v1/courses/[courseId]/unpublish/route') as typeof import('../app/api/v1/courses/[courseId]/unpublish/route')
const republish = require('../app/api/v1/courses/[courseId]/publish/route') as typeof import('../app/api/v1/courses/[courseId]/publish/route')

const request = (method: string, body: unknown) => new NextRequest(`http://localhost/api/v1/courses/${courseId}/draft`, { method, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })
const params = { params: { courseId } }
function reset(withDraft = true) {
  role = 'ADMIN'; status = 'PUBLISHED'; version = 4; events = []; applied = 0; publishes = 0; queue = Promise.resolve()
  visibility = 'PRIVATE'; documents = []
  draft = withDraft ? { id: 'draft-1', course_id: courseId, draft_version: 2, base_content_version: 4, content } : null
}

describe('course draft route concurrency and atomic publish', () => {
  it('visibility PATCH invalidates an older draft for save and publish', async () => {
    reset()
    assert.equal((await courses.PATCH(request('PATCH', { visibility: 'PUBLIC' }), params)).status, 200)
    assert.equal(version, 5)
    const saved = await drafts.PUT(request('PUT', { content, expectedDraftId: 'draft-1', expectedDraftVersion: 2, baseContentVersion: 4 }), params)
    const published = await publish.POST(request('POST', { expectedDraftId: 'draft-1', expectedDraftVersion: 2 }), params)
    for (const response of [saved, published]) {
      assert.equal(response.status, 409)
      assert.equal((await response.json()).error.code, 'ConcurrencyConflict')
    }
    assert.equal(visibility, 'PUBLIC'); assert.equal(applied, 0)
  })
  it('unpublish and republish leave the earlier draft stale', async () => {
    reset()
    assert.equal((await unpublish.POST(request('POST', {}), params)).status, 200)
    assert.equal(version, 5)
    assert.equal((await republish.POST(request('POST', {}), params)).status, 200)
    const saved = await drafts.PUT(request('PUT', { content, expectedDraftId: 'draft-1', expectedDraftVersion: 2, baseContentVersion: 4 }), params)
    const published = await publish.POST(request('POST', { expectedDraftId: 'draft-1', expectedDraftVersion: 2 }), params)
    for (const response of [saved, published]) {
      assert.equal(response.status, 409)
      assert.equal((await response.json()).error.code, 'ConcurrencyConflict')
    }
    assert.equal(applied, 0); assert.equal(publishes, 0)
  })
  it('loads, saves and publishes unchanged legacy documents but rejects edited oversized documents', async () => {
    reset()
    documents = [{ id: '00000000-0000-4000-8000-000000000009', file_name: 'legacy.pdf', storage_key: 'docs/legacy', mime_type: 'application/pdf', file_size: BigInt(101 * 1024 * 1024) }]
    draft.content = structuredClone(content)
    draft.content.sessions[0].lessons[0].documents = [{ id: documents[0].id, fileName: 'legacy.pdf', storageKey: 'docs/legacy', mimeType: 'application/pdf', fileSize: 101 * 1024 * 1024 }]
    const loaded = await drafts.GET(request('GET', undefined), params)
    assert.equal((await loaded.json()).draftError, null)
    const edited = structuredClone(draft.content)
    edited.sessions[0].lessons[0].documents[0].fileName = 'renamed.pdf'
    assert.equal((await drafts.PUT(request('PUT', { content: edited, expectedDraftId: 'draft-1', expectedDraftVersion: 2, baseContentVersion: 4 }), params)).status, 400)
    const saved = await drafts.PUT(request('PUT', { content: draft.content, expectedDraftId: 'draft-1', expectedDraftVersion: 2, baseContentVersion: 4 }), params)
    assert.equal(saved.status, 200)
    const published = await publish.POST(request('POST', { expectedDraftId: 'draft-1', expectedDraftVersion: 3 }), params)
    assert.equal(published.status, 200); assert.equal(applied, 1)
  })
  it('applies once, publishes requirements once, advances metadata OCC and invalidates after commit', async () => {
    reset()
    const response = await publish.POST(request('POST', { expectedDraftId: 'draft-1', expectedDraftVersion: 2 }), params)
    assert.equal(response.status, 200)
    assert.equal(applied, 1); assert.equal(publishes, 1); assert.equal(version, 5); assert.equal(draft, null)
    assert.ok(events.indexOf('user-u2') < events.indexOf('course-lock'))
    assert.equal(events.filter(e => e === 'user-u1').length, 1)
    assert.ok(events.indexOf('requirements') < events.indexOf('delete-draft'))
    assert.ok(events.indexOf('commit') < events.indexOf('cache'))
  })
  it('rejects stale versions or replacement drafts before content writes', async () => {
    for (const body of [{ expectedDraftId: 'draft-1', expectedDraftVersion: 1 }, { expectedDraftId: 'old-draft', expectedDraftVersion: 2 }]) {
      reset()
      const response = await publish.POST(request('POST', body), params)
      assert.equal(response.status, 409)
      assert.equal((await response.json()).error.code, 'ConcurrencyConflict')
      assert.equal(applied, 0); assert.equal(publishes, 0); assert.ok(!events.includes('cache'))
    }
  })
  it('two admins saving the first draft cannot overwrite each other', async () => {
    reset(false)
    const body = { content, expectedDraftId: null, expectedDraftVersion: 0, baseContentVersion: 4 }
    const results = await Promise.all([drafts.PUT(request('PUT', body), params), drafts.PUT(request('PUT', body), params)])
    assert.deepEqual(results.map(r => r.status), [200, 409])
    assert.equal(draft.draft_version, 1)
  })
  it('save and discard require the current draft version and identity', async () => {
    reset()
    const stale = await drafts.DELETE(request('DELETE', { expectedDraftId: 'draft-1', expectedDraftVersion: 1, baseContentVersion: 4 }), params)
    assert.equal(stale.status, 409); assert.ok(draft)
    const saved = await drafts.PUT(request('PUT', { content: { ...content, title: 'Đổi tên' }, expectedDraftId: 'draft-1', expectedDraftVersion: 2, baseContentVersion: 4 }), params)
    assert.equal(saved.status, 200); assert.equal(draft.draft_version, 3)
    const removed = await drafts.DELETE(request('DELETE', { expectedDraftId: 'draft-1', expectedDraftVersion: 3, baseContentVersion: 4 }), params)
    assert.equal(removed.status, 200); assert.equal(draft, null)
  })
  it('restricts mutations to Admin and rejects a stale published content version', async () => {
    reset(); role = 'MEMBER'
    assert.equal((await drafts.PUT(request('PUT', { content }), params)).status, 403)
    assert.equal((await publish.POST(request('POST', {}), params)).status, 403)
    reset(); version = 5
    const response = await publish.POST(request('POST', { expectedDraftId: 'draft-1', expectedDraftVersion: 2 }), params)
    assert.equal(response.status, 409); assert.equal(applied, 0)
  })
})
