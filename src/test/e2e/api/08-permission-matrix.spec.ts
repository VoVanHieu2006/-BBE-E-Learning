import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { Api, as, guest } from '../support/api'
import { createCourse, createLearner, CRON_HEADERS, inviteLink, uniqueEmail } from '../support/fixtures'

// Intent: docs/business-rules.md "Vai trò và phạm vi" + docs/api.md guards.
// Every route handler in src/app/api must be classified here; an unclassified route fails the suite.
type Audience =
  | 'PUBLIC' // anyone, including guests
  | 'CRON' // CRON_SECRET bearer only
  | 'ADMIN' // Admin only
  | 'MANAGER' // Admin, Lead Chapter, Lead DNA (each within their own scope)
  | 'CHAPTER' // Admin and the Lead of that Chapter
  | 'CHAPTER_LEAD' // only the Lead of that Chapter; Admin is read-only
  | 'AUTH' // any signed-in account
  | 'LEARNER' // accounts that learn; management-only accounts are refused
  | 'GONE' // retired endpoint, answers 410 to everyone
const ROLES = ['guest', 'member', 'chapterLead', 'dnaLead', 'admin'] as const
type Role = (typeof ROLES)[number]
const ALLOWED: Record<Exclude<Audience, 'GONE' | 'CRON'>, Role[]> = {
  PUBLIC: ['guest', 'member', 'chapterLead', 'dnaLead', 'admin'],
  ADMIN: ['admin'],
  MANAGER: ['chapterLead', 'dnaLead', 'admin'],
  CHAPTER: ['chapterLead', 'admin'],
  CHAPTER_LEAD: ['chapterLead'],
  AUTH: ['member', 'chapterLead', 'dnaLead', 'admin'],
  LEARNER: ['member'],
}

const MATRIX: Record<string, Audience> = {
  'GET internal/attempts/auto-submit': 'CRON', 'POST internal/attempts/auto-submit': 'CRON',
  'GET internal/learning/deadlines/enforce': 'CRON', 'POST internal/learning/deadlines/enforce': 'CRON',
  'GET internal/organization/reorganizations/apply': 'CRON',
  'POST v1/attempts/auto-submit': 'CRON',
  'GET v1/admin/learning-config': 'ADMIN', 'PUT v1/admin/learning-config': 'ADMIN',
  'GET v1/admin/learning-policy': 'ADMIN', 'PUT v1/admin/learning-policy': 'ADMIN',
  'POST v1/admin/learning-rules/[ruleId]/materialize': 'ADMIN', 'PATCH v1/admin/learning-rules/[ruleId]': 'ADMIN',
  'GET v1/admin/learning-rules': 'ADMIN', 'POST v1/admin/learning-rules': 'ADMIN',
  'GET v1/admin/mandatory-matrix': 'ADMIN', 'PUT v1/admin/mandatory-matrix': 'ADMIN',
  'GET v1/admin/organization/history': 'ADMIN', 'GET v1/admin/organization': 'ADMIN', 'POST v1/admin/organization': 'ADMIN',
  'GET v1/admin/overview': 'ADMIN', 'GET v1/admin/restrictions': 'ADMIN', 'POST v1/admin/restrictions': 'ADMIN',
  'GET v1/admin/transfer-seasons/chapters/[chapterId]': 'ADMIN', 'GET v1/admin/transfer-seasons/progress': 'ADMIN',
  'POST v1/admin/users/[userId]/extend-deadline': 'ADMIN',
  'GET v1/assessments/[assessmentId]/attempts/me': 'AUTH', 'POST v1/assessments/[assessmentId]/attempts': 'LEARNER',
  'GET v1/assessments/[assessmentId]/pools': 'ADMIN', 'PUT v1/assessments/[assessmentId]/pools': 'ADMIN',
  'GET v1/assessments/[assessmentId]': 'ADMIN', 'PATCH v1/assessments/[assessmentId]': 'ADMIN', 'DELETE v1/assessments/[assessmentId]': 'ADMIN',
  'PUT v1/attempts/[attemptId]/answers/[questionId]': 'AUTH', 'POST v1/attempts/[attemptId]/answers': 'AUTH',
  'POST v1/attempts/[attemptId]/cancel': 'AUTH', 'GET v1/attempts/[attemptId]': 'AUTH', 'DELETE v1/attempts/[attemptId]': 'AUTH',
  'POST v1/attempts/[attemptId]/submit': 'AUTH',
  'POST v1/auth/login': 'PUBLIC', 'POST v1/auth/logout': 'PUBLIC', 'GET v1/auth/me': 'AUTH',
  'POST v1/auth/password-reset/confirm': 'PUBLIC', 'POST v1/auth/password-reset/request': 'PUBLIC', 'POST v1/auth/refresh': 'PUBLIC',
  'GET v1/chapters/[chapterId]/current-roster': 'CHAPTER', 'GET v1/chapters/[chapterId]/dashboard/courses': 'CHAPTER',
  'GET v1/chapters/[chapterId]/dashboard/members': 'CHAPTER', 'GET v1/chapters/[chapterId]/kpi': 'CHAPTER', 'PUT v1/chapters/[chapterId]/kpi': 'ADMIN',
  'GET v1/chapters/[chapterId]/members/[userId]/course-progress': 'CHAPTER', 'POST v1/chapters/[chapterId]/members/[userId]/department': 'CHAPTER',
  'DELETE v1/chapters/[chapterId]/members/[userId]': 'CHAPTER', 'POST v1/chapters/[chapterId]/members/bulk-deactivate': 'CHAPTER',
  'GET v1/chapters/[chapterId]/members': 'CHAPTER',
  'POST v1/chapters/[chapterId]/reorganizations/[batchId]': 'CHAPTER_LEAD', 'DELETE v1/chapters/[chapterId]/reorganizations/[batchId]': 'CHAPTER_LEAD',
  'POST v1/chapters/[chapterId]/reorganizations/parse-sheet': 'CHAPTER',
  'GET v1/chapters/[chapterId]/reorganizations': 'CHAPTER', 'POST v1/chapters/[chapterId]/reorganizations': 'CHAPTER_LEAD',
  'GET v1/chapters': 'ADMIN',
  'GET v1/courses/[courseId]/assessment': 'GONE', 'POST v1/courses/[courseId]/assessment': 'GONE',
  'POST v1/courses/[courseId]/cover': 'ADMIN', 'POST v1/courses/[courseId]/draft/documents/upload': 'ADMIN',
  'POST v1/courses/[courseId]/draft/publish': 'ADMIN',
  'GET v1/courses/[courseId]/draft': 'ADMIN', 'PUT v1/courses/[courseId]/draft': 'ADMIN', 'DELETE v1/courses/[courseId]/draft': 'ADMIN',
  'GET v1/courses/[courseId]/final-assessment': 'AUTH', 'POST v1/courses/[courseId]/final-assessment': 'ADMIN', 'DELETE v1/courses/[courseId]/final-assessment': 'ADMIN',
  'GET v1/courses/[courseId]/my-progress': 'AUTH', 'POST v1/courses/[courseId]/publish': 'ADMIN',
  'GET v1/courses/[courseId]/questions': 'ADMIN',
  'GET v1/courses/[courseId]': 'PUBLIC', 'PATCH v1/courses/[courseId]': 'ADMIN', 'DELETE v1/courses/[courseId]': 'ADMIN',
  'PATCH v1/courses/[courseId]/sessions/reorder': 'ADMIN', 'POST v1/courses/[courseId]/sessions': 'ADMIN',
  'GET v1/courses/[courseId]/students': 'CHAPTER', 'POST v1/courses/[courseId]/unpublish': 'ADMIN',
  'GET v1/courses': 'PUBLIC', 'POST v1/courses': 'ADMIN',
  'GET v1/documents/[documentId]/download': 'PUBLIC', 'DELETE v1/documents/[documentId]': 'ADMIN',
  'GET v1/health': 'PUBLIC',
  'POST v1/invitations/[id]/link': 'MANAGER', 'POST v1/invitations/[id]/resend': 'MANAGER', 'DELETE v1/invitations/[id]': 'MANAGER',
  'POST v1/invitations/accept': 'PUBLIC', 'POST v1/invitations/chapter-leader': 'ADMIN', 'POST v1/invitations/dna-leader': 'ADMIN',
  'GET v1/invitations/email-quota': 'MANAGER', 'POST v1/invitations/member/bulk': 'MANAGER', 'POST v1/invitations/member': 'MANAGER',
  'GET v1/invitations': 'MANAGER', 'GET v1/invitations/validate': 'PUBLIC',
  'GET v1/leaderboard/chapters/[chapterId]': 'AUTH', 'GET v1/leaderboard/chapters': 'PUBLIC', 'GET v1/leaderboard': 'PUBLIC',
  'GET v1/learning/me': 'AUTH', 'POST v1/learning/monthly-review': 'LEARNER', 'GET v1/learning/periods': 'PUBLIC',
  'GET v1/lessons/[lessonId]/assessment': 'ADMIN', 'POST v1/lessons/[lessonId]/assessment': 'ADMIN', 'DELETE v1/lessons/[lessonId]/assessment': 'ADMIN',
  'DELETE v1/lessons/[lessonId]/comments/[commentId]': 'AUTH', 'GET v1/lessons/[lessonId]/comments': 'AUTH', 'POST v1/lessons/[lessonId]/comments': 'AUTH',
  'POST v1/lessons/[lessonId]/documents/confirm': 'ADMIN', 'POST v1/lessons/[lessonId]/documents/presign': 'ADMIN', 'POST v1/lessons/[lessonId]/documents/upload': 'ADMIN',
  'PATCH v1/lessons/[lessonId]/progress': 'LEARNER', 'POST v1/lessons/[lessonId]/progress': 'LEARNER', 'GET v1/lessons/[lessonId]/progress': 'AUTH',
  'GET v1/lessons/[lessonId]': 'PUBLIC', 'PATCH v1/lessons/[lessonId]': 'ADMIN', 'PUT v1/lessons/[lessonId]': 'ADMIN', 'DELETE v1/lessons/[lessonId]': 'ADMIN',
  'GET v1/members/me/courses': 'AUTH', 'GET v1/members/me/deadlines': 'AUTH',
  'GET v1/organization/dna-leaderboard': 'ADMIN', // plus Lead DNA, asserted in 07-organization
  'GET v1/organization/managed-units': 'AUTH',
  'GET v1/organization/units/[unitId]/members/[userId]/progress': 'MANAGER',
  'GET v1/organization/units/[unitId]/members': 'MANAGER', 'POST v1/organization/units/[unitId]/members': 'MANAGER',
  'POST v1/quiz/parse-sheet': 'ADMIN',
  'POST v1/sessions/[sessionId]/lessons': 'ADMIN', 'PATCH v1/sessions/[sessionId]/lessons': 'ADMIN',
  'GET v1/sessions/[sessionId]': 'PUBLIC', 'PATCH v1/sessions/[sessionId]': 'ADMIN', 'PUT v1/sessions/[sessionId]': 'ADMIN', 'DELETE v1/sessions/[sessionId]': 'ADMIN',
  'GET v1/stars/me': 'AUTH', 'GET v1/streak': 'AUTH',
  'POST v1/users/[userId]/password-reset/link': 'ADMIN', 'POST v1/users/[userId]/password-reset': 'ADMIN',
  'PATCH v1/users/[userId]/profile': 'ADMIN', 'PATCH v1/users/[userId]': 'MANAGER',
  'GET v1/users/me': 'AUTH', 'PATCH v1/users/me': 'AUTH', 'GET v1/users': 'ADMIN', 'GET v1/youtube/info': 'ADMIN',
}
// Roles the generic rule does not describe; each is asserted with real data in the feature suites.
const UNASSERTED: Record<string, Role[]> = {
  'GET v1/organization/dna-leaderboard': ['dnaLead'],
  'PATCH v1/lessons/[lessonId]/progress': ['admin'], 'POST v1/lessons/[lessonId]/progress': ['admin'], // Admin preview, never rewarded
  'POST v1/learning/monthly-review': ['admin'],
  // Admin may trigger these jobs by hand; every other caller needs the cron secret.
  'GET internal/attempts/auto-submit': ['admin'], 'POST internal/attempts/auto-submit': ['admin'], 'POST v1/attempts/auto-submit': ['admin'],
  'GET internal/learning/deadlines/enforce': ['admin'], 'POST internal/learning/deadlines/enforce': ['admin'],
  // Scoped to a unit or Chapter the Lead DNA does not manage; the DNA side is asserted in 02-invitations and 07-organization.
  'GET v1/organization/units/[unitId]/members/[userId]/progress': ['dnaLead'], 'GET v1/organization/units/[unitId]/members': ['dnaLead'],
  'POST v1/organization/units/[unitId]/members': ['dnaLead'], 'GET v1/leaderboard/chapters/[chapterId]': ['dnaLead'],
  'POST v1/invitations/member': ['dnaLead', 'admin'], 'POST v1/invitations/member/bulk': ['dnaLead', 'admin'],
}
// These handlers validate the body before the role, so a refusal is only proven with a well-formed body.
const BODIES: Record<string, unknown> = {
  'PATCH v1/users/[userId]/profile': { displayName: 'Bị Đổi Tên' },
  'PATCH v1/users/[userId]': { status: 'INACTIVE' },
}
// Answer 503 while R2/Cloudinary are not configured, which is the case in the disposable environment.
const EXTERNAL = ['GET v1/health', 'POST v1/courses/[courseId]/cover']

const API_ROOT = path.resolve(__dirname, '../../../app/api')
function discover(dir = API_ROOT): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return discover(full)
    if (name !== 'route.ts') return []
    const route = path.relative(API_ROOT, dir).split(path.sep).join('/')
    const source = readFileSync(full, 'utf8')
    const methods = new Set<string>()
    for (const match of source.matchAll(/export\s+(?:async\s+function|const)\s+(GET|POST|PUT|PATCH|DELETE)\b/g)) methods.add(match[1])
    for (const match of source.matchAll(/export\s*\{([^}]+)\}\s*from/g)) for (const name of match[1].split(',')) methods.add(name.trim())
    return Array.from(methods).map((method) => `${method} ${route}`)
  })
}

const NOBODY = '00000000-0000-4000-8000-000000000000'
let real: Record<string, string>
const fill = (route: string, ids: Record<string, string>) => `/api/${route.replace(/\[(\w+)\]/g, (_, key) => ids[key] || NOBODY)}`

test.beforeAll(async ({ request }) => {
  const course = await createCourse(request, { lessons: [{ quiz: { questions: 5 } }], visibility: 'PRIVATE' })
  const lead = await as(request, 'chapterLead')
  real = {
    chapterId: lead.session.user.chapterId as string,
    courseId: course.courseId, sessionId: course.sessionId, lessonId: course.lessons[0].lessonId, assessmentId: course.lessons[0].assessmentId!,
    userId: (await createLearner(request)).userId,
    id: (await inviteLink(request, 'chapterLead', uniqueEmail('matrix'))).invitationId,
    unitId: (await lead.get('/api/v1/organization/managed-units')).body.items[0].id,
  }
})

async function call(request: any, role: Role, key: string, ids: Record<string, string>, body: unknown = {}) {
  const [method, route] = key.split(' ')
  const api: Api = role === 'guest' ? guest(request) : await as(request, role)
  const url = fill(route, ids)
  if (method === 'GET') return api.get(url)
  if (method === 'DELETE') return api.delete(url)
  return (api as any)[method.toLowerCase()](url, body)
}

test('mọi route trong src/app/api đều đã được phân loại quyền', () => {
  const found = discover().sort()
  expect(found.filter((key) => !MATRIX[key]), 'route mới chưa có trong ma trận quyền').toEqual([])
  expect(Object.keys(MATRIX).filter((key) => !found.includes(key)), 'ma trận còn route đã xóa').toEqual([])
  expect(new Set(found.map((key) => key.split(' ')[1])).size).toBeGreaterThanOrEqual(105)
})

for (const role of ROLES) {
  test(`${role}: bị từ chối đúng mã ở mọi route ngoài quyền, kể cả với dữ liệu thật`, async ({ request }) => {
    test.setTimeout(180_000)
    for (const [key, audience] of Object.entries(MATRIX)) {
      if (audience === 'GONE' || audience === 'PUBLIC' || UNASSERTED[key]?.includes(role)) continue
      if (audience !== 'CRON' && ALLOWED[audience].includes(role)) continue
      const result = await call(request, role, key, real, BODIES[key])
      // Guests get 401; a few Admin handlers answer 403 to guests, which still refuses them.
      const expected = audience === 'CRON' ? [401] : role === 'guest' ? [401, 403] : [403]
      expect.soft(expected, `${role} → ${key} (${audience}) trả ${result.status}`).toContain(result.status)
      expect.soft(result.body?.error?.code, `${role} → ${key} phải có mã lỗi`).toBeTruthy()
    }
  })

  test(`${role}: không bị chặn nhầm ở route thuộc quyền và không route nào trả 5xx với dữ liệu rỗng`, async ({ request }) => {
    test.setTimeout(180_000)
    for (const [key, audience] of Object.entries(MATRIX)) {
      if (UNASSERTED[key]?.includes(role)) continue
      const allowed = audience !== 'GONE' && audience !== 'CRON' && ALLOWED[audience].includes(role)
      if (!allowed && audience !== 'GONE') continue
      // Placeholder IDs: an allowed caller must get past the guard without touching real data.
      const result = await call(request, role, key, key.startsWith('GET ') && audience !== 'PUBLIC' ? real : { chapterId: real.chapterId })
      if (audience === 'GONE') { expect.soft(result.status, key).toBe(410); continue }
      expect.soft([401, 403], `${role} → ${key} (${audience}) trả ${result.status} ${JSON.stringify(result.body).slice(0, 120)}`).not.toContain(result.status)
      if (!EXTERNAL.includes(key)) expect.soft(result.status, `${role} → ${key} trả 5xx`).toBeLessThan(500)
    }
  })
}

test('route cron: secret đúng mới chạy, cookie Admin không thay được secret', async ({ request }) => {
  for (const key of Object.keys(MATRIX).filter((item) => MATRIX[item] === 'CRON')) {
    const [method, route] = key.split(' ')
    const wrong = await request.fetch(`/api/${route}`, { method, headers: { ...CRON_HEADERS, Authorization: 'Bearer wrong-secret' } })
    expect.soft(wrong.status(), key).toBe(401)
    const right = await request.fetch(`/api/${route}`, { method, headers: CRON_HEADERS })
    expect.soft(right.status(), key).toBe(200)
  }
})

test('Admin sửa tên của tài khoản không tồn tại phải nhận 404, không phải lỗi 500', async ({ request }) => {
  const result = await call(request, 'admin', 'PATCH v1/users/[userId]/profile', {}, { displayName: 'Tên Hợp Lệ' })
  expect(result.status).toBe(404)
})
