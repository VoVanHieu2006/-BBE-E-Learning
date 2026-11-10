import { expect, test, Page, BrowserContext } from '@playwright/test'
import { SignJWT } from 'jose'

const courseId = '00000000-0000-4000-8000-000000000001'
const sessionId = '00000000-0000-4000-8000-000000000002'
const lessonId = '00000000-0000-4000-8000-000000000003'
const quizId = '00000000-0000-4000-8000-000000000004'
const base = `/api/v1/courses/${courseId}`
const initial = () => ({ title: 'Khóa kiểm thử cập nhật', description: '', visibility: 'PRIVATE', sessions: [{ id: sessionId, sessionId, title: 'Buổi gốc', lessons: [{ id: lessonId, lessonId, title: 'Bài đã học', video: null, documents: [], assessment: { id: quizId, assessmentId: quizId, title: 'Quiz mới', questionCount: 1, durationMinutes: 30, pools: [], questions: [{ id: '00000000-0000-4000-8000-000000000005', questionText: 'Câu gốc', questionType: 'SINGLE_CHOICE', points: 1, options: [{ id: '00000000-0000-4000-8000-000000000006', optionText: 'Đúng', isCorrect: true }, { id: '00000000-0000-4000-8000-000000000007', optionText: 'Sai', isCorrect: false }] }] } }] }], finalAssessment: { title: 'Thi cuối', questionCount: 1, durationMinutes: 30 } })
const course = () => ({ ...initial(), id: courseId, courseId, status: 'PUBLISHED' })

async function auth(page: Page, context: BrowserContext, role: 'ADMIN' | 'MEMBER') {
  const token = await new SignJWT({ role }).setProtectedHeader({ alg: 'HS256' }).setSubject('00000000-0000-4000-8000-000000000099').setExpirationTime('10m').sign(new TextEncoder().encode('p02b-browser-fixture-secret-only-32'))
  await context.addCookies([{ name: 'accessToken', value: token, url: 'http://127.0.0.1:3120', httpOnly: true }])
  await page.addInitScript(({ token, role }) => { localStorage.setItem('accessToken', token); localStorage.setItem('user', JSON.stringify({ id: 'user', role, status: 'ACTIVE', displayName: 'Kiểm thử' })); }, { token, role })
}

async function editor(page: Page, conflict = false) {
  const calls: { method: string; path: string; body: any }[] = []
  let draft: any = null
  let content = initial()
  await page.route('**/api/**', async route => {
    const req = route.request(), path = new URL(req.url()).pathname, method = req.method()
    const body = req.postData() && req.headers()['content-type']?.includes('json') ? req.postDataJSON() : null
    if (method !== 'GET') calls.push({ method, path, body })
    if (path === base) return route.fulfill({ json: { ...course(), ...content } })
    if (path === `${base}/draft` && method === 'GET') return route.fulfill({ json: { course: { contentVersion: 1 }, draft, initialContent: content } })
    if (path === `${base}/draft` && method === 'PUT') {
      if (conflict) return route.fulfill({ status: 409, json: { error: { code: 'ConcurrencyConflict', message: 'Admin khác đã thay đổi bản nháp.' } } })
      draft = { id: 'draft-ui', draftVersion: (draft?.draftVersion || 0) + 1, content: body.content }
      return route.fulfill({ json: { draft } })
    }
    if (path === `${base}/draft` && method === 'DELETE') { draft = null; return route.fulfill({ json: { success: true } }) }
    if (path === `${base}/draft/publish`) { content = draft.content; draft = null; return route.fulfill({ json: { courseId, status: 'PUBLISHED' } }) }
    if (path === '/api/v1/users/me') return route.fulfill({ json: { id: 'user', role: 'ADMIN', status: 'ACTIVE' } })
    return route.fulfill({ json: { items: [] } })
  })
  await page.goto(`/admin/courses/${courseId}/edit`)
  await expect(page.getByRole('heading', { name: 'Thông tin chung khóa học' })).toBeVisible()
  return calls
}

test('published course saves metadata to draft, publishes once and retains question IDs', async ({ page, context }, info) => {
  await auth(page, context, 'ADMIN')
  const calls = await editor(page)
  await page.locator('input[type="text"]').first().fill('Tiêu đề bản nháp')
  await page.getByRole('button', { name: 'Lưu thay đổi •' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Có thay đổi chưa cập nhật' })).toBeVisible()
  const put = calls.find(c => c.method === 'PUT')!
  expect(put.path).toBe(`${base}/draft`)
  expect(put.body.expectedDraftVersion).toBe(0)
  expect(put.body.content.sessions[0].lessons[0].assessment.questions[0].options[0].id).toBe(initial().sessions[0].lessons[0].assessment.questions[0].options[0].id)
  await page.screenshot({ path: `test-results/p02b-editor-${info.project.name}.png`, fullPage: true })
  await page.getByRole('button', { name: 'Cập nhật khóa học', exact: true }).click()
  await expect(page.getByText('Chỉnh sửa được lưu vào bản nháp thay đổi.', { exact: true })).toBeVisible()
  expect(calls.filter(c => c.path.endsWith('/draft/publish'))).toHaveLength(1)
  expect(calls.find(c => c.path.endsWith('/draft/publish'))!.body).toEqual({ expectedDraftId: 'draft-ui', expectedDraftVersion: 1 })
  expect(calls.some(c => c.path === base || c.path.endsWith('/unpublish'))).toBe(false)
})

test('session changes and discard stay in the published draft', async ({ page, context }) => {
  await auth(page, context, 'ADMIN')
  const calls = await editor(page)
  await page.getByRole('button', { name: /Thêm buổi học/ }).click()
  const modal = page.locator('[role="dialog"]')
  await modal.locator('input').first().fill('Buổi mới')
  await modal.getByRole('button', { name: /Lưu|Thêm buổi/ }).last().click()
  await expect(page.getByText('Buổi mới', { exact: true })).toBeVisible()
  expect(calls.find(c => c.method === 'PUT')!.body.content.sessions).toHaveLength(2)
  page.once('dialog', d => d.accept())
  await page.getByRole('button', { name: 'Bỏ thay đổi', exact: true }).click()
  await expect(page.getByText('Buổi mới', { exact: true })).toHaveCount(0)
  expect(calls.find(c => c.method === 'DELETE')!.body.expectedDraftVersion).toBe(1)
  expect(calls.every(c => c.path === `${base}/draft`)).toBe(true)
})

test('concurrent admin conflict blocks further writes until reload', async ({ page, context }) => {
  await auth(page, context, 'ADMIN')
  await editor(page, true)
  await page.locator('input[type="text"]').first().fill('Thay đổi xung đột')
  await page.getByRole('button', { name: 'Lưu thay đổi •' }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Admin khác' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Cập nhật khóa học', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Tải lại bản nháp' }).click()
  await expect(page.locator('input[type="text"]').first()).toHaveValue(initial().title)
})

async function learner(page: Page, withLockedNewLesson = false) {
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname
    const state = { id: lessonId, lessonId, completed: true, lessonCompleted: true, videoCompleted: true, canAssess: true, canView: true, assessmentPassed: false, isNew: false, quizIsNew: true, progressPercentage: 100 }
    const learnerCourse: any = course()
    const states: any[] = [state]
    if (withLockedNewLesson) {
      learnerCourse.sessions[0].lessons.push({ id: 'new-lesson', lessonId: 'new-lesson', title: 'Bài mới đang khóa', video: null, documents: [], assessment: null })
      states.push({ id: 'new-lesson', lessonId: 'new-lesson', canView: false, completed: false, isNew: true, quizIsNew: false, assessmentPassed: false })
    }
    if (path === base) return route.fulfill({ json: learnerCourse })
    if (path === `${base}/my-progress`) return route.fulfill({ json: { totalLessons: states.length, completedLessons: 1, progressPercentage: 100, sessions: [{ sessionId, lessons: states }] } })
    if (path === '/api/v1/learning/me') return route.fulfill({ json: { programs: [{ id: 'program-ui', code: 'CORE_MEMBER', name: 'Chương trình kiểm thử', courses: [learnerCourse] }], completedLessonIds: [lessonId], inProgressLessonIds: [], unlockedLessonIds: [lessonId], lessonStates: Object.fromEntries(states.map(s => [s.id, s])), notices: [] } })
    if (path === `/api/v1/lessons/${lessonId}`) return route.fulfill({ json: { ...initial().sessions[0].lessons[0], session: { id: sessionId, courseId, title: 'Buổi gốc', courseTitle: initial().title } } })
    if (path === `/api/v1/lessons/${lessonId}/progress`) return route.fulfill({ json: state })
    if (path === '/api/v1/users/me') return route.fulfill({ json: { id: 'user', role: 'MEMBER', status: 'ACTIVE' } })
    return route.fulfill({ json: { items: [] } })
  })
}

test('course shows new quiz on completed lesson and keeps final exam locked', async ({ page, context }, info) => {
  await auth(page, context, 'MEMBER'); await learner(page, true)
  await page.goto(`/student/courses/${courseId}`)
  await expect(page.getByText('Mới', { exact: true })).toHaveCount(2)
  await expect(page.getByText('Bài mới đang khóa', { exact: false })).toBeVisible()
  await expect(page.getByText('Chúc mừng! Bạn đã hoàn thành toàn bộ khóa học này')).toHaveCount(0)
  await expect(page.getByRole('link', { name: /Làm bài thi cuối khóa/ })).toHaveCount(0)
  await page.screenshot({ path: `test-results/p02b-course-${info.project.name}.png`, fullPage: true })
})

test('program tree marks a new quiz on a completed video', async ({ page, context }) => {
  await auth(page, context, 'MEMBER'); await learner(page)
  await page.goto('/student/courses')
  await page.getByRole('button', { name: 'Mở tất cả' }).click()
  const row = page.locator('div').filter({ has: page.getByRole('link', { name: 'Bài đã học', exact: true }) }).filter({ has: page.getByText('Mới', { exact: true }) })
  await expect(row.last().getByText('Mới', { exact: true })).toBeVisible()
})

test('lesson sidebar and quiz tab do not pass a newly added quiz', async ({ page, context }) => {
  await auth(page, context, 'MEMBER'); await learner(page)
  await page.goto(`/student/learning/${lessonId}`)
  await expect(page.getByRole('button', { name: /Bài kiểm tra.*Mới.*Cần làm/ })).toBeVisible()
  await expect(page.getByText('✓ Quiz đạt', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Mới', { exact: true })).toHaveCount(2)
})

test('quiz page uses assessment pass state and preserves next-lesson navigation gate', async ({ page, context }, info) => {
  await auth(page, context, 'MEMBER'); await learner(page)
  await page.goto(`/student/learning/${lessonId}/quiz`)
  await expect(page.getByText('Mới', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /Bắt đầu làm bài/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Làm lại bài kiểm tra/ })).toHaveCount(0)
  await page.screenshot({ path: `test-results/p02b-quiz-${info.project.name}.png`, fullPage: true })
})
