import { expect, test, Page, BrowserContext } from '@playwright/test'
import { SignJWT } from 'jose'

const SHOT_DIR = process.env.FOUR_ISSUES_SHOT_DIR || 'test-results/four-issues'
const SECRET = 'four-issues-local-mock-secret-32b'
const USER_ID = '00000000-0000-4000-8000-000000000101'
const CHAPTER_ID = '00000000-0000-4000-8000-000000000201'
const COURSE_ID = '00000000-0000-4000-8000-000000000301'
const SESSION_ID = '00000000-0000-4000-8000-000000000401'
const LESSON_ID = '00000000-0000-4000-8000-000000000501'
const LESSON_NEW_ID = '00000000-0000-4000-8000-000000000502'

async function setAuth(page: Page, context: BrowserContext, role: 'ADMIN' | 'MEMBER') {
  const token = await new SignJWT({ role, authVersion: 0 })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('00000000-0000-4000-8000-000000000099')
    .setExpirationTime('15m')
    .sign(new TextEncoder().encode(SECRET))
  await context.addCookies([{ name: 'accessToken', value: token, url: 'http://127.0.0.1:3125', httpOnly: true }])
  await page.addInitScript(
    ({ token, role }) => {
      localStorage.setItem('accessToken', token)
      localStorage.setItem('user', JSON.stringify({ id: '00000000-0000-4000-8000-000000000099', role, status: 'ACTIVE', displayName: 'Kiểm thử' }))
    },
    { token, role },
  )
}

const mockStarItems = [
  {
    id: 'st-1',
    amount: 1,
    reason: 'COURSE_FINAL_PASS',
    source_type: 'ASSESSMENT',
    awarded_at: '2026-11-27T09:22:00.000Z',
    kind: 'COURSE_FINAL',
    displayTitle: 'Bài thi cuối khóa',
    courseTitle: 'Khóa học chung cho thành viên',
    lessonTitle: null,
    quizTitle: 'Bài thi cuối khóa',
    correctCount: 20,
    totalQuestions: 20,
    attemptNumber: 3,
    detail: 'Vượt qua bài thi cuối khóa: Khóa học chung cho thành viên',
  },
  {
    id: 'st-2',
    amount: 2,
    reason: 'COURSE_FINAL_PASS',
    source_type: 'ASSESSMENT',
    awarded_at: '2026-11-27T08:45:00.000Z',
    kind: 'COURSE_FINAL',
    displayTitle: 'Bài thi cuối khóa',
    courseTitle: 'Khóa học chung cho thành viên',
    lessonTitle: null,
    quizTitle: 'Bài thi cuối khóa',
    correctCount: 19,
    totalQuestions: 20,
    attemptNumber: 2,
    detail: 'Vượt qua bài thi cuối khóa: Khóa học chung cho thành viên',
  },
  {
    id: 'st-3',
    amount: 17,
    reason: 'COURSE_FINAL_PASS',
    source_type: 'ASSESSMENT',
    awarded_at: '2026-11-27T07:24:00.000Z',
    kind: 'COURSE_FINAL',
    displayTitle: 'Bài thi cuối khóa',
    courseTitle: 'Khóa học chung cho thành viên',
    lessonTitle: null,
    quizTitle: 'Bài thi cuối khóa',
    correctCount: 17,
    totalQuestions: 20,
    attemptNumber: 1,
    detail: 'Vượt qua bài thi cuối khóa: Khóa học chung cho thành viên',
  },
  {
    id: 'st-4',
    amount: 5,
    reason: 'MODULE_QUIZ_PASS',
    source_type: 'ASSESSMENT',
    awarded_at: '2026-11-27T07:18:00.000Z',
    kind: 'LESSON_QUIZ',
    displayTitle: 'TM - Tại sao nhiệm kỳ BBE chỉ có 6 tháng?',
    courseTitle: 'Khóa học chung cho thành viên',
    lessonTitle: 'TM - Tại sao nhiệm kỳ BBE chỉ có 6 tháng?',
    quizTitle: 'Quiz cuối bài',
    correctCount: 5,
    totalQuestions: 5,
    attemptNumber: 1,
    detail: 'Vượt qua bài kiểm tra: Quiz cuối bài · TM - Tại sao nhiệm kỳ BBE chỉ có 6 tháng?',
  },
  {
    id: 'st-5',
    amount: 5,
    reason: 'VIDEO_COMPLETION',
    source_type: 'VIDEO',
    awarded_at: '2026-11-27T07:14:00.000Z',
    kind: 'VIDEO',
    displayTitle: 'TM - Tại sao nhiệm kỳ BBE chỉ có 6 tháng?',
    courseTitle: 'Khóa học chung cho thành viên',
    lessonTitle: 'TM - Tại sao nhiệm kỳ BBE chỉ có 6 tháng?',
    quizTitle: null,
    correctCount: null,
    totalQuestions: null,
    attemptNumber: null,
    detail: 'Hoàn thành video: TM - Tại sao nhiệm kỳ BBE chỉ có 6 tháng? · Khóa học chung cho thành viên',
  },
  {
    id: 'st-6',
    amount: 6,
    reason: 'MODULE_QUIZ_PASS',
    source_type: 'ASSESSMENT',
    awarded_at: '2026-11-26T05:10:00.000Z',
    kind: 'LESSON_QUIZ',
    displayTitle: 'BBE - Lịch sử ra đời',
    courseTitle: 'Khóa học chung cho thành viên',
    lessonTitle: 'BBE - Lịch sử ra đời',
    quizTitle: 'Quiz lịch sử',
    correctCount: null,
    totalQuestions: null,
    attemptNumber: null,
    detail: 'Vượt qua bài kiểm tra: Quiz lịch sử · BBE - Lịch sử ra đời',
  },
]

test('Admin learner profile: KPI card alignment, 100% score, lesson quiz blocker & standardized star log', async ({ page, context }) => {
  await setAuth(page, context, 'ADMIN')
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname
    if (path === '/api/v1/users/me') return route.fulfill({ json: { id: 'admin-1', role: 'ADMIN', status: 'ACTIVE', displayName: 'Admin BBE' } })
    if (path === '/api/v1/users' || path === '/api/v1/admin/users' || path.startsWith('/api/v1/admin/users?')) {
      return route.fulfill({
        json: {
          items: [
            {
              id: USER_ID,
              userId: USER_ID,
              displayName: 'Hướng Dương Hướng Đích',
              email: 'anhahaannguyenphan@gmail.com',
              role: 'MEMBER',
              status: 'ACTIVE',
              chapterId: CHAPTER_ID,
              chapterName: 'BBE FLY CHAPTER',
              departmentName: 'Ban Định Hướng',
              createdAt: '2026-11-26T02:00:00.000Z',
              completedCourses: 1,
              totalCourses: 2,
              overallProgressPercent: 100,
              stars: 762,
            },
          ],
          total: 1,
          page: 1,
          totalPages: 1,
        },
      })
    }
    if (path === '/api/v1/chapters' || path === '/api/v1/admin/chapters') {
      return route.fulfill({ json: { items: [{ id: CHAPTER_ID, name: 'BBE FLY CHAPTER' }] } })
    }
    if (path === '/api/v1/organization/units') {
      return route.fulfill({ json: { items: [] } })
    }
    if (path.includes(`/members/${USER_ID}/course-progress`)) {
      return route.fulfill({
        json: {
          user: {
            userId: USER_ID,
            displayName: 'Hướng Dương Hướng Đích',
            email: 'anhahaannguyenphan@gmail.com',
            status: 'ACTIVE',
            chapterName: 'BBE FLY CHAPTER',
            departmentName: 'Ban Định Hướng',
            joinedAt: '2026-11-26T02:00:00.000Z',
          },
          summary: {
            totalCourses: 2,
            completedCourses: 1,
            completedLessons: 44,
            totalLessons: 44,
            avgProgress: 100,
            avgQuizScore: 98,
            stars: 762,
          },
          courses: [
            {
              courseId: COURSE_ID,
              title: 'Khóa học chung cho thành viên',
              totalLessons: 41,
              completedLessons: 41,
              progressPercent: 100,
              allVideosDone: true,
              hasAssessment: true,
              hasFinalAssessment: true,
              hasLessonAssessments: true,
              lessonAssessmentsPassed: false,
              totalLessonAssessments: 41,
              passedLessonAssessments: 32,
              latestAttempt: { score: 1, scorePercent: 100, passed: true, submittedAt: '2026-11-27T10:47:12.000Z' },
              isCompleted: false,
              state: 'IN_PROGRESS',
            },
            {
              courseId: '00000000-0000-4000-8000-000000000302',
              title: 'Khóa học chung cho LT',
              totalLessons: 3,
              completedLessons: 3,
              progressPercent: 100,
              allVideosDone: true,
              hasAssessment: false,
              hasFinalAssessment: false,
              hasLessonAssessments: false,
              lessonAssessmentsPassed: true,
              totalLessonAssessments: 0,
              passedLessonAssessments: 0,
              latestAttempt: null,
              isCompleted: true,
              state: 'COMPLETED',
            },
          ],
          learningDetail: [
            {
              courseId: COURSE_ID,
              title: 'Khóa học chung cho thành viên',
              finalAssessment: {
                assessmentId: 'fa-1',
                title: 'Bài thi cuối khóa',
                attemptCount: 3,
                stars: 20,
                latestAttempt: {
                  attemptId: 'att-3',
                  number: 3,
                  scorePercent: 100,
                  passed: true,
                  status: 'SUBMITTED',
                  submittedAt: '2026-11-27T10:47:12.000Z',
                },
              },
              modules: [
                {
                  moduleId: 'm-3',
                  title: 'Buổi 3: Hoạt động cốt lõi',
                  order: 2,
                  lessons: [
                    {
                      lessonId: 'l-1',
                      title: 'BBE - HDCL Leader Team',
                      order: 0,
                      video: { watchedPercent: 100, completed: true, stars: 24 },
                      quiz: { everPassed: true, latestAttempt: { scorePercent: 100, passed: true } },
                    },
                    {
                      lessonId: 'l-2',
                      title: 'BBE - HD Networking',
                      order: 1,
                      video: { watchedPercent: 100, completed: true, stars: 12 },
                      quiz: { everPassed: true, latestAttempt: { scorePercent: 80, passed: false } },
                    },
                    {
                      lessonId: 'l-3',
                      title: 'BBE - HDCL Giới thiệu 30s',
                      order: 2,
                      video: { watchedPercent: 100, completed: true, stars: 9 },
                      quiz: { everPassed: false, latestAttempt: null },
                    },
                  ],
                },
              ],
            },
          ],
        },
      })
    }
    if (path === `/api/v1/admin/users/${USER_ID}/stars`) {
      return route.fulfill({
        json: {
          user: { id: USER_ID, displayName: 'Hướng Dương Hướng Đích', email: 'anhahaannguyenphan@gmail.com', role: 'MEMBER', status: 'ACTIVE' },
          balance: 762,
          ledgerTotal: 762,
          filteredTotal: 36,
          availableMonths: [{ key: '2026-11', label: 'Tháng 11/2026' }],
          filters: { month: null, source: 'ALL' },
          items: mockStarItems,
          page: 1,
          limit: 20,
          totalItems: mockStarItems.length,
          totalPages: 1,
        },
      })
    }
    return route.fulfill({ json: { items: [] } })
  })

  await page.goto('/admin/users')
  await page.getByText('Hướng Dương Hướng Đích').first().click()

  // Verify Issue #1 + #3 on Profile Progress tab
  await expect(page.getByText('✓ Đã đạt (100%)')).toBeVisible()
  await expect(page.getByText('32/41 bài đạt (còn 9 chưa đạt)')).toBeVisible()
  await expect(page.getByText('Xem lịch sử sao →')).toBeVisible()

  // Expand course detail to verify everPassed retake display
  await page.locator('details summary', { hasText: 'Khóa học chung cho thành viên' }).click()
  await expect(page.getByText('✓ Đã đạt (lần mới nhất: 80%)')).toBeVisible()

  // Capture screenshot 1: Admin Learner Profile (KPI cards + 100% + lesson quiz blocker + retake)
  await page.screenshot({ path: `${SHOT_DIR}/proof_01_admin_profile_kpi_progress.png`, fullPage: true })

  // Switch to Star History tab
  await page.getByRole('tab', { name: /Lịch sử nhận sao/ }).click()
  await expect(page.getByText('20/20 câu')).toBeVisible()
  await expect(page.getByText('19/20 câu')).toBeVisible()
  await expect(page.getByText('17/20 câu')).toBeVisible()
  await expect(page.getByText('5/5 câu')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Điều chỉnh Admin' })).toHaveCount(0)

  // Capture screenshot 2: Admin Standardized Star History
  await page.screenshot({ path: `${SHOT_DIR}/proof_02_admin_star_history.png`, fullPage: true })
})

test('Student stars page + Student course NewContentChip (Bài mới & Quiz mới)', async ({ page, context }) => {
  await setAuth(page, context, 'MEMBER')
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/v1/users/me') return route.fulfill({ json: { id: USER_ID, role: 'MEMBER', status: 'ACTIVE', displayName: 'Hướng Dương' } })
    if (path === '/api/v1/stars/me') {
      return route.fulfill({
        json: { balance: 762, items: mockStarItems, page: 1, limit: 20, totalItems: mockStarItems.length, totalPages: 1 },
      })
    }
    if (path === '/api/v1/learning/me') {
      return route.fulfill({ json: { programs: [], completedLessonIds: [], inProgressLessonIds: [], unlockedLessonIds: [], lessonStates: {}, notices: [] } })
    }
    if (path === `/api/v1/courses/${COURSE_ID}`) {
      return route.fulfill({
        json: {
          id: COURSE_ID,
          courseId: COURSE_ID,
          title: 'Khóa học chung cho thành viên',
          description: 'Chương trình đào tạo nền tảng BBE.',
          visibility: 'PRIVATE',
          status: 'PUBLISHED',
          finalAssessment: { id: 'fa-1', title: 'Bài thi cuối khóa', questionCount: 20, durationMinutes: 30 },
          sessions: [
            {
              id: SESSION_ID,
              sessionId: SESSION_ID,
              title: 'Buổi 3: Hoạt động cốt lõi',
              lessons: [
                {
                  id: LESSON_ID,
                  lessonId: LESSON_ID,
                  title: 'TM - Tại sao nhiệm kỳ BBE chỉ có 6 tháng?',
                  video: { id: 'v1', durationSeconds: 300 },
                  documents: [],
                  assessment: { id: 'q1', title: 'Quiz bài học', questionCount: 5 },
                },
                {
                  id: LESSON_NEW_ID,
                  lessonId: LESSON_NEW_ID,
                  title: 'BBE - Quy định mới cập nhật',
                  video: { id: 'v2', durationSeconds: 240 },
                  documents: [],
                  assessment: null,
                },
              ],
            },
          ],
        },
      })
    }
    if (path === `/api/v1/courses/${COURSE_ID}/my-progress`) {
      return route.fulfill({
        json: {
          courseId: COURSE_ID,
          totalLessons: 2,
          completedLessons: 1,
          progressPercentage: 50,
          sessions: [
            {
              sessionId: SESSION_ID,
              lessons: [
                { lessonId: LESSON_ID, id: LESSON_ID, completed: true, lessonCompleted: true, videoCompleted: true, canView: true, canAssess: true, assessmentPassed: false, isNew: false, quizIsNew: true },
                { lessonId: LESSON_NEW_ID, id: LESSON_NEW_ID, completed: false, lessonCompleted: false, videoCompleted: false, canView: true, canAssess: false, assessmentPassed: false, isNew: true, quizIsNew: false },
              ],
            },
          ],
        },
      })
    }
    return route.fulfill({ json: { items: [] } })
  })

  // 1. Student Star History
  await page.goto('/student/stars')
  await expect(page.getByText('20/20 câu')).toBeVisible()
  await expect(page.getByText('5/5 câu')).toBeVisible()
  await page.screenshot({ path: `${SHOT_DIR}/proof_03_student_star_history.png`, fullPage: true })

  // 2. Student Course Detail with Bài mới + Quiz mới
  await page.goto(`/student/courses/${COURSE_ID}`)
  await expect(page.getByText('Quiz mới', { exact: true })).toBeVisible()
  await expect(page.getByText('Bài mới', { exact: true })).toBeVisible()
  await page.screenshot({ path: `${SHOT_DIR}/proof_04_new_lesson_quiz_badges.png`, fullPage: true })
})
