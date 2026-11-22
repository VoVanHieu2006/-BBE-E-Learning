import { expect, test, type Page } from '@playwright/test'
import { createCourse, createLearner, starBalance, watchWholeVideo, type Learner } from '../support/fixtures'
import { fakeYouTube, settle, signIn, watchProblems } from '../support/ui'

// Intent: docs/business-rules.md "Học video", "Quiz", "Sao". The learner only uses the screen; YouTube itself is the
// single stand-in (support/ui.ts), so the real player, heartbeats and server anti-cheat decide every outcome.
const DURATION = 12

async function open(page: Page, learner: Learner) {
  await signIn(page, learner.email, learner.password)
  await expect(page).toHaveURL(/\/student\/dashboard/, { timeout: 20_000 })
}
async function answerAll(page: Page, option: 'Đúng' | 'Sai A') {
  const choices = page.getByRole('radio', { name: option, exact: true })
  await expect(choices.first()).toBeVisible({ timeout: 20_000 })
  for (const choice of await choices.all()) await choice.check()
}
async function startQuiz(page: Page) {
  await page.getByRole('button', { name: /Bắt đầu làm bài/ }).click()
  await page.getByRole('button', { name: /Tôi đã hiểu, Bắt đầu/ }).click()
}

test.describe('Hành trình học viên', () => {
  test('đăng nhập → mở khóa → xem hết video → nhận sao → làm quiz đạt → mở bài tiếp theo → thấy sao trong lịch sử', async ({ page, request }) => {
    test.setTimeout(150_000)
    const learner = await createLearner(request)
    const course = await createCourse(request, { lessons: [{ durationSeconds: DURATION, quiz: { questions: 3 } }, { durationSeconds: DURATION }] })
    const problems = watchProblems(page)
    await page.addInitScript((seconds) => { (window as any).__ytDuration = seconds }, DURATION)
    await fakeYouTube(page)
    await open(page, learner)
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Chào mừng')

    await page.goto(`/student/courses/${course.courseId}`)
    await expect(page.getByRole('heading', { name: course.title })).toBeVisible()
    await expect(page.getByText('Cần hoàn thành bài trước'), 'bài 2 phải hiện là đang khóa và nói lý do').toBeVisible()
    await page.getByRole('link', { name: /Học bài này/ }).click()
    await expect(page).toHaveURL(new RegExp(course.lessons[0].lessonId))

    // Before watching: no forward seek, no quiz.
    await expect(page.getByRole('button', { name: '10s ↻' })).toBeDisabled()
    await page.getByRole('button', { name: /Bài kiểm tra/ }).click()
    await expect(page.getByRole('button', { name: /Còn thiếu .* hãy để video phát hết/ })).toBeDisabled()
    await expect(page.getByRole('button', { name: /🔒 Bài tiếp theo/ }), 'nút sang bài sau phải hiện là đang khóa').toBeVisible()
    await page.getByRole('button', { name: /🔒 Bài tiếp theo/ }).click()
    await expect(page).toHaveURL(new RegExp(course.lessons[0].lessonId))

    await page.getByRole('button', { name: '▶', exact: true }).click()
    await expect(page.getByText('Đã xem hết video (100%)')).toBeVisible({ timeout: 40_000 })
    await expect(page.getByText(/Hoàn thành video, nhận Star/)).toBeVisible()
    expect(await starBalance(learner), 'video 12 giây thưởng đúng 1 sao').toBe(1)

    await page.getByRole('button', { name: /Bài kiểm tra/ }).click()
    await page.getByRole('button', { name: /Vào làm bài kiểm tra/ }).click()
    await expect(page).toHaveURL(/\/quiz$/)
    await expect(page.getByText('Đạt từ 85% để vượt qua bài học')).toBeVisible()
    await startQuiz(page)
    await answerAll(page, 'Đúng')
    await expect(page.getByText('Đã làm 3/3')).toBeVisible()
    await page.getByRole('button', { name: /Nộp bài kiểm tra/ }).click()
    await expect(page.getByText(/Đạt yêu cầu \(Passed\)/)).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('body')).toContainText('100%')
    expect(await starBalance(learner), '1 sao video + 3 sao quiz').toBe(4)

    await page.goto(`/student/courses/${course.courseId}`)
    await expect(page.getByText('Cần hoàn thành bài trước'), 'bài 2 phải được mở sau khi đạt quiz').toHaveCount(0)
    await expect(page.getByRole('link', { name: /Bài 2/ })).toBeVisible()

    await page.goto('/student/stars')
    await expect(page.locator('main').first()).toContainText(course.title)
    await expect(page.locator('main').first()).toContainText(/4/)
    await page.goto('/student/dashboard')
    await expect(page.locator('main').first()).toContainText(/Star của bạn\s*4/)
    expect(problems.console, 'lỗi console trong hành trình học').toEqual([])
    expect(problems.failedRequests).toEqual([])
  })

  test('làm quiz chưa đạt: nói rõ điểm, mốc 85% và thời gian chờ; không cộng sao; bài tiếp theo vẫn khóa', async ({ page, request }) => {
    const learner = await createLearner(request)
    const course = await createCourse(request, { lessons: [{ durationSeconds: 40, quiz: { questions: 3 } }, {}] })
    await watchWholeVideo(learner, course.lessons[0].lessonId, 40)
    const before = await starBalance(learner)
    await open(page, learner)
    await page.goto(`/student/learning/${course.lessons[0].lessonId}/quiz`)
    await startQuiz(page)
    await answerAll(page, 'Sai A')
    await page.getByRole('button', { name: /Nộp bài kiểm tra/ }).click()
    await expect(page.getByText('Chưa đạt điểm tối thiểu')).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('body')).toContainText('85%')
    await expect(page.locator('body')).toContainText(/2 phút/)
    expect(await starBalance(learner)).toBe(before)
    await page.goto(`/student/courses/${course.courseId}`)
    await expect(page.getByText('Cần hoàn thành bài trước')).toBeVisible()
  })

  test('hủy bài giữa chừng phải hỏi lại, và hủy xong không tính điểm', async ({ page, request }) => {
    const learner = await createLearner(request)
    const course = await createCourse(request, { lessons: [{ durationSeconds: 40, quiz: { questions: 3 } }] })
    await watchWholeVideo(learner, course.lessons[0].lessonId, 40)
    await open(page, learner)
    await page.goto(`/student/learning/${course.lessons[0].lessonId}/quiz`)
    await startQuiz(page)
    await answerAll(page, 'Đúng')
    await page.getByRole('button', { name: /Hủy bài kiểm tra/ }).click()
    await expect(page.getByText('Xác nhận hủy bài kiểm tra?')).toBeVisible()
    await page.getByRole('button', { name: 'Xác nhận hủy' }).click()
    await expect(page.getByRole('radio')).toHaveCount(0)
    expect((await learner.api.get(`/api/v1/assessments/${course.lessons[0].assessmentId}/attempts/me`)).body.passed ?? false).toBe(false)
  })

  test('gõ thẳng địa chỉ bài đang khóa: thấy lý do và đường quay lại, không thấy video', async ({ page, request }) => {
    const learner = await createLearner(request)
    const course = await createCourse(request, { lessons: [{}, {}] })
    await fakeYouTube(page)
    await open(page, learner)
    await page.goto(`/student/learning/${course.lessons[1].lessonId}`)
    await expect(page.getByRole('heading', { name: 'Bài học đang bị khóa' })).toBeVisible()
    await expect(page.getByText(/cần hoàn thành/i).first()).toBeVisible()
    await expect(page.getByRole('link', { name: 'Về lộ trình khóa học' })).toBeVisible()
    await expect(page.locator('[data-video-controls]')).toHaveCount(0)
  })

  test('xem dở rồi tải lại trang: tiến độ được giữ, không hiện 100% khi chưa xong', async ({ page, request }) => {
    test.setTimeout(120_000)
    const learner = await createLearner(request)
    const course = await createCourse(request, { lessons: [{ durationSeconds: 60 }] })
    await page.addInitScript(() => { (window as any).__ytDuration = 60 })
    await fakeYouTube(page)
    await open(page, learner)
    await page.goto(`/student/learning/${course.lessons[0].lessonId}`)
    await page.getByRole('button', { name: '▶', exact: true }).click()
    await expect.poll(async () => (await learner.api.get(`/api/v1/lessons/${course.lessons[0].lessonId}/progress`)).body.furthestWatchedPositionSeconds ?? 0, { timeout: 40_000 }).toBeGreaterThan(3)
    await page.reload()
    await settle(page)
    await expect(page.getByText('Đã xem hết video (100%)')).toHaveCount(0)
    await expect(page.locator('body')).not.toContainText('Tháng này: 100%')
    expect(await starBalance(learner), 'chưa xem hết thì chưa có sao').toBe(0)
  })

  test('đổi tên hiển thị trong hồ sơ: lưu xong thấy ngay ở lời chào trang chủ', async ({ page, request }) => {
    const learner = await createLearner(request)
    await open(page, learner)
    await page.goto('/student/profile')
    const name = `Học Viên ${Date.now().toString(36)}`
    await page.getByPlaceholder('Ví dụ: Nguyễn Minh Anh').fill(name)
    await page.getByRole('button', { name: 'Lưu hồ sơ' }).click()
    await expect(page.getByText(/đã lưu|thành công|đã cập nhật/i).first()).toBeVisible()
    await page.goto('/student/dashboard')
    await expect(page.getByRole('heading', { level: 1 })).toContainText(name)
  })

  test('bảng xếp hạng: học viên tìm thấy chính mình, không thấy email người khác', async ({ page, request }) => {
    const learner = await createLearner(request)
    const course = await createCourse(request, { lessons: [{ durationSeconds: 600 }] })
    await watchWholeVideo(learner, course.lessons[0].lessonId, 600)
    await open(page, learner)
    await page.goto('/student/leaderboard')
    await expect(page.getByRole('heading', { name: 'Bảng Xếp Hạng Thi Đua' })).toBeVisible()
    await settle(page)
    const text = await page.locator('main').first().innerText()
    expect(text).not.toMatch(/[\w.+-]+@(?!e2e\.bbe\.test)[\w-]+\.[\w.]+/)
    await expect(page.getByRole('button', { name: /Khối DNA/ }), 'thành viên Chapter không có bảng DNA').toHaveCount(0)
  })
})
