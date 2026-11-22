import { expect, test, type Page } from '@playwright/test'
import { Api, as, login } from '../support/api'
import { createLearner, inviteLink, PASSWORD, uiDefect, uniqueEmail } from '../support/fixtures'
import { ACCOUNTS } from '../support/seed'
import { settle, signIn, signInAs, watchProblems } from '../support/ui'

// Intent: docs/business-rules.md "Lời mời", "Tổ chức", "Vô hiệu hóa". A Lead runs their own unit from the screen
// alone, and a mistake (wrong email, double click, hasty deactivation) must be caught before it costs anything.

async function openInviteModal(page: Page) {
  await page.goto('/chapter-manager/invitations')
  await page.getByRole('button', { name: /Mời thành viên mới/ }).click()
  await expect(page.getByLabel('Ban của thành viên *')).toBeVisible()
  await expect(page.locator('#invite-department option').nth(1)).toBeAttached()
  await page.getByLabel('Ban của thành viên *').selectOption({ index: 1 })
}
const row = (page: Page, email: string) => page.locator('tr', { hasText: email })
const invitationsOf = async (page: Page, email: string) => {
  const token = await page.evaluate(() => localStorage.getItem('accessToken') || localStorage.getItem('token') || '')
  const list = await page.request.get(`/api/v1/invitations?limit=100`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
  const body = await list.json()
  return ((body.items || body.data?.items || body.data || []) as { email: string }[]).filter((item) => item.email === email)
}

test.describe('Lead Chapter', () => {
  test('mời một thành viên: chọn ban → nhập email → thấy lời mời "Đang chờ" → lấy link → người được mời kích hoạt → trạng thái đổi thành đã kích hoạt', async ({ page, browser, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    const problems = watchProblems(page)
    const email = uniqueEmail('ui-moi')
    await signInAs(page, 'chapterLead')
    await openInviteModal(page)
    await page.locator('form input[type="email"]').fill(email)
    await page.getByRole('button', { name: /^Gửi lời mời/ }).click()
    // Mail is not configured here, so the Lead must be told to hand over a link instead of believing a mail went out.
    await expect(page.getByText(new RegExp(`Đã tạo lời mời cho ${email.replace(/[.+]/g, '\\$&')} nhưng chưa gửi được mail`))).toBeVisible()
    await expect(row(page, email)).toContainText('Đang chờ')

    await row(page, email).getByRole('button', { name: /Link mời|Đổi link/ }).click()
    await expect(page.getByText(/Đã sao chép link mời/)).toBeVisible()
    const link = new URL(await page.evaluate(() => navigator.clipboard.readText()))
    expect(link.pathname).toBe('/accept-invitation')

    const invitee = await browser.newContext()
    const guest = await invitee.newPage()
    await guest.goto(link.pathname + link.search)
    await guest.getByPlaceholder('ban@gmail.com').fill(email)
    await guest.locator('input[type="password"]').nth(0).fill(PASSWORD)
    await guest.locator('input[type="password"]').nth(1).fill(PASSWORD)
    await guest.getByRole('button', { name: /Kích hoạt tài khoản/ }).click()
    await expect(guest.getByText(/Kích hoạt tài khoản thành công/)).toBeVisible()
    await invitee.close()

    // A new tab is used on purpose: the same tab keeps showing its 2-minute-old copy (BUG-STALE-AFTER-RELOAD below).
    await expect(async () => {
      await page.evaluate(() => sessionStorage.clear())
      await page.reload()
      await expect(row(page, email)).toContainText('Đã kích hoạt', { timeout: 3_000 })
    }).toPass({ timeout: 25_000 })
    await expect(row(page, email).getByRole('button', { name: 'Hủy' }), 'lời mời đã dùng không còn hủy được').toHaveCount(0)
    await page.goto('/chapter-manager/members')
    await page.getByPlaceholder(/Tìm kiếm thành viên/).fill(email)
    await page.getByRole('button', { name: /Tìm kiếm/ }).click()
    await expect(row(page, email)).toContainText('Hoạt động')
    expect(problems.console).toEqual([])
    expect(problems.failedRequests).toEqual([])
  })

  test('bấm đúp nút gửi chỉ tạo một lời mời', async ({ page }) => {
    const email = uniqueEmail('ui-dup')
    await signInAs(page, 'chapterLead')
    await openInviteModal(page)
    await page.locator('form input[type="email"]').fill(email)
    await page.getByRole('button', { name: /^Gửi lời mời/ }).dblclick()
    await expect(row(page, email).first()).toBeVisible()
    await settle(page)
    expect(await invitationsOf(page, email)).toHaveLength(1)
    await expect(row(page, email)).toHaveCount(1)
  })

  test('mời email đã là thành viên: báo lỗi tiếng Việt, giữ nguyên form để sửa', async ({ page }) => {
    await signInAs(page, 'chapterLead')
    await openInviteModal(page)
    await page.locator('form input[type="email"]').fill(ACCOUNTS.member)
    await page.getByRole('button', { name: /^Gửi lời mời/ }).click()
    const toast = page.getByText(/đã (tồn tại|là thành viên|được sử dụng|có tài khoản)/i).first()
    await expect(toast).toBeVisible()
    await expect(page.locator('form input[type="email"]'), 'email vừa gõ không bị xóa').toHaveValue(ACCOUNTS.member)
  })

  test('hủy lời mời phải hỏi lại; hủy xong link không còn kích hoạt được', async ({ page, request }) => {
    const email = uniqueEmail('ui-huy')
    const lead = await as(request, 'chapterLead')
    const unit = ((await lead.get('/api/v1/organization/managed-units')).body.items as any[]).find((item) => item.type === 'DEPARTMENT' && item.canManageMembers)
    const invitation = await lead.post('/api/v1/invitations/member', { email, organizationUnitId: unit.id })
    const link = await lead.post(`/api/v1/invitations/${invitation.body.invitationId}/link`)
    const token = new URL(link.body.link).searchParams.get('token')
    await signInAs(page, 'chapterLead')
    await page.goto('/chapter-manager/invitations')

    page.once('dialog', (dialog) => { expect(dialog.message()).toContain('Người nhận sẽ không thể kích hoạt nữa'); void dialog.dismiss() })
    await row(page, email).getByRole('button', { name: 'Hủy' }).click()
    await expect(row(page, email), 'bấm "Không" thì lời mời vẫn còn').toContainText('Đang chờ')

    page.once('dialog', (dialog) => void dialog.accept())
    await row(page, email).getByRole('button', { name: 'Hủy' }).click()
    await expect(page.getByText('Đã hủy lời mời.')).toBeVisible()
    await expect(row(page, email).getByRole('button', { name: 'Hủy' })).toHaveCount(0)
    const accepted = await new Api(request).post('/api/v1/invitations/accept', { token, email, password: PASSWORD, confirmPassword: PASSWORD })
    expect(accepted.status).toBeGreaterThanOrEqual(400)
  })

  test('người được mời kích hoạt xong, Lead bấm tải lại trang (F5) phải thấy "Đã kích hoạt" chứ không phải bản cũ lưu trong tab tới 2 phút', async ({ page, request }) => {
    const email = uniqueEmail('ui-stale')
    const { token } = await inviteLink(request, 'chapterLead', email)
    await signInAs(page, 'chapterLead')
    await page.goto('/chapter-manager/invitations')
    await expect(row(page, email)).toContainText('Đang chờ')
    const accepted = await new Api(request).post('/api/v1/invitations/accept', { token, email, password: PASSWORD, confirmPassword: PASSWORD })
    expect(accepted.status).toBe(200)
    await page.waitForTimeout(11_000) // longer than the 10-second server cache, so only the browser copy can be stale
    await page.reload()
    await expect(row(page, email)).toContainText('Đã kích hoạt', { timeout: 4_000 })
  })

  test('mời nhiều email: xem trước tách rõ hợp lệ / sai định dạng / trùng, chỉ gửi email hợp lệ', async ({ page }) => {
    const good = [uniqueEmail('ui-bulk'), uniqueEmail('ui-bulk')]
    await signInAs(page, 'chapterLead')
    await openInviteModal(page)
    await page.getByRole('tab', { name: 'Nhiều email' }).click()
    await page.getByRole('textbox', { name: /Danh sách email/ }).fill([good[0], 'khong-phai-email', good[1], good[0]].join('\n'))
    await page.getByRole('button', { name: /Xem trước/ }).click()
    await expect(page.locator('[aria-current="step"]')).toHaveText('2. Xem trước')
    const preview = page.getByRole('dialog').or(page.locator('body')).first()
    await expect(preview).toContainText('Sai định dạng')
    await expect(preview).toContainText('Trùng, sẽ bỏ qua')
    await expect(page.getByRole('button', { name: /^Gửi(?! lại)/ }), 'còn email sai định dạng thì chưa cho gửi, hoặc chỉ gửi email hợp lệ').toBeVisible()
    await page.getByRole('button', { name: 'Bỏ email khong-phai-email' }).click()
    await page.getByRole('button', { name: /^Gửi(?! lại)/ }).click()
    await expect(page.locator('[aria-current="step"]')).toHaveText('3. Kết quả', { timeout: 20_000 })
    await page.getByRole('button', { name: 'Đóng' }).click()
    for (const email of good) await expect(row(page, email)).toHaveCount(1)
    await expect(row(page, 'khong-phai-email')).toHaveCount(0)
  })

  test('tìm thành viên theo email, mở hồ sơ tiến độ; không tìm ra thành viên Chapter khác', async ({ page, request }) => {
    const learner = await createLearner(request)
    await signInAs(page, 'chapterLead')
    await page.goto('/chapter-manager/members')
    await expect(page.getByText('Tổng thành viên')).toBeVisible()
    const search = page.getByPlaceholder(/Tìm kiếm thành viên/)
    await search.fill(learner.email)
    await search.press('Enter')
    await expect(row(page, learner.email)).toHaveCount(1)
    await row(page, learner.email).getByRole('button').first().click()
    await expect(page.getByRole('dialog').or(page.locator('[class*="fixed"]')).filter({ hasText: learner.email }).first()).toBeVisible()
    await page.keyboard.press('Escape')

    await page.goto('/chapter-manager/members')
    await page.getByPlaceholder(/Tìm kiếm thành viên/).fill(ACCOUNTS.otherChapterMember)
    await page.getByPlaceholder(/Tìm kiếm thành viên/).press('Enter')
    await settle(page)
    await expect(row(page, ACCOUNTS.otherChapterMember), 'thành viên Chapter khác không được lộ').toHaveCount(0)
    await expect(page.getByText(/Chưa có thành viên nào|Không tìm thấy/).first()).toBeVisible()
  })

  test('hồ sơ thành viên do Lead mở ghi đúng Chapter và Ban của người đó, không phải "Chưa gán Chapter" / "Chưa phân ban"', async ({ page, request }) => {
    const learner = await createLearner(request, { unitName: 'Ban Khách Mời' })
    await signInAs(page, 'chapterLead')
    await page.goto('/chapter-manager/members')
    const search = page.getByPlaceholder(/Tìm kiếm thành viên/)
    await search.fill(learner.email)
    await search.press('Enter')
    await expect(row(page, learner.email), 'danh sách ghi đúng ban').toContainText('Ban Khách Mời')
    await row(page, learner.email).getByRole('button').first().click()
    const detail = page.getByRole('dialog').or(page.locator('[class*="fixed"]')).filter({ hasText: learner.email }).first()
    await expect(detail).toBeVisible()
    await settle(page)
    await expect.soft(detail, 'cửa sổ hồ sơ').not.toContainText('Chưa gán Chapter')
    await expect.soft(detail, 'cửa sổ hồ sơ').not.toContainText('Chưa phân ban')
    await expect.soft(detail, 'cửa sổ hồ sơ').toContainText('Ban Khách Mời')
    await expect.soft(detail, 'cửa sổ hồ sơ').not.toContainText('Ban Ban')

    await page.goto(`/chapter-manager/members/${learner.userId}`)
    const profile = page.locator('main').first()
    await expect(profile).toContainText(learner.email)
    await settle(page)
    await expect.soft(profile, 'trang hồ sơ').toContainText('Ban Khách Mời')
    await expect.soft(profile, 'trang hồ sơ').not.toContainText('Chưa gán Chapter')
    await expect.soft(profile, 'trang hồ sơ').not.toContainText('Ban Ban')
  })

  test('vô hiệu hóa thành viên: phải gõ đúng "vô hiệu hóa", xong thì người đó không đăng nhập được và Lead không tự mở lại được', async ({ page, request, browser }) => {
    const learner = await createLearner(request)
    await signInAs(page, 'chapterLead')
    await page.goto('/chapter-manager/members')
    await page.getByPlaceholder(/Tìm kiếm thành viên/).fill(learner.email)
    await page.getByPlaceholder(/Tìm kiếm thành viên/).press('Enter')
    await row(page, learner.email).getByRole('button', { name: 'Vô hiệu hóa' }).click()
    await expect(page.getByText('Vô hiệu hóa tài khoản?')).toBeVisible()
    const confirm = page.getByRole('button', { name: 'Xác nhận vô hiệu hóa' })
    await page.getByPlaceholder('vô hiệu hóa').fill('vo hieu hoa')
    await confirm.click({ force: true }).catch(() => undefined)
    await expect(row(page, learner.email), 'gõ sai chữ xác nhận thì chưa được vô hiệu hóa').toContainText('Hoạt động')
    await page.getByPlaceholder('vô hiệu hóa').fill('vô hiệu hóa')
    await confirm.click()
    await expect(row(page, learner.email)).toContainText('Đã vô hiệu hóa', { timeout: 15_000 })
    await expect(row(page, learner.email)).toContainText('Chỉ Admin mới có quyền mở lại')
    await expect(row(page, learner.email).getByRole('button', { name: /Kích hoạt/ })).toHaveCount(0)

    const other = await browser.newContext()
    const blocked = await other.newPage()
    await signIn(blocked, learner.email, learner.password)
    await expect(blocked).toHaveURL(/\/login/)
    await expect(blocked.locator('body')).toContainText(/vô hiệu hóa|bị khóa|không hoạt động|liên hệ/i)
    await other.close()
    await expect(login(request, learner.email, learner.password)).rejects.toThrow()
  })

  test('menu của Lead Chapter chỉ có việc quản lý Chapter, không có mục học hay quản trị hệ thống', async ({ page }) => {
    await signInAs(page, 'chapterLead')
    const nav = page.getByRole('navigation').first()
    for (const label of ['Tổng quan', 'Thành viên & Tiến trình', 'Bảng xếp hạng', 'Khóa học', 'Mời thành viên', 'Chuyển giao nhiệm kỳ']) {
      await expect(nav.getByRole('link', { name: label, exact: false }).first()).toBeVisible()
    }
    await expect(page.getByRole('link', { name: /Quản lý tài khoản|Mùa chuyển giao/ })).toHaveCount(0)
  })
})

test.describe('Lead DNA', () => {
  test('vào đúng khu DNA, mời thành viên vào một nhóm DNA và thấy thông báo rõ ràng', async ({ page }) => {
    const problems = watchProblems(page)
    const email = uniqueEmail('ui-dna')
    await signInAs(page, 'dnaLead')
    await expect(page).toHaveURL(/\/organization-manager/)
    await page.goto('/organization-manager/invitations')
    await expect(page.getByRole('heading', { name: 'Mời thành viên DNA' })).toBeVisible()
    const group = page.getByLabel('Nhóm DNA')
    await expect(group.locator('option').first()).toBeAttached()
    const groups = await group.locator('option').allInnerTexts()
    expect(groups.every((name) => /LDC|SGDC|TT/.test(name)), `nhóm mời được: ${groups.join(', ')}`).toBe(true)
    await page.getByLabel('Email', { exact: true }).fill(email)
    await page.getByRole('button', { name: 'Gửi lời mời DNA' }).click()
    await expect(page.getByText(/Đã (tạo|gửi) lời mời/)).toBeVisible()
    expect(problems.console).toEqual([])
    expect(problems.failedRequests).toEqual([])
  })

  test('xem được bảng xếp hạng DNA và danh mục khóa công khai; được nhắc rằng Lead không ghi nhận tiến độ', async ({ page }) => {
    await signInAs(page, 'dnaLead')
    await page.goto('/organization-manager/leaderboard')
    await settle(page)
    await expect(page.getByRole('heading').first()).toBeVisible()
    await expect(page.locator('body')).not.toContainText(/không có quyền|403|Forbidden/i)
    await page.goto('/organization-manager/courses')
    await expect(page.getByText('Tài khoản Lead DNA chỉ quản lý và không ghi nhận tiến độ.', { exact: false })).toBeVisible()
  })

  test('gõ địa chỉ khu Chapter hay khu học viên thì được đưa về khu DNA', async ({ page }) => {
    await signInAs(page, 'dnaLead')
    for (const foreign of ['/chapter-manager/members', '/admin/users']) {
      await page.goto(foreign)
      await expect(page, foreign).toHaveURL(/\/organization-manager/, { timeout: 15_000 })
    }
  })
})
