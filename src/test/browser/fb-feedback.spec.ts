import { expect, test, type Page, type BrowserContext } from '@playwright/test'
import { SignJWT } from 'jose'

const adminId = '11111111-1111-4111-8111-111111111111'
async function admin(page: Page, context: BrowserContext, respond: (url: URL) => any) {
  const secret = process.env.JWT_ACCESS_SECRET
  if (secret !== 'fb-fixture-only-signing-secret-32-bytes') throw new Error('Explicit fixture JWT secret required')
  const token = await new SignJWT({ role: 'ADMIN' }).setProtectedHeader({ alg: 'HS256' }).setSubject(adminId).setExpirationTime('10m').sign(new TextEncoder().encode(secret))
  await context.addCookies([{ name: 'accessToken', value: token, url: 'http://127.0.0.1:3117', httpOnly: true }])
  await page.addInitScript(({ token, adminId }) => {
    localStorage.setItem('accessToken', token)
    localStorage.setItem('user', JSON.stringify({ id: adminId, role: 'ADMIN', email: 'fb-ui@test.invalid' }))
  }, { token, adminId })
  await page.route('**/api/v1/**', route => {
    const url = new URL(route.request().url())
    const json = respond(url) || (url.pathname.endsWith('/auth/me') ? { user: { id: adminId, role: 'ADMIN' } } : { items: [], stats: {} })
    return route.fulfill({ json })
  })
}

test('FB04 Admin requests LEAD list and labels unknown roles explicitly', async ({ page, context }) => {
  let leadRequest = false
  await admin(page, context, url => {
    if (url.pathname === '/api/v1/invitations') {
      leadRequest ||= url.searchParams.get('kind') === 'LEAD'
      return { items: [{ id: 'a', email: 'lead@test.invalid', role: 'DNA_LEAD', status: 'ACCEPTED' }, { id: 'b', email: 'unknown@test.invalid', role: 'UNKNOWN', status: 'ACCEPTED' }] }
    }
  })
  await page.goto('/admin/invitations')
  await expect(page.getByRole('cell', { name: 'lead@test.invalid', exact: true })).toBeVisible()
  await expect(page.getByText('Lead DNA', { exact: true })).toBeVisible()
  await expect(page.getByText('UNKNOWN', { exact: true })).toBeVisible()
  expect(leadRequest).toBe(true)
})

test('FB05 history distinguishes CHAPTER, Ban, DNA and DNA_GROUP without dropping Chapter rows', async ({ page, context }) => {
  await admin(page, context, url => url.pathname.endsWith('/organization/history') ? {
    user: { display_name: 'FB learner' }, chapters: [{ id: 'past', name: 'Chapter Phoenix', label: 'Đã rời Chapter', starts_at: '2026-01-01', ends_at: '2026-04-01' }],
    memberships: ['CHAPTER', 'DEPARTMENT', 'DNA', 'DNA_GROUP'].map((type, i) => ({ id: `${i}`, unit: { name: `Unit ${i}`, type }, status: 'ACTIVE', starts_at: '2026-01-01', ends_at: null })), positions: [],
  } : null)
  await page.goto(`/admin/users/${adminId}/organization-history`)
  for (const label of ['Đã rời Chapter', 'CHAPTER', 'Ban (DEPARTMENT)', 'DNA', 'Nhóm DNA (DNA_GROUP)']) await expect(page.getByRole('cell', { name: label, exact: true })).toBeVisible()
  await page.screenshot({ path: 'scratch/fb-fixes/history.png', fullPage: true })
})

test('FB03 all three conditions remain visible when every Chapter is excluded', async ({ page, context }) => {
  await admin(page, context, url => {
    if (url.pathname.endsWith('/learning/periods')) return { months: [], terms: [], seasons: [], scope: { allowedGroups: ['CHAPTER'], isGlobal: true } }
    if (url.pathname === '/api/v1/leaderboard') return { state: 'OPEN', items: [], excluded: [{ chapterId: 'ch', name: 'Chapter FB', currentRosterCount: 2, rosterAsOf: '2026-10-26T00:00:00Z', dataAsOf: '2026-10-25T00:00:00Z', conditions: [
      { kind: 'MEMBER_COUNT', value: 21, threshold: 20, state: 'PASS' },
      { kind: 'CORE_COMPLETION', value: null, threshold: 0.5, state: 'MISSING_DATA', reasonCode: 'CORE_LESSONS_ZERO' },
      { kind: 'KPI', value: null, threshold: ['YELLOW', 'GREEN'], state: 'MISSING_DATA', reasonCode: 'WAITING_KPI' },
    ] }] }
  })
  await page.goto('/leaderboard?group=CHAPTER&periodType=MONTH')
  await expect(page.getByText('Chapter FB', { exact: true })).toBeVisible()
  await expect(page.getByText('Quân số bình quân kỳ:', { exact: false })).toBeVisible()
  await expect(page.getByText('Chưa có mẫu số bài lõi đã xuất bản', { exact: false })).toBeVisible()
  await expect(page.getByText('Chưa có KPI', { exact: false })).toBeVisible()
  await expect(page.getByText('Học viên hiện tại: 2', { exact: false })).toBeVisible()
  await page.screenshot({ path: 'scratch/fb-fixes/chapter-conditions.png', fullPage: true })
})

test('FB08 UI displays backend readiness reason', async ({ page, context }) => {
  await admin(page, context, url => url.pathname === '/api/v1/leaderboard' ? { state: 'PERIOD_UNAVAILABLE', reasonCode: 'MONTH_NOT_CONFIGURED', message: 'Chưa có kỳ thi đua tháng hiện tại.', items: [] } : null)
  await page.goto('/leaderboard')
  await expect(page.getByText('Chưa có kỳ thi đua tháng hiện tại.', { exact: true })).toBeVisible()
})

test('FB01 Admin updates quiz duration from 5 to 7 minutes and persists across reload', async ({ page, context }) => {
  let currentDuration = 5
  await admin(page, context, url => {
    if (url.pathname === '/api/v1/courses/course-fb-01') {
      return {
        id: 'course-fb-01',
        title: 'Course FB 01',
        description: 'Test course',
        status: 'DRAFT',
        sessions: [
          {
            id: 'session-1',
            sessionId: 'session-1',
            title: 'Session 1',
            lessons: [
              {
                id: 'lesson-1',
                lessonId: 'lesson-1',
                title: 'Lesson with Quiz',
                assessment: {
                  id: 'assessment-1',
                  title: 'Quiz 1',
                  questionCount: 1,
                  durationMinutes: currentDuration,
                  questions: [
                    {
                      id: 'q-1',
                      questionText: 'Question 1',
                      type: 'MULTIPLE_CHOICE',
                      points: 10,
                      durationSeconds: 60,
                      options: [
                        { id: 'opt-1', optionText: 'A', isCorrect: true },
                        { id: 'opt-2', optionText: 'B', isCorrect: false },
                      ],
                    },
                  ],
                },
              },
            ],
          },
        ],
      }
    }
    if (url.pathname === '/api/v1/lessons/lesson-1/assessment') {
      return {
        id: 'assessment-1',
        lessonId: 'lesson-1',
        title: 'Quiz 1',
        description: '',
        questionCount: 1,
        durationMinutes: currentDuration,
        questions: [
          {
            id: 'q-1',
            questionText: 'Question 1',
            type: 'MULTIPLE_CHOICE',
            points: 10,
            durationSeconds: 60,
            options: [
              { id: 'opt-1', optionText: 'A', isCorrect: true },
              { id: 'opt-2', optionText: 'B', isCorrect: false },
            ],
          },
        ],
      }
    }
  })

  await page.route('**/api/v1/lessons/lesson-1/assessment', async route => {
    if (route.request().method() === 'POST') {
      const data = route.request().postDataJSON()
      currentDuration = Number(data.durationMinutes) || 7
      return route.fulfill({
        json: {
          id: 'assessment-1',
          lessonId: 'lesson-1',
          title: data.title || 'Quiz 1',
          questionCount: 1,
          durationMinutes: currentDuration,
          questions: data.questions || [],
        },
      })
    }
    return route.fulfill({
      json: {
        id: 'assessment-1',
        lessonId: 'lesson-1',
        title: 'Quiz 1',
        questionCount: 1,
        durationMinutes: currentDuration,
        questions: [],
      },
    })
  })

  await page.goto('/admin/courses/course-fb-01/edit')
  await page.getByText('Session 1').click()
  await expect(page.getByText(/5 phút/)).toBeVisible()

  await page.getByRole('button', { name: 'Sửa Quiz' }).click()

  const durationInput = page.locator('label:has-text("Thời gian (phút)") input')
  await expect(durationInput).toBeVisible()
  await durationInput.fill('7')

  await page.getByRole('button', { name: 'Lưu bài kiểm tra' }).click()

  await expect(page.getByText(/7 phút/)).toBeVisible()

  await page.reload()
  await page.getByText('Session 1').click()
  await expect(page.getByText(/7 phút/)).toBeVisible()
})
