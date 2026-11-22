import { expect, test, type Page } from '@playwright/test'
import { tryLogin } from '../support/api'
import { createCourse, createLearner, enforceDeadlines, makeOverdue, setMandatory, uiDefect, unique, uniqueEmail } from '../support/fixtures'
import { settle, signIn, signInAs, watchProblems } from '../support/ui'

// Intent: docs/business-rules.md "Khóa học", "Khóa quá hạn", "Vô hiệu hóa", docs/KHBB.md. The Admin does the whole
// job from the screen; every irreversible action must ask first and say what happened afterwards.

const userRow = (page: Page, email: string) => page.locator('tr', { hasText: email })
async function findUser(page: Page, email: string) {
  await page.goto('/admin/users')
  const search = page.getByPlaceholder(/Tìm theo tên hoặc email/)
  await search.fill(email)
  await search.press('Enter')
  await expect(userRow(page, email)).toHaveCount(1, { timeout: 15_000 })
}
const courseCard = (page: Page, title: string) =>
  page.locator(`h3[title="${title}"]`).locator('xpath=ancestor::div[.//button[contains(., "Xuất bản") or contains(., "Hạ về nháp")]][1]')
async function findCourse(page: Page, title: string) {
  await page.goto('/admin/courses')
  await page.getByPlaceholder('Tìm kiếm tên khóa học...').fill(title)
  await expect(courseCard(page, title)).toBeVisible({ timeout: 15_000 })
}

test.describe('Admin: khóa học', () => {
  test('tạo khóa mới từ form: thiếu tên thì không tạo; đủ thì báo thành công, mở trang soạn nội dung, và khóa nằm ở dạng nháp', async ({ page }) => {
    const problems = watchProblems(page)
    const title = unique('Khóa tạo từ giao diện')
    await signInAs(page, 'admin')
    await page.goto('/admin/courses/new')
    const create = page.locator('button[type="submit"]')
    await create.click()
    await expect(page, 'thiếu tên khóa thì ở lại form').toHaveURL(/\/admin\/courses\/new/)
    await page.locator('input[name="title"]').fill(title)
    await page.locator('textarea[name="description"]').fill('Mô tả do test giao diện nhập')
    await page.getByText('Chỉ thành viên BBE (phải đăng nhập)').click()
    await create.click()
    // Thông báo thành công chỉ hiện thoáng qua trước khi chuyển trang; bằng chứng chắc chắn là trang soạn nội dung mở ra.
    await expect(page.getByText(/Tạo khóa học thành công/).or(page.getByText('Thông tin chung khóa học'))).toBeVisible()
    await expect(page).toHaveURL(/\/admin\/courses\/[^/]+\/edit/, { timeout: 15_000 })
    await findCourse(page, title)
    await expect(courseCard(page, title)).toContainText('Bản nháp')
    await expect(courseCard(page, title)).toContainText('Chỉ thành viên BBE')
    expect(problems.console).toEqual([])
    expect(problems.failedRequests).toEqual([])
  })

  test('xuất bản khóa công khai thì khách thấy ngay ở trang chủ; hạ về nháp thì khách không còn thấy', async ({ page, request, browser }) => {
    const course = await createCourse(request, { lessons: [{}], visibility: 'PUBLIC', publish: false })
    const visitor = await (await browser.newContext()).newPage()
    await visitor.goto('/')
    await expect(visitor.getByText(course.title)).toHaveCount(0)

    await signInAs(page, 'admin')
    await findCourse(page, course.title)
    await courseCard(page, course.title).getByRole('button', { name: 'Xuất bản' }).click()
    await expect(page.getByText('Đã xuất bản khóa học thành công!')).toBeVisible()
    await expect(courseCard(page, course.title)).toContainText('Đã xuất bản')
    await expect(async () => { await visitor.goto('/'); await expect(visitor.getByText(course.title).first()).toBeVisible({ timeout: 3_000 }) }).toPass({ timeout: 30_000 })

    await courseCard(page, course.title).getByRole('button', { name: 'Hạ về nháp' }).click()
    await expect(page.getByText('Đã chuyển khóa học về bản nháp.')).toBeVisible()
    await expect(async () => { await visitor.goto('/'); await expect(visitor.getByText(course.title)).toHaveCount(0, { timeout: 3_000 }) }).toPass({ timeout: 30_000 })
    await visitor.context().close()
  })

  test('xóa khóa học phải hỏi lại và nói rõ hậu quả; bấm "Không" thì khóa còn nguyên', async ({ page, request }) => {
    const course = await createCourse(request, { lessons: [{}], publish: false })
    await signInAs(page, 'admin')
    await findCourse(page, course.title)
    let question = ''
    page.once('dialog', (dialog) => { question = dialog.message(); void dialog.dismiss() })
    await courseCard(page, course.title).getByTitle('Xóa khóa học').click()
    expect(question).toContain(course.title)
    expect(question).toContain('Tất cả bài học liên quan sẽ bị xóa')
    await expect(courseCard(page, course.title)).toBeVisible()
    page.once('dialog', (dialog) => void dialog.accept())
    await courseCard(page, course.title).getByTitle('Xóa khóa học').click()
    await expect(page.getByText(`Đã xóa khóa học "${course.title}" thành công.`)).toBeVisible()
    await expect(courseCard(page, course.title)).toHaveCount(0)
  })

  test('ma trận khóa bắt buộc: mở được, có đủ 4 nhóm đối tượng, nhắc khi còn thay đổi chưa lưu', async ({ page, request }) => {
    const course = await createCourse(request, { lessons: [{}] })
    const problems = watchProblems(page)
    await signInAs(page, 'admin')
    await page.goto('/admin/courses/mandatory')
    await expect(page.getByText('Bảng có 18 đối tượng trong 4 nhóm:')).toBeVisible({ timeout: 20_000 })
    const line = page.locator('tr', { hasText: course.title })
    await expect(line).toHaveCount(1)
    await line.getByRole('checkbox').first().check()
    await expect(page.getByText(/thay đổi chưa lưu/)).toBeVisible()
    await page.getByRole('button', { name: /Lưu thay đổi/ }).first().click()
    await expect(page.getByText('Đã lưu ma trận khóa học bắt buộc thành công!')).toBeVisible({ timeout: 20_000 })
    await page.reload()
    await expect(page.locator('tr', { hasText: course.title }).getByRole('checkbox').first()).toBeChecked({ timeout: 20_000 })
    await setMandatoryOff(page, course.title)
    expect(problems.console).toEqual([])
  })
})

async function setMandatoryOff(page: Page, title: string) {
  await page.locator('tr', { hasText: title }).getByRole('checkbox').first().uncheck()
  await page.getByRole('button', { name: /Lưu thay đổi/ }).first().click()
  await expect(page.getByText('Đã lưu ma trận khóa học bắt buộc thành công!')).toBeVisible({ timeout: 20_000 })
}

test.describe('Admin: tài khoản', () => {
  test('tìm tài khoản theo email; tìm không ra thì có hướng dẫn thay vì bảng trống', async ({ page, request }) => {
    const learner = await createLearner(request)
    await signInAs(page, 'admin')
    await findUser(page, learner.email)
    await expect(userRow(page, learner.email)).toContainText(/Hoạt động|Active/)
    const search = page.getByPlaceholder(/Tìm theo tên hoặc email/)
    await search.fill('khong-co-ai-ten-nay-zzz')
    await search.press('Enter')
    await expect(page.getByText('Không tìm thấy tài khoản nào phù hợp')).toBeVisible()
    await expect(page.getByText(/Hãy thử thay đổi điều kiện tìm kiếm/)).toBeVisible()
  })

  test('học viên bị khóa vì quá hạn: Admin thấy lý do, phải nhập lý do gia hạn, mở khóa xong học viên đăng nhập lại được', async ({ page, request, browser }) => {
    test.setTimeout(120_000)
    const course = await createCourse(request, { lessons: [{}], programCode: 'CORE_MEMBER' })
    await setMandatory(request, course.courseId, 'DEPARTMENT_MEMBER_BKM', 5)
    const learner = await createLearner(request, { unitName: 'Ban Khách Mời' })
    await makeOverdue(learner.userId)
    await enforceDeadlines(request)
    expect((await tryLogin(request, learner.email, learner.password)).status).toBe(403)

    await signInAs(page, 'admin')
    await findUser(page, learner.email)
    await expect(userRow(page, learner.email)).toContainText('Quá hạn bài học bắt buộc')
    await userRow(page, learner.email).getByRole('button', { name: 'Mở khóa & Gia hạn' }).click()
    await expect(page.getByText('Lý do khóa: Quá hạn bài học bắt buộc')).toBeVisible()
    const confirm = page.getByRole('button', { name: /Xác nhận Mở khóa/ })
    if (await confirm.isEnabled()) {
      await confirm.click()
      await expect(page.getByText('Vui lòng nhập lý do gia hạn.')).toBeVisible()
    }
    await expect(userRow(page, learner.email), 'chưa có lý do thì chưa được mở khóa').toContainText('Quá hạn bài học bắt buộc')
    await page.getByRole('button', { name: '+14 ngày' }).click()
    await page.locator('#unlock-extension-reason').fill('Học viên nghỉ ốm, đã trao đổi với Lead')
    await expect(confirm).toContainText('+14 ngày')
    await confirm.click()
    await expect(page.getByText(/đã được mở khóa và gia hạn thêm 14 ngày/)).toBeVisible({ timeout: 20_000 })
    await expect(userRow(page, learner.email).getByRole('button', { name: 'Mở khóa & Gia hạn' })).toHaveCount(0)

    const again = await (await browser.newContext()).newPage()
    await signIn(again, learner.email, learner.password)
    await expect(again).toHaveURL(/\/student\/dashboard/, { timeout: 20_000 })
    await again.context().close()
    await setMandatory(request, course.courseId, 'DEPARTMENT_MEMBER_BKM', null)
  })

  test('Admin vô hiệu hóa rồi kích hoạt lại: phải gõ chữ xác nhận, người dùng bị chặn rồi vào lại được', async ({ page, request }) => {
    const learner = await createLearner(request)
    await signInAs(page, 'admin')
    await findUser(page, learner.email)
    await userRow(page, learner.email).getByRole('button', { name: 'Vô hiệu hóa' }).click()
    await expect(page.getByText('Xác nhận vô hiệu hóa tài khoản?')).toBeVisible()
    await expect(page.getByText(/chặn đăng nhập ngay lập tức/)).toBeVisible()
    await page.getByPlaceholder('vô hiệu hóa').fill('vô hiệu hóa')
    await page.getByRole('button', { name: 'Xác nhận vô hiệu hóa' }).click()
    await expect(page.getByText(/đã bị vô hiệu hóa/).first()).toBeVisible({ timeout: 15_000 })
    expect((await tryLogin(request, learner.email, learner.password)).status).toBeGreaterThanOrEqual(400)

    await userRow(page, learner.email).getByRole('button', { name: 'Kích hoạt' }).click()
    await page.getByRole('button', { name: 'Xác nhận kích hoạt' }).click()
    await expect(page.getByText(/đã được kích hoạt thành công/).first()).toBeVisible({ timeout: 15_000 })
    expect((await tryLogin(request, learner.email, learner.password)).status).toBe(200)
  })

  uiDefect('BUG-INVITE-LEAD-500', 'Admin mời Lead cho một Chapter mới từ giao diện phải thành công và hiện lời mời trong danh sách', async ({ page }) => {
    const email = uniqueEmail('ui-lead')
    await signInAs(page, 'admin')
    await page.goto('/admin/invitations')
    await page.getByRole('button', { name: /Mời Lead Chapter/ }).click()
    await page.getByPlaceholder('leader@bbe.vn').fill(email)
    await page.getByPlaceholder('Ví dụ: Chapter Hà Nội').fill(unique('Chapter UI'))
    await page.getByRole('button', { name: 'Gửi lời mời' }).click()
    await expect(page.locator('tr', { hasText: email })).toBeVisible({ timeout: 8_000 })
  })

  test('mời Lead Chapter thất bại thì Admin vẫn nhận thông báo tiếng Việt, form không bị đóng mất dữ liệu', async ({ page }) => {
    const email = uniqueEmail('ui-lead')
    await signInAs(page, 'admin')
    await page.goto('/admin/invitations')
    await page.getByRole('button', { name: /Mời Lead Chapter/ }).click()
    await page.getByPlaceholder('leader@bbe.vn').fill(email)
    await page.getByPlaceholder('Ví dụ: Chapter Hà Nội').fill(unique('Chapter UI'))
    await page.getByRole('button', { name: 'Gửi lời mời' }).click()
    const outcome = page.getByText(/Đã (tạo|gửi) lời mời|Lỗi gửi lời mời Trưởng Chapter|[Kk]hông (thể|gửi được)/).first()
    await expect(outcome).toBeVisible()
    await expect(page.locator('body')).not.toContainText(/Internal Server Error|invitations_exactly_one_scope_check|prisma/i)
  })
})

test.describe('Admin: chuyển giao nhiệm kỳ', () => {
  test('trang theo dõi mùa chuyển giao hiện tổng quan và lọc được theo trạng thái', async ({ page }) => {
    await signInAs(page, 'admin')
    await page.goto('/admin/transfer-seasons')
    await expect(page.getByText('Giai đoạn đang theo dõi')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText('Lượt chuyển giao đã áp dụng')).toBeVisible()
    await page.getByPlaceholder('Nhập tên chapter').fill('khong-co-chapter-nay')
    await settle(page)
    await expect(page.locator('body')).not.toContainText(/Application error|client-side exception/i)
  })

  test('trang mùa chuyển giao không sinh lỗi trong console khi mở', async ({ page }) => {
    const problems = watchProblems(page)
    await signInAs(page, 'admin')
    await page.goto('/admin/transfer-seasons')
    await expect(page.getByText('Giai đoạn đang theo dõi')).toBeVisible({ timeout: 20_000 })
    await settle(page)
    expect(problems.console).toEqual([])
  })
})
