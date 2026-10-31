import { expect, test, type Page, type BrowserContext } from '@playwright/test'
import { SignJWT } from 'jose'

const memberId = '22222222-2222-4222-8222-222222222222'
const QUESTION_COUNT = 12

function questions() {
  return Array.from({ length: QUESTION_COUNT }, (_, i) => ({
    questionId: `q${i + 1}`,
    questionText: `Câu hỏi kiểm thử số ${i + 1} ${'nội dung dài để trang cuộn được. '.repeat(4)}`,
    options: [0, 1, 2].map((j) => ({ optionId: `q${i + 1}-o${j}`, optionText: `Phương án ${j + 1}` })),
  }))
}

type QuizCalls = { saved: any[]; submitted: any[]; cancelled: number }

async function openQuiz(page: Page, secondsLeft: number): Promise<QuizCalls> {
  const calls: QuizCalls = { saved: [], submitted: [], cancelled: 0 }
  await page.addInitScript(({ memberId }) => {
    localStorage.setItem('accessToken', 'quiz-ui-fixture-token')
    localStorage.setItem('user', JSON.stringify({ id: memberId, role: 'MEMBER', email: 'quiz-ui@test.invalid' }))
  }, { memberId })
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const p = url.pathname
    if (p === '/api/v1/lessons/lesson-ui') return route.fulfill({ json: {
      id: 'lesson-ui', title: 'Bài học kiểm thử', video: { durationSeconds: 0 }, session: { courseTitle: 'Khoá kiểm thử' },
      assessment: { assessmentId: 'assess-ui', title: 'Quiz kiểm thử', questionCount: QUESTION_COUNT, durationMinutes: 1, passingPercent: 85 },
    } })
    if (p === '/api/v1/lessons/lesson-ui/progress') return route.fulfill({ json: { canAssess: true, completed: false, progressPercentage: 100 } })
    if (p === '/api/v1/assessments/assess-ui/attempts/me') return route.fulfill({ json: { items: [] } })
    if (p === '/api/v1/assessments/assess-ui/attempts' && request.method() === 'POST') return route.fulfill({ json: {
      attemptId: 'attempt-ui', durationMinutes: 1, expiresAt: new Date(Date.now() + secondsLeft * 1000).toISOString(), questions: questions(),
    } })
    if (p === '/api/v1/attempts/attempt-ui/answers') { calls.saved.push(request.postDataJSON()); return route.fulfill({ json: { saved: true } }) }
    if (p === '/api/v1/attempts/attempt-ui/submit') {
      calls.submitted.push(request.postDataJSON())
      return route.fulfill({ json: { attemptId: 'attempt-ui', score: 1, totalPoints: QUESTION_COUNT, scorePercent: 8, passed: false, starReward: { awarded: false, amount: 0 }, answers: [] } })
    }
    if (p === '/api/v1/attempts/attempt-ui/cancel') { calls.cancelled += 1; return route.fulfill({ json: { success: true, status: 'CANCELLED' } }) }
    return route.fulfill({ json: { items: [] } })
  })
  await page.goto('/student/learning/lesson-ui/quiz')
  await page.getByRole('button', { name: /Bắt đầu làm bài/ }).click()
  await page.getByRole('button', { name: 'Tôi đã hiểu, Bắt đầu!' }).click()
  await expect(page.locator('#quiz-question-12')).toBeVisible()
  return calls
}

async function inViewport(page: Page, testId: string) {
  const box = await page.getByTestId(testId).boundingBox()
  const viewport = page.viewportSize()!
  return Boolean(box && box.y >= 0 && box.y + box.height <= viewport.height)
}

test('timer stays visible while scrolling and navigator tracks answered/flagged questions', async ({ page, isMobile }) => {
  await openQuiz(page, 600)
  await page.locator('#quiz-question-12').scrollIntoViewIfNeeded()
  await page.mouse.wheel(0, 4000)
  await expect(page.getByTestId('quiz-timer')).toContainText(/Còn lại \d\d:\d\d/)
  expect(await inViewport(page, 'quiz-timer')).toBe(true)

  if (isMobile) await page.getByRole('button', { name: /^Câu hỏi/ }).click()
  const nav = page.getByTestId('quiz-navigator')
  await expect(nav.getByRole('listitem')).toHaveCount(QUESTION_COUNT)
  await expect(page.getByTestId('quiz-nav-1')).toHaveAttribute('data-state', 'unanswered')

  // Left click jumps to the question.
  await page.getByTestId('quiz-nav-10').click()
  await expect.poll(async () => {
    const box = await page.locator('#quiz-question-10').boundingBox()
    return box ? box.y < page.viewportSize()!.height / 2 && box.y > 0 : false
  }).toBe(true)

  // Answering colours the cell.
  await page.locator('#quiz-question-10').getByText('Phương án 2').click()
  if (isMobile) await page.getByRole('button', { name: /^Câu hỏi/ }).click()
  await expect(page.getByTestId('quiz-nav-10')).toHaveAttribute('data-state', 'answered')
  await expect(page.getByTestId('quiz-answered-count')).toHaveText('Đã làm 1/12')

  if (isMobile) {
    // Touch alternative: the flag button on the question card.
    await page.getByTestId('quiz-flag-3').click()
  } else {
    await page.getByTestId('quiz-nav-3').click({ button: 'right' })
  }
  if (isMobile && !(await nav.isVisible())) await page.getByRole('button', { name: /^Câu hỏi/ }).click()
  await expect(page.getByTestId('quiz-nav-3')).toHaveAttribute('data-state', 'flagged')
})

test('right click flags without opening the browser menu (desktop)', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Right click is a desktop gesture')
  await openQuiz(page, 600)
  const prevented = await page.getByTestId('quiz-nav-5').evaluate((el) => {
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 })
    el.dispatchEvent(event)
    return event.defaultPrevented
  })
  expect(prevented).toBe(true)
  await expect(page.getByTestId('quiz-nav-5')).toHaveAttribute('data-state', 'flagged')
  await page.getByTestId('quiz-nav-5').click({ button: 'right' })
  await expect(page.getByTestId('quiz-nav-5')).toHaveAttribute('data-state', 'unanswered')
})

test('time up locks answers and submits from the modal', async ({ page }) => {
  const calls = await openQuiz(page, 4)
  await page.locator('#quiz-question-1').getByText('Phương án 1').click()
  const modal = page.getByTestId('quiz-timeup-modal')
  await expect(modal).toBeVisible({ timeout: 10000 })
  await expect(modal).toContainText('Bạn đã hết thời gian')
  await expect(page.locator('#quiz-question-2 input[type="radio"]').first()).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(modal).toBeVisible()
  await modal.getByRole('button', { name: 'Nộp bài', exact: true }).click()
  await expect(modal).toBeHidden()
  await expect(page.getByText('Chưa đạt điểm tối thiểu')).toBeVisible()
  expect(calls.submitted).toHaveLength(1)
  expect(calls.submitted[0].answers).toEqual({ q1: 'q1-o0' })
  expect(calls.saved.length).toBeGreaterThan(0)
})

test('time up cancel discards the attempt', async ({ page }) => {
  const calls = await openQuiz(page, 3)
  const modal = page.getByTestId('quiz-timeup-modal')
  await expect(modal).toBeVisible({ timeout: 10000 })
  await modal.getByRole('button', { name: 'Hủy bài', exact: true }).click()
  await expect.poll(() => calls.cancelled).toBe(1)
  expect(calls.submitted).toHaveLength(0)
})

async function chapterLead(page: Page, context: BrowserContext) {
  const secret = process.env.JWT_ACCESS_SECRET
  const token = await new SignJWT({ role: 'CHAPTER_LEADER' }).setProtectedHeader({ alg: 'HS256' }).setSubject(memberId).setExpirationTime('10m').sign(new TextEncoder().encode(secret))
  await context.addCookies([{ name: 'accessToken', value: token, url: test.info().project.use.baseURL!, httpOnly: true }])
  await page.addInitScript(({ token, memberId }) => {
    localStorage.setItem('accessToken', token)
    localStorage.setItem('user', JSON.stringify({ id: memberId, role: 'CHAPTER_LEADER', chapterId: 'chapter-ui', chapterName: 'Chapter UI' }))
  }, { token, memberId })
}

test('chapter lead invites a pasted list and sees a result per email', async ({ page, context }) => {
  test.skip(process.env.JWT_ACCESS_SECRET !== 'quiz-fixture-only-signing-secret-32b', 'Needs a server started with the fixture JWT secret')
  await chapterLead(page, context)
  let bulkBody: any = null
  await page.route('**/api/v1/**', (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/v1/invitations/member/bulk') {
      bulkBody = route.request().postDataJSON()
      return route.fulfill({ json: { results: [
        { email: 'bad-email', status: 'INVALID' },
        { email: 'a@test.invalid', status: 'DUPLICATE' },
        { email: 'a@test.invalid', status: 'SENT' },
        { email: 'member@test.invalid', status: 'ALREADY_MEMBER' },
        { email: 'pending@test.invalid', status: 'ALREADY_INVITED' },
      ], summary: { sent: 1 } } })
    }
    return route.fulfill({ json: { items: [] } })
  })
  await page.goto('/chapter-manager/invitations')
  await page.getByRole('button', { name: /Mời thành viên mới/ }).click()
  await page.getByRole('tab', { name: 'Nhiều email' }).click()
  await page.getByLabel('Danh sách email *').fill('A@test.invalid, a@test.invalid; member@test.invalid\npending@test.invalid bad-email')
  await expect(page.getByTestId('bulk-invite-preview')).toContainText('3 hợp lệ')
  await expect(page.getByTestId('bulk-invite-preview')).toContainText('1 không hợp lệ')
  await expect(page.getByTestId('bulk-invite-preview')).toContainText('1 trùng lặp')
  await page.getByRole('button', { name: /Gửi 3 lời mời/ }).click()
  const results = page.getByTestId('bulk-invite-results')
  await expect(results).toContainText('Đã gửi lời mời')
  await expect(results).toContainText('Email không hợp lệ')
  await expect(results).toContainText('Đã có tài khoản / đã là thành viên')
  await expect(results).toContainText('Đã được mời')
  expect(bulkBody.chapterId).toBe('chapter-ui')
})
