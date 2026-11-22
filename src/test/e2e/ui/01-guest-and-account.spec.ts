import { expect, test } from '@playwright/test'
import { as } from '../support/api'
import { createCourse, createLearner, enforceDeadlines, inviteLink, makeOverdue, PASSWORD, setMandatory, uiDefect, uniqueEmail } from '../support/fixtures'
import { ACCOUNTS, SEED_PASSWORD } from '../support/seed'
import { settle, signIn, signInAs, watchProblems } from '../support/ui'

// Intent: docs/business-rules.md "Khách", "Lời mời", "Đăng nhập và khóa tài khoản". Real browser, real API, real database.
test.describe('Khách', () => {
  test('xem được khóa công khai từ trang chủ mà không cần tài khoản, và luôn thấy lối đăng nhập', async ({ page, request }) => {
    const course = await createCourse(request, { lessons: [{}], visibility: 'PUBLIC' })
    const hidden = await createCourse(request, { lessons: [{}], visibility: 'PRIVATE' })
    const problems = watchProblems(page)
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await page.getByRole('link', { name: 'Khóa học', exact: true }).first().click()
    await expect(page).toHaveURL(/\/student\/courses/)
    await expect(page.getByText(course.title)).toBeVisible()
    await expect(page.getByText(hidden.title), 'khóa chỉ dành cho thành viên không được lộ với khách').toHaveCount(0)
    await page.getByText(course.title).click()
    await expect(page).toHaveURL(new RegExp(course.courseId))
    await expect(page.getByRole('heading', { name: course.title })).toBeVisible()
    await expect(page.getByRole('link', { name: /Đăng nhập/ }).first()).toBeVisible()
    expect(problems.console, 'lỗi console').toEqual([])
    expect(problems.failedRequests).toEqual([])
  })

  test('khách mở bài học công khai: không có quiz, không ghi tiến độ, không có sao', async ({ page, request }) => {
    const course = await createCourse(request, { lessons: [{ quiz: { questions: 3 } }], visibility: 'PUBLIC' })
    const progressWrites: number[] = []
    page.on('response', (response) => { if (/\/progress/.test(response.url()) && response.request().method() !== 'GET') progressWrites.push(response.status()) })
    await page.goto(`/student/courses/${course.courseId}`)
    await page.getByRole('link', { name: /Bài 1/ }).first().click()
    await settle(page)
    await expect(page.getByText('Bài 1').first()).toBeVisible()
    await expect(page.getByRole('button', { name: /Bắt đầu làm bài|Vào làm bài kiểm tra/ })).toHaveCount(0)
    expect(progressWrites.filter((status) => status < 400), 'khách không được ghi tiến độ').toEqual([])
    await page.goto(`/student/learning/${course.lessons[0].lessonId}/quiz`)
    await settle(page)
    await expect(page.getByRole('button', { name: /Bắt đầu làm bài/ })).toHaveCount(0)
  })

  test('mở trang cần đăng nhập thì được đưa tới trang đăng nhập, đăng nhập xong quay lại đúng trang đã định mở', async ({ page }) => {
    await page.goto('/admin/users')
    await expect(page).toHaveURL(/\/login\?callbackUrl=/)
    await page.locator('input[type="email"]').fill(ACCOUNTS.admin)
    await page.locator('input[type="password"]').fill(SEED_PASSWORD)
    await page.getByRole('button', { name: /Đăng nhập vào hệ thống/ }).click()
    await expect(page).toHaveURL(/\/admin\/users/, { timeout: 20_000 })
  })

  uiDefect('BUG-UX-CALLBACK-STUDENT', 'học viên mở link trang riêng khi chưa đăng nhập thì đăng nhập xong phải về đúng trang đó', async ({ page }) => {
    await page.goto('/student/stars')
    await expect(page).toHaveURL(/\/login/)
    await page.locator('input[type="email"]').fill(ACCOUNTS.member)
    await page.locator('input[type="password"]').fill(SEED_PASSWORD)
    await page.getByRole('button', { name: /Đăng nhập vào hệ thống/ }).click()
    await expect(page).toHaveURL(/\/student\/stars/, { timeout: 8_000 })
  })

  for (const area of ['/admin/dashboard', '/chapter-manager/members', '/organization-manager/dashboard', '/student/dashboard']) {
    test(`khách không xem được ${area}`, async ({ page }) => {
      await page.goto(area)
      await expect(page).toHaveURL(/\/login/)
      await expect(page.getByRole('heading', { name: 'Đăng nhập' })).toBeVisible()
    })
  }
})

test.describe('Đăng nhập', () => {
  test('sai mật khẩu: báo lỗi tiếng Việt, giữ lại email đã gõ, nút bấm dùng lại được, không lộ tài khoản có tồn tại hay không', async ({ page }) => {
    await signIn(page, ACCOUNTS.member, 'Sai-mat-khau-1!')
    const error = page.getByText(/không đúng|không chính xác|sai/i).first()
    await expect(error).toBeVisible()
    const wrongPassword = await error.innerText()
    await expect(page).toHaveURL(/\/login/)
    await expect(page.locator('input[type="email"]')).toHaveValue(ACCOUNTS.member)
    await expect(page.getByRole('button', { name: /Đăng nhập vào hệ thống/ })).toBeEnabled()
    await signIn(page, uniqueEmail('khong-ton-tai'), 'Sai-mat-khau-1!')
    await expect(page.getByText(/không đúng|không chính xác|sai/i).first()).toHaveText(wrongPassword)
  })

  test('mỗi vai được đưa về đúng trang chủ của mình sau khi đăng nhập', async ({ browser }) => {
    const homes = { admin: /\/admin\/dashboard/, chapterLead: /\/chapter-manager\/dashboard/, dnaLead: /\/organization-manager/, member: /\/student\/dashboard/ } as const
    for (const [account, home] of Object.entries(homes)) {
      const context = await browser.newContext()
      const page = await context.newPage()
      await signIn(page, ACCOUNTS[account as keyof typeof homes])
      await expect(page, account).toHaveURL(home, { timeout: 20_000 })
      await expect(page.getByRole('heading', { level: 1 }).first(), account).toBeVisible()
      await context.close()
    }
  })

  test('vào nhầm khu vực của vai khác thì được đưa về khu vực của mình, không thấy trang trắng hay dữ liệu quản trị', async ({ page }) => {
    await signInAs(page, 'member')
    for (const foreign of ['/admin/users', '/chapter-manager/members', '/organization-manager/dashboard']) {
      await page.goto(foreign)
      await expect(page, foreign).toHaveURL(/\/student\//, { timeout: 15_000 })
    }
    await expect(page.getByText('Quản lý tài khoản')).toHaveCount(0)
  })

  test('đăng xuất xong thì không quay lại được trang riêng bằng nút Back hay gõ lại địa chỉ', async ({ page }) => {
    await signInAs(page, 'member')
    await page.getByRole('button', { name: /Đăng xuất/ }).click()
    const confirm = page.getByRole('button', { name: /^(Đăng xuất|Xác nhận|Đồng ý)$/ }).last()
    if (await confirm.isVisible().catch(() => false)) await confirm.click()
    await expect(page).toHaveURL(/\/(login)?(\?.*)?$/, { timeout: 15_000 })
    await page.goto('/student/dashboard')
    await expect(page).toHaveURL(/\/login/)
  })

  test('quên mật khẩu: email có hay không có tài khoản đều nhận cùng một thông báo', async ({ page }) => {
    const messages: string[] = []
    for (const email of [ACCOUNTS.member, uniqueEmail('la')]) {
      await page.goto('/forgot-password')
      await page.locator('input[type="email"]').fill(email)
      await page.getByRole('button', { name: /Gửi link đặt lại/ }).click()
      await expect(page.getByRole('button', { name: /Gửi link đặt lại|Đang gửi/ })).toHaveCount(0)
      messages.push((await page.locator('main, body').first().innerText()).replace(email, '<email>'))
    }
    expect(messages[0]).toBe(messages[1])
    expect(messages[0]).toMatch(/email|liên kết|link/i)
  })

  test('Admin cấp link đặt lại mật khẩu: người dùng tự đặt mật khẩu mới và đăng nhập được, link không dùng lại được', async ({ page, request }) => {
    const learner = await createLearner(request)
    const issued = await (await as(request, 'admin')).post(`/api/v1/users/${learner.userId}/password-reset/link`)
    const link = new URL(issued.body.link)
    const next = 'Mat-khau-Moi-7y!'
    await page.goto(link.pathname + link.search)
    const fields = page.locator('input[type="password"]')
    const save = page.locator('button[type="submit"]')
    await fields.nth(0).fill('ngan-7!')
    await fields.nth(1).fill('ngan-7!')
    await save.click()
    expect(await fields.nth(0).evaluate((input: HTMLInputElement) => input.validity.tooShort), 'mật khẩu dưới 8 ký tự bị chặn ngay tại ô nhập').toBe(true)
    await expect(page).toHaveURL(/reset-password/)
    await fields.nth(0).fill(next)
    await fields.nth(1).fill(next + 'x')
    await save.click()
    await expect(page.getByText('Mật khẩu xác nhận không khớp.')).toBeVisible()
    await fields.nth(1).fill(next)
    await save.click()
    await expect(page.getByText(/thành công/i).first()).toBeVisible()
    await signIn(page, learner.email, next)
    await expect(page).toHaveURL(/\/student\/dashboard/, { timeout: 20_000 })
    await page.context().clearCookies()
    await page.goto(link.pathname + link.search)
    await fields.nth(0).fill('Lan-Hai-8z!!')
    await fields.nth(1).fill('Lan-Hai-8z!!')
    await save.click()
    await expect(page.getByText(/hết hạn|đã được sử dụng|đã sử dụng|không hợp lệ/i).first()).toBeVisible()
  })

  test('tài khoản bị khóa vì quá hạn: màn hình đăng nhập nói rõ lý do và phải liên hệ ai', async ({ page, request }) => {
    const course = await createCourse(request, { lessons: [{}], programCode: 'CORE_MEMBER' })
    await setMandatory(request, course.courseId, 'DEPARTMENT_MEMBER_BKM', 5)
    const learner = await createLearner(request, { unitName: 'Ban Khách Mời' })
    await makeOverdue(learner.userId)
    await enforceDeadlines(request)
    await signIn(page, learner.email, learner.password)
    await expect(page).toHaveURL(/\/login/)
    const notice = page.getByText(/quá hạn/i).first()
    await expect(notice).toBeVisible()
    await expect(page.locator('body')).toContainText(/Admin/)
    await setMandatory(request, course.courseId, 'DEPARTMENT_MEMBER_BKM', null)
  })
})

test.describe('Lời mời', () => {
  test('người được mời tự kích hoạt: sai email, mật khẩu yếu, mật khẩu không khớp đều được báo rõ; đúng thì vào học được', async ({ page, request }) => {
    const email = uniqueEmail('moi')
    const invite = await inviteLink(request, 'chapterLead', email)
    const link = new URL(invite.link)
    const problems = watchProblems(page)
    await page.goto(link.pathname + link.search)
    await expect(page.getByRole('heading', { name: 'Kích hoạt tài khoản' })).toBeVisible()
    await expect(page.locator('main')).toContainText(invite.unit.name)
    const emailField = page.getByPlaceholder('ban@gmail.com')
    const passwords = page.locator('input[type="password"]')
    const submit = page.getByRole('button', { name: /Kích hoạt tài khoản/ })

    await emailField.fill(email)
    await passwords.nth(0).fill('1234567')
    await passwords.nth(1).fill('1234567')
    await submit.click()
    expect(await passwords.nth(0).evaluate((input: HTMLInputElement) => input.validity.tooShort), 'mật khẩu dưới 8 ký tự bị chặn ngay tại ô nhập').toBe(true)
    await expect(submit).toBeVisible()

    await passwords.nth(0).fill(PASSWORD)
    await passwords.nth(1).fill(PASSWORD + '!')
    await submit.click()
    await expect(page.getByText('Mật khẩu xác nhận không khớp.')).toBeVisible()

    await emailField.fill(uniqueEmail('nguoi-khac'))
    await passwords.nth(1).fill(PASSWORD)
    await submit.click()
    await expect(page.getByText(/email/i).filter({ hasText: /không khớp|không đúng|được mời/i }).first()).toBeVisible()
    await expect(emailField, 'form phải còn để gõ lại email').toBeVisible()

    await emailField.fill(email)
    await submit.click()
    await expect(page.getByText(/Kích hoạt tài khoản thành công/)).toBeVisible()
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 })
    await signIn(page, email, PASSWORD)
    await expect(page).toHaveURL(/\/student\/dashboard/, { timeout: 20_000 })
    expect(problems.console).toEqual([])

    await page.context().clearCookies()
    await page.goto(link.pathname + link.search)
    await expect(page.getByText(/Lời mời không khả dụng/)).toBeVisible()
    await expect(page.getByRole('button', { name: /Kích hoạt tài khoản/ })).toHaveCount(0)
  })

  test('link mời sai hoặc thiếu token: giải thích và chỉ cách xử lý, không hiện form', async ({ page }) => {
    for (const url of ['/accept-invitation', '/accept-invitation?token=khong-ton-tai']) {
      await page.goto(url)
      await expect(page.getByText('Lời mời không khả dụng'), url).toBeVisible()
      await expect(page.locator('main')).toContainText(/liên hệ/i)
      await expect(page.locator('input[type="password"]')).toHaveCount(0)
      await expect(page.getByRole('link', { name: /đăng nhập/i }).or(page.getByRole('button', { name: /đăng nhập/i })).first()).toBeVisible()
    }
  })

  uiDefect('BUG-UX-ACCEPT-LOGIN', 'nút ghi "Kích hoạt tài khoản & Đăng nhập" thì kích hoạt xong phải vào thẳng trang học, không bắt gõ lại email và mật khẩu', async ({ page, request }) => {
    const email = uniqueEmail('moi')
    const link = new URL((await inviteLink(request, 'chapterLead', email)).link)
    await page.goto(link.pathname + link.search)
    await page.getByPlaceholder('ban@gmail.com').fill(email)
    await page.locator('input[type="password"]').nth(0).fill(PASSWORD)
    await page.locator('input[type="password"]').nth(1).fill(PASSWORD)
    await page.getByRole('button', { name: 'Kích hoạt tài khoản & Đăng nhập' }).click()
    await expect(page).toHaveURL(/\/student\/dashboard/, { timeout: 8_000 })
  })
})
