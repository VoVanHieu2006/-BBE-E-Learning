import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { createCourse, createLearner, uiDefect } from '../support/fixtures'
import { ACCOUNTS, SEED_PASSWORD } from '../support/seed'
import { auditPage, settle, signInAs } from '../support/ui'

// How the app behaves while a person is actually using it: keyboard only, a slow or failing network, an impatient
// double tap, a narrow phone. Runs at both viewports.
const isPhone = () => test.info().project.name === 'mobile'
const focusRing = (page: Page) => page.evaluate(() => {
  const el = document.activeElement as HTMLElement | null
  if (!el || el === document.body) return 'không có phần tử nào đang được focus'
  const style = getComputedStyle(el)
  const ringed = (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) || style.boxShadow !== 'none'
  return ringed ? '' : `<${el.tagName.toLowerCase()}> ${(el.textContent || el.getAttribute('placeholder') || '').trim().slice(0, 30)} không có viền focus`
})

test.describe('Bàn phím', () => {
  test('đăng nhập được chỉ bằng bàn phím: Tab tới ô email, gõ, Tab, gõ, Enter', async ({ page }) => {
    await page.goto('/login')
    await page.locator('input[type="email"]').focus()
    await page.keyboard.type(ACCOUNTS.member)
    for (let step = 0; step < 3 && !(await page.locator('input[type="password"]').evaluate((input) => input === document.activeElement)); step += 1) await page.keyboard.press('Tab')
    await expect(page.locator('input[type="password"]'), 'từ ô email, Tab tối đa 3 lần phải tới ô mật khẩu').toBeFocused()
    await page.keyboard.type(SEED_PASSWORD)
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/student\/dashboard/, { timeout: 20_000 })
  })

  test('đi bằng phím Tab luôn thấy mình đang ở đâu (có viền focus) trên trang đăng nhập và trang chủ học viên', async ({ page }) => {
    await page.goto('/login')
    const missing: string[] = []
    for (let step = 0; step < 4; step += 1) { await page.keyboard.press('Tab'); const problem = await focusRing(page); if (problem) missing.push(`/login: ${problem}`) }
    await signInAs(page, 'member')
    await settle(page)
    for (let step = 0; step < 10; step += 1) { await page.keyboard.press('Tab'); const problem = await focusRing(page); if (problem) missing.push(`/student/dashboard: ${problem}`) }
    expect(missing).toEqual([])
  })

  test('hộp thoại mời thành viên: mở ra thì con trỏ nằm trong hộp thoại, Tab không lọt ra ngoài, Esc đóng và trả con trỏ về nút đã bấm', async ({ page }) => {
    await signInAs(page, 'chapterLead')
    await page.goto('/chapter-manager/invitations')
    const opener = page.getByRole('button', { name: /Mời thành viên mới/ })
    await opener.click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    for (let step = 0; step < 12; step += 1) {
      await page.keyboard.press('Tab')
      expect(await dialog.evaluate((node) => node.contains(document.activeElement)), `Tab lần ${step + 1} lọt ra ngoài hộp thoại`).toBe(true)
    }
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(opener).toBeFocused()
  })
})

test.describe('Mạng chậm hoặc lỗi', () => {
  test('đang chờ đăng nhập thì nút bị khóa và ghi rõ đang xử lý, bấm thêm không gửi lần hai', async ({ page }) => {
    let calls = 0
    await page.route('**/api/v1/auth/login', async (route) => { calls += 1; await new Promise((resolve) => setTimeout(resolve, 1500)); await route.continue() })
    await page.goto('/login')
    await page.locator('input[type="email"]').fill(ACCOUNTS.member)
    await page.locator('input[type="password"]').fill(SEED_PASSWORD)
    const submit = page.locator('button[type="submit"]')
    await submit.click()
    await expect(submit).toBeDisabled()
    await expect(submit).toHaveText(/Đang xác thực/)
    await submit.click({ force: true }).catch(() => undefined)
    await expect(page).toHaveURL(/\/student\/dashboard/, { timeout: 20_000 })
    expect(calls).toBe(1)
  })

  test('mất mạng lúc đăng nhập: báo lỗi tiếng Việt, giữ email, nút bấm lại được', async ({ page }) => {
    await page.route('**/api/v1/auth/login', (route) => route.abort('internetdisconnected'))
    await page.goto('/login')
    await page.locator('input[type="email"]').fill(ACCOUNTS.member)
    await page.locator('input[type="password"]').fill(SEED_PASSWORD)
    await page.locator('button[type="submit"]').click()
    await expect(page.getByText(/Lỗi kết nối|Không thể kết nối/)).toBeVisible()
    await expect(page.locator('input[type="email"]')).toHaveValue(ACCOUNTS.member)
    await expect(page.locator('button[type="submit"]')).toBeEnabled()
  })

  uiDefect('BUG-UX-NETWORK-MSG', 'mất mạng lúc đăng nhập: thông báo hoàn toàn bằng tiếng Việt, không kèm câu kỹ thuật "Failed to fetch"', async ({ page }) => {
    await page.route('**/api/v1/auth/login', (route) => route.abort('internetdisconnected'))
    await page.goto('/login')
    await page.locator('input[type="email"]').fill(ACCOUNTS.member)
    await page.locator('input[type="password"]').fill(SEED_PASSWORD)
    await page.locator('button[type="submit"]').click()
    await expect(page.getByText(/Lỗi kết nối|Không thể kết nối/)).toBeVisible()
    await expect(page.locator('body')).not.toContainText(/Failed to fetch|TypeError|NetworkError/)
  })

  const slowData = async (page: Page) => {
    await page.addInitScript(() => sessionStorage.clear())
    await page.route(/\/api\/v1\/(?!auth)/, async (route) => { await new Promise((resolve) => setTimeout(resolve, 2500)); await route.continue() })
  }

  test('trang khóa học tải chậm: hiện trạng thái đang tải, không nháy thông báo "chưa có khóa học", rồi hiện nội dung', async ({ page, request }) => {
    await createCourse(request, { lessons: [{}] })
    await signInAs(page, 'member')
    await settle(page)
    await slowData(page)
    await page.goto('/student/courses')
    await expect(page.locator('.animate-pulse:visible').first().or(page.getByText(/Đang tải/).first())).toBeVisible({ timeout: 2_000 })
    await expect(page.getByText(/Chưa có khóa học/)).toHaveCount(0)
    await expect(page.locator('.animate-pulse:visible')).toHaveCount(0, { timeout: 20_000 })
    await expect(page.getByText(/Mở khóa học/).first()).toBeVisible()
  })

  // Trong lúc chờ dữ liệu, trang hiện sẵn số 0 và cảnh báo như thể đó là dữ liệu thật.
  uiDefect('BUG-UX-LOADING-FALSE-DATA', 'trang khóa học tải chậm: không hiện "0 / 0 khóa" hay cảnh báo "Chưa có Ban" trước khi có dữ liệu thật', async ({ page }) => {
    await signInAs(page, 'member')
    await settle(page)
    await slowData(page)
    await page.goto('/student/courses')
    await expect(page.getByText(/Đang tải/).first()).toBeVisible({ timeout: 2_000 })
    const header = (await page.locator('main').first().innerText()).replace(/\s+/g, ' ')
    expect.soft(header, 'thành viên đã thuộc một ban').not.toContain('Chưa có Ban')
    expect.soft(header).not.toMatch(/0 \/ 0 ?khóa/)
    expect.soft(header).not.toContain('(0/0 bài)')
  })

  uiDefect('BUG-UX-ERROR-AS-EMPTY', 'máy chủ lỗi khi tải danh sách thành viên: Lead được báo là có lỗi, không bị hiểu nhầm là Chapter chưa có ai', async ({ page }) => {
    await signInAs(page, 'chapterLead')
    await page.evaluate(() => sessionStorage.clear())
    await page.route('**/api/v1/**members**', (route) => route.request().method() === 'GET' ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'InternalError' } }) }) : route.continue())
    await page.goto('/chapter-manager/members')
    await settle(page)
    await expect(page.getByText(/Không (thể )?tải|Lỗi|thử lại/i).first()).toBeVisible()
    await expect(page.getByText('Hãy gửi lời mời thành viên đầu tiên tham gia Chapter của bạn.')).toHaveCount(0)
  })

  test('phiên hết hạn giữa chừng: thao tác tiếp theo đưa về trang đăng nhập thay vì trang trắng hay lỗi', async ({ page, context }) => {
    await signInAs(page, 'member')
    await context.clearCookies()
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear() })
    await page.goto('/student/stars')
    await expect(page).toHaveURL(/\/login/)
    await expect(page.getByRole('heading', { name: 'Đăng nhập' })).toBeVisible()
  })
})

test.describe('Bố cục và điện thoại', () => {
  test('menu: mở bằng nút Menu, chọn mục thì tới đúng trang và menu tự đóng để thấy nội dung', async ({ page }) => {
    test.skip(!isPhone(), 'chỉ áp dụng cho điện thoại')
    await signInAs(page, 'member')
    const toggle = page.getByRole('button', { name: /Menu/ })
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(page.locator('#bbe-navigation')).toBeHidden()
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await page.locator('#bbe-navigation').getByRole('link', { name: /Sao|Star/ }).first().click()
    await expect(page).toHaveURL(/\/student\/stars/)
    await expect(page.locator('#bbe-navigation')).toBeHidden()
  })

  test('màn hình hẹp 320px (điện thoại nhỏ hoặc phóng to 400%): các trang chính không phải cuộn ngang', async ({ page, request }) => {
    const learner = await createLearner(request)
    const course = await createCourse(request, { lessons: [{ quiz: { questions: 2 } }] })
    await page.setViewportSize({ width: 320, height: 640 })
    const overflowing: string[] = []
    const measure = async (target: string) => { await page.goto(target); await settle(page); const audit = await auditPage(page); if (audit.overflowPx > 1) overflowing.push(`${target.replace(/[0-9a-f-]{36}/g, '<id>')}: tràn ${audit.overflowPx}px`) }
    await measure('/login')
    await page.locator('input[type="email"]').fill(learner.email)
    await page.locator('input[type="password"]').fill(learner.password)
    await page.locator('button[type="submit"]').click()
    await expect(page).toHaveURL(/\/student\/dashboard/, { timeout: 20_000 })
    for (const target of ['/student/dashboard', '/student/courses', `/student/courses/${course.courseId}`, `/student/learning/${course.lessons[0].lessonId}`, '/student/leaderboard', '/student/stars', '/student/profile']) await measure(target)
    expect(overflowing).toEqual([])
  })

  const overflowWithName = async (page: Page, request: APIRequestContext, displayName: string) => {
    const learner = await createLearner(request)
    expect((await learner.api.patch('/api/v1/users/me', { displayName })).status).toBe(200)
    await page.goto('/login')
    await page.locator('input[type="email"]').fill(learner.email)
    await page.locator('input[type="password"]').fill(learner.password)
    await page.locator('button[type="submit"]').click()
    await expect(page).toHaveURL(/\/student\/dashboard/, { timeout: 20_000 })
    const overflowing: string[] = []
    for (const target of ['/student/dashboard', '/student/profile', '/student/leaderboard']) {
      await page.goto(target)
      await settle(page)
      if (target === '/student/profile') await expect(page.getByPlaceholder('Ví dụ: Nguyễn Minh Anh')).toHaveValue(displayName)
      else await expect(page.getByText(displayName.slice(0, 20)).first()).toBeVisible()
      const { overflowPx } = await auditPage(page)
      if (overflowPx > 1) overflowing.push(`${target}: tràn ${overflowPx}px`)
    }
    return overflowing
  }

  test('họ tên dài (73 ký tự, có dấu cách) không làm vỡ bố cục trang chủ, hồ sơ và bảng xếp hạng', async ({ page, request }) => {
    expect(await overflowWithName(page, request, 'Nguyễn Hoàng Thị Minh Anh Khánh Linh Phương Thảo Nguyên Bảo Ngọc Diệp Chi')).toEqual([])
  })

  uiDefect('BUG-UX-LONG-WORD-OVERFLOW', 'tên hiển thị chứa một từ dài không có dấu cách (36 ký tự) không làm trang chủ học viên phải cuộn ngang', async ({ page, request }) => {
    test.skip(isPhone(), 'chỉ tái hiện ở bố cục máy tính')
    expect(await overflowWithName(page, request, `Nguyễn Hoàng Thị Minh Anh Khánh Linh ${'Phương'.repeat(6)}`)).toEqual([])
  })
})
