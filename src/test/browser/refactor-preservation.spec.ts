import { expect, test, type Page, type BrowserContext, type Request } from '@playwright/test'
import { SignJWT } from 'jose'

const baseURL = 'http://127.0.0.1:3123'
const secret = 'refactor-fixture-only-access-secret-32-bytes'
const user = {
  id: '11111111-1111-4111-8111-111111111111',
  role: 'ADMIN', email: 'refactor@test.invalid', displayName: 'Fixture admin',
  chapterId: 'chapter-fixture', chapterName: 'Fixture Chapter', canManageMembers: true,
}
type Reply = { body: any; status?: number }
type Responder = (url: URL, request: Request) => Reply | undefined | Promise<Reply | undefined>

async function fixture(page: Page, context: BrowserContext, respond: Responder) {
  const token = await new SignJWT({ role: user.role, chapterId: user.chapterId })
    .setProtectedHeader({ alg: 'HS256' }).setSubject(user.id).setExpirationTime('15m')
    .sign(new TextEncoder().encode(secret))
  await context.addCookies([{ name: 'accessToken', value: token, url: baseURL, httpOnly: true }])
  await page.addInitScript(({ token, user }) => {
    localStorage.setItem('accessToken', token)
    localStorage.setItem('user', JSON.stringify(user))
  }, { token, user })
  // Only the local app's static resources may reach a server. API traffic and
  // external images/uploads are handled here, never by a real database/service.
  await context.route('**/*', route => new URL(route.request().url()).origin === baseURL
    ? route.fallback() : route.abort('blockedbyclient'))
  await page.route('**/api/**', async route => {
    const request = route.request()
    const result = await respond(new URL(request.url()), request)
    await route.fulfill({ status: result?.status ?? 200, json: result?.body ?? { items: [], stats: {}, user } })
  })
}

function assessment() {
  return {
    id: 'quiz-fixture', title: 'Fixture quiz', description: '', questionCount: 1,
    durationMinutes: 5, pools: [{ id: 'pool-fixture', name: 'Fixture pool' }],
    questions: [{ id: 'question-fixture', questionText: 'Fixture question', type: 'SINGLE_CHOICE',
      poolId: 'pool-fixture', points: 1, durationSeconds: 60, explanation: '',
      options: [{ optionText: 'Correct', isCorrect: true }, { optionText: 'Other', isCorrect: false }] }],
  }
}
function course() {
  return {
    id: 'course-fixture', title: 'Fixture course', description: 'Initial description',
    status: 'DRAFT', visibility: 'PRIVATE',
    sessions: [{ id: 'session-fixture', sessionId: 'session-fixture', title: 'Fixture session', description: '',
      lessons: [{ id: 'lesson-fixture', lessonId: 'lesson-fixture', title: 'Fixture lesson',
        youtubeVideoId: 'dQw4w9WgXcQ', durationSeconds: 60, documents: [], assessment: assessment() }] }],
  }
}

test('course saves trimmed info and edits a session with the same PATCH payloads', async ({ page, context }) => {
  const data = course()
  let coursePatch: any, sessionPatch: any
  await fixture(page, context, (url, request) => {
    if (url.pathname === '/api/v1/courses/course-fixture') {
      if (request.method() === 'PATCH') { coursePatch = request.postDataJSON(); Object.assign(data, coursePatch) }
      return { body: data }
    }
    if (url.pathname === '/api/v1/sessions/session-fixture') {
      sessionPatch = request.postDataJSON()
      return { body: sessionPatch }
    }
  })
  await page.goto('/admin/courses/course-fixture/edit')
  await page.getByRole('textbox').first().fill('  Updated course  ')
  await page.getByRole('button', { name: 'Lưu thay đổi', exact: false }).click()
  await expect.poll(() => coursePatch).toEqual({ title: 'Updated course', description: 'Initial description', visibility: 'PRIVATE' })
  await page.getByTitle('Chỉnh sửa buổi học (tiêu đề & mô tả)').click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('textbox').first().fill('  Updated session  ')
  await dialog.getByRole('textbox').nth(1).fill('  Session description  ')
  await dialog.getByRole('button', { name: 'Lưu thay đổi', exact: true }).click()
  await expect.poll(() => sessionPatch).toEqual({ title: 'Updated session', description: 'Session description' })
  await expect(page.getByText('Updated session', { exact: true })).toBeVisible()
  await expect(dialog).toHaveCount(0)
})

test('course upload keeps server fallback and displays the returned document', async ({ page, context }) => {
  let presign: any, uploaded = false
  await fixture(page, context, (url, request) => {
    if (url.pathname === '/api/v1/courses/course-fixture') return { body: course() }
    if (url.pathname.endsWith('/documents/presign')) {
      presign = request.postDataJSON()
      return { status: 503, body: { error: { message: 'Fixture presign unavailable' } } }
    }
    if (url.pathname.endsWith('/documents/upload')) {
      uploaded = request.method() === 'POST' && (request.postDataBuffer()?.includes(Buffer.from('fixture.txt')) ?? false)
      return { body: { documentId: 'document-fixture', fileName: 'fixture.txt', fileSize: 7, mimeType: 'text/plain' } }
    }
  })
  await page.goto('/admin/courses/course-fixture/edit')
  await page.locator('details > summary').first().click()
  await page.locator('input[type=file][multiple]').setInputFiles({ name: 'fixture.txt', mimeType: 'text/plain', buffer: Buffer.from('fixture') })
  await expect.poll(() => presign).toEqual({ fileName: 'fixture.txt', mimeType: 'text/plain', fileSize: 7 })
  await expect.poll(() => uploaded).toBe(true)
  await expect(page.getByText('fixture.txt', { exact: true })).toBeVisible()
})

test('course assessment editor loads the lesson quiz and preserves save payload and errors', async ({ page, context }) => {
  let submitted: any, reject = true
  let quiz = assessment()
  await fixture(page, context, (url, request) => {
    if (url.pathname === '/api/v1/courses/course-fixture') return { body: course() }
    if (url.pathname === '/api/v1/lessons/lesson-fixture/assessment') {
      if (request.method() === 'POST') {
        submitted = request.postDataJSON()
        if (reject) return { status: 422, body: { error: { code: 'FIXTURE_INVALID', message: 'Fixture quiz save rejected' } } }
        quiz = { ...quiz, durationMinutes: submitted.durationMinutes }
        return { body: quiz }
      }
      return { body: quiz }
    }
  })
  await page.goto('/admin/courses/course-fixture/edit')
  await page.locator('details > summary').first().click()
  await page.getByTitle('Cấu hình bài kiểm tra cho bài học này').click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Thời gian (phút)').fill('7')
  await dialog.getByRole('button', { name: 'Lưu bài kiểm tra', exact: true }).click()
  await expect.poll(() => submitted?.durationMinutes).toBe(7)
  expect(submitted).toMatchObject({ title: 'Fixture quiz', description: '', pools: ['Fixture pool'], questionCount: 1,
    questions: [{ questionText: 'Fixture question', questionType: 'SINGLE_CHOICE', points: 1, durationSeconds: 60,
      explanation: null, sortOrder: 0, poolIndex: 0, options: [{ optionText: 'Correct', isCorrect: true, sortOrder: 0 }, { optionText: 'Other', isCorrect: false, sortOrder: 1 }] }] })
  await expect(dialog.getByText('Fixture quiz save rejected', { exact: true })).toBeVisible()
  await expect(dialog).toBeVisible()
  reject = false
  await dialog.getByRole('button', { name: 'Lưu bài kiểm tra', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await page.getByTitle('Cấu hình bài kiểm tra cho bài học này').click()
  await expect(page.getByRole('dialog').getByLabel('Thời gian (phút)')).toHaveValue('7')
})

function roster(scheduledBatch: any = null) {
  return { currentTermNumber: 2, departments: [{ id: 'dept-fixture', name: 'Chủ Tịch' }],
    roster: [{ id: 'dept-fixture', name: 'Chủ Tịch', total: 1,
      members: [{ userId: 'member-fixture', displayName: 'Fixture member', email: 'member@test.invalid', isLead: true }] }],
    unassignedMembers: [], scheduledBatch }
}
function draft() {
  const item = { userId: 'member-fixture', displayName: 'Fixture member', departmentUnitId: 'dept-fixture', positionId: 'position-fixture', isLead: true }
  return { items: [item], summary: { matchedInChapter: 1, unmatchedSheetCount: 0, unmatchedCurrentCount: 0 },
    matchedNewTerm: [{ departmentName: 'Chủ Tịch', members: [item] }], unmatchedCurrentMembers: [], unmatchedSheetMembers: [] }
}

test('term sheet draft survives reload and rejected transfer, then clears on successful scheduling', async ({ page, context }) => {
  const parsed = draft()
  let parsePayload: any, scheduledPayload: any, reject = true
  await fixture(page, context, (url, request) => {
    if (url.pathname.endsWith('/current-roster')) return { body: roster() }
    if (url.pathname.endsWith('/parse-sheet')) { parsePayload = request.postDataJSON(); return { body: parsed } }
    if (url.pathname.endsWith('/reorganizations') && request.method() === 'POST') {
      scheduledPayload = request.postDataJSON()
      return reject ? { status: 422, body: { error: { code: 'FIXTURE_INVALID', message: 'Fixture transfer rejected' } } }
        : { body: { appliedImmediately: false } }
    }
  })
  await page.goto('/chapter-manager/term-transition')
  await expect(page.getByRole('link', { name: 'Fixture member', exact: true })).toBeVisible()
  await page.getByPlaceholder('Dán link Google Sheet...').fill('https://docs.google.com/spreadsheets/d/fixture/edit')
  await page.getByRole('button', { name: 'Đọc và phân tích sheet', exact: false }).click()
  await expect.poll(() => parsePayload).toEqual({ url: 'https://docs.google.com/spreadsheets/d/fixture/edit' })
  await expect.poll(() => page.evaluate(() => localStorage.getItem('bbe_term_transition_draft_chapter-fixture'))).toBe(JSON.stringify(parsed))
  await page.reload()
  const confirm = page.getByRole('button', { name: 'Xác nhận chuyển giao nhiệm kỳ', exact: false })
  await expect(confirm).toBeVisible()
  await page.getByPlaceholder('Dán link Google Sheet...').fill('https://docs.google.com/spreadsheets/d/fixture/edit')
  await page.locator('input[type=datetime-local]').fill('2027-01-15T10:30')
  await confirm.click()
  await expect.poll(() => scheduledPayload?.termNumber).toBe(3)
  expect(scheduledPayload).toMatchObject({ sourceUrl: 'https://docs.google.com/spreadsheets/d/fixture/edit',
    items: [{ userId: 'member-fixture', displayName: 'Fixture member', departmentUnitId: 'dept-fixture', positionId: 'position-fixture', isPrimary: true }] })
  expect(new Date(scheduledPayload.effectiveAt).toISOString()).toBe(scheduledPayload.effectiveAt)
  await expect(page.getByText('Fixture transfer rejected', { exact: true }).first()).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('bbe_term_transition_draft_chapter-fixture'))).not.toBeNull()
  reject = false
  await confirm.click()
  await expect.poll(() => page.evaluate(() => localStorage.getItem('bbe_term_transition_draft_chapter-fixture'))).toBeNull()
  await expect(confirm).toHaveCount(0)
})

test('term history opens existing roster details', async ({ page, context }) => {
  await fixture(page, context, url => {
    if (url.pathname.endsWith('/current-roster')) return { body: roster() }
    if (url.pathname.endsWith('/reorganizations')) return { body: { items: [{ id: 'batch-past', termNumber: 1, status: 'APPLIED',
      appliedAt: '2026-01-01T00:00:00Z', itemCount: 1, items: [{ userId: 'past-member', displayName: 'Past fixture member', departmentName: 'Chủ Tịch', isLead: true }] }] } }
  })
  await page.goto('/chapter-manager/term-transition')
  await page.getByRole('button', { name: 'Lịch sử nhiệm kỳ', exact: false }).click()
  await expect(page.getByText('Đã áp dụng', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Xem cơ cấu', exact: false }).click()
  await expect(page.getByRole('dialog').getByRole('link', { name: 'Past fixture member' })).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: 'Đóng', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('scheduled term preserves apply errors and cancel confirmation', async ({ page, context }) => {
  let batch: any = { id: 'batch-fixture', termNumber: 3, totalItems: 1, effectiveAt: new Date(Date.now() + 3600_000).toISOString(), newTerm: [] }
  const actions: string[] = []
  await fixture(page, context, (url, request) => {
    if (url.pathname.endsWith('/current-roster')) return { body: roster(batch) }
    if (url.pathname.endsWith('/reorganizations/batch-fixture')) {
      actions.push(request.method())
      if (request.method() === 'POST') return { status: 409, body: { error: { code: 'FIXTURE_CONFLICT', message: 'Fixture apply conflict' } } }
      batch = null
      return { body: { canceled: true } }
    }
  })
  await page.goto('/chapter-manager/term-transition')
  await expect(page.getByText('Còn lại:', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Áp dụng ngay bây giờ', exact: false }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Áp dụng ngay', exact: false }).click()
  await expect(page.getByText('Fixture apply conflict', { exact: true }).first()).toBeVisible()
  expect(actions).toEqual(['POST'])
  await expect(page.getByRole('button', { name: 'Hủy lịch này', exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'Hủy lịch này', exact: false }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Hủy', exact: false }).last().click()
  await expect.poll(() => actions).toEqual(['POST', 'DELETE'])
  await expect(page.getByRole('button', { name: 'Hủy lịch này', exact: false })).toHaveCount(0)
})

test('term countdown expiry refreshes roster without posting an apply mutation', async ({ page, context }) => {
  const now = new Date('2026-10-28T00:00:00Z')
  await page.clock.install({ time: now })
  let reads = 0, mutations = 0
  await fixture(page, context, (url, request) => {
    if (url.pathname.endsWith('/current-roster')) {
      reads++
      return { body: roster({ id: 'batch-fixture', termNumber: 3, totalItems: 1, effectiveAt: new Date(now.getTime() + 60_000).toISOString(), newTerm: [] }) }
    }
    if (request.method() !== 'GET') mutations++
  })
  await page.goto('/chapter-manager/term-transition')
  await expect(page.getByText('Còn lại:', { exact: true })).toBeVisible()
  await page.clock.fastForward(61_000)
  await expect(page.getByText('Đã đến giờ hiệu lực! Đang tự động chuyển giao...', { exact: true })).toBeVisible()
  await expect.poll(() => reads).toBeGreaterThan(1)
  expect(mutations).toBe(0)
})
