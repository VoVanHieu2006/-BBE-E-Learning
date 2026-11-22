import fs from 'node:fs'
import path from 'node:path'
import { expect, test, type Browser, type APIRequestContext } from '@playwright/test'
import { createCourse, uiDefect } from '../support/fixtures'
import type { AccountKey } from '../support/seed'
import { auditPage, settle, signInAs, watchProblems, type Audit } from '../support/ui'

// Comfort baseline for every screen a person can reach, measured on the rendered page at this project's viewport
// (desktop and phone). One crawl feeds all checks; the raw measurements are kept in artifacts/e2e for the report.
type Role = 'guest' | Extract<AccountKey, 'member' | 'chapterLead' | 'dnaLead' | 'admin'>
type Row = Audit & { role: Role; page: string; console: string[]; failed: string[] }
const PAGES: Record<Role, string[]> = {
  guest: ['/', '/login', '/forgot-password', '/leaderboard', '/reset-password', '/accept-invitation'],
  member: ['/student/dashboard', '/student/courses', '/student/progress', '/student/stars', '/student/leaderboard', '/student/profile', '<khóa học>', '<bài học>', '<bài kiểm tra>'],
  chapterLead: ['/chapter-manager/dashboard', '/chapter-manager/members', '/chapter-manager/leaderboard', '/chapter-manager/courses', '/chapter-manager/invitations', '/chapter-manager/term-transition'],
  dnaLead: ['/organization-manager/dashboard', '/organization-manager', '/organization-manager/leaderboard', '/organization-manager/courses', '/organization-manager/invitations'],
  admin: ['/admin/dashboard', '/admin/users', '/admin/chapters', '/admin/courses', '/admin/courses/new', '/admin/courses/mandatory', '/admin/invitations', '/admin/transfer-seasons', '<soạn khóa học>'],
}

async function crawl(browser: Browser, request: APIRequestContext, contextOptions: object): Promise<Row[]> {
  const course = await createCourse(request, { lessons: [{ quiz: { questions: 2 } }], visibility: 'PUBLIC' })
  const dynamic: Record<string, string> = {
    '<khóa học>': `/student/courses/${course.courseId}`,
    '<bài học>': `/student/learning/${course.lessons[0].lessonId}`,
    '<bài kiểm tra>': `/student/learning/${course.lessons[0].lessonId}/quiz`,
    '<soạn khóa học>': `/admin/courses/${course.courseId}/edit`,
  }
  const rows: Row[] = []
  for (const role of Object.keys(PAGES) as Role[]) {
    const context = await browser.newContext(contextOptions)
    const page = await context.newPage()
    const problems = watchProblems(page)
    if (role !== 'guest') await signInAs(page, role)
    for (const name of PAGES[role]) {
      problems.console.length = 0
      problems.failedRequests.length = 0
      await page.goto(dynamic[name] || name)
      await settle(page)
      await page.waitForTimeout(400)
      rows.push({ role, page: name, ...(await auditPage(page)), console: [...problems.console], failed: [...problems.failedRequests] })
    }
    await context.close()
  }
  return rows
}

let survey: Promise<Row[]> | undefined
// The crawl is shared by every check below; the file survives a worker restart within the same run (same parent pid).
function rowsFor(browser: Browser, request: APIRequestContext): Promise<Row[]> {
  const info = test.info()
  const file = path.join(info.config.rootDir, '..', '..', '..', 'artifacts', 'e2e', `ux-survey-${info.project.name}-${process.ppid}.json`)
  survey ||= (async () => {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')) as Row[]
    const { baseURL, viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, locale, timezoneId } = info.project.use
    const rows = await crawl(browser, request, { baseURL, viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, locale, timezoneId })
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(rows, null, 1))
    return rows
  })()
  return survey
}
const offenders = (rows: Row[], pick: (row: Row) => string[] | false | null | undefined | string) =>
  rows.flatMap((row) => { const found = pick(row); return !found || (Array.isArray(found) && !found.length) ? [] : [`${row.role} ${row.page}: ${Array.isArray(found) ? [...new Set(found)].slice(0, 4).join(' | ') : found}`] })

test.describe('Mọi trang', () => {
  test.describe.configure({ timeout: 360_000 })

  test('tải xong không có lỗi JavaScript và không có request nào lỗi máy chủ', async ({ browser, request }) => {
    const rows = await rowsFor(browser, request)
    expect(rows.length).toBe(Object.values(PAGES).flat().length)
    // /admin/transfer-seasons is tracked on its own as BUG-UI-HYDRATION-TRANSFER.
    expect(offenders(rows.filter((row) => row.page !== '/admin/transfer-seasons'), (row) => [...row.console, ...row.failed])).toEqual([])
  })

  test('không trang nào phải cuộn ngang', async ({ browser, request }) => {
    expect(offenders(await rowsFor(browser, request), (row) => row.overflowPx > 1 && `tràn ${row.overflowPx}px`)).toEqual([])
  })

  test('khai báo tiếng Việt và không lộ giá trị thô (undefined, NaN, null, Invalid Date) ra màn hình', async ({ browser, request }) => {
    const rows = await rowsFor(browser, request)
    expect(offenders(rows, (row) => row.lang !== 'vi' && `lang="${row.lang}"`)).toEqual([])
    expect(offenders(rows, (row) => row.rawValues)).toEqual([])
  })

  test('mọi nút và đường dẫn đều có tên để người dùng trình đọc màn hình biết nó làm gì', async ({ browser, request }) => {
    expect(offenders(await rowsFor(browser, request), (row) => row.unnamedControls)).toEqual([])
  })

  test('mọi hình ảnh đều có mô tả thay thế', async ({ browser, request }) => {
    expect(offenders(await rowsFor(browser, request), (row) => row.imagesWithoutAlt)).toEqual([])
  })

  uiDefect('BUG-A11Y-LABELS', 'mọi ô nhập và ô chọn đều gắn nhãn (không chỉ có placeholder)', async ({ page, request }) => {
    expect(offenders(await rowsFor(page.context().browser()!, request), (row) => row.unlabeledFields)).toEqual([])
  })

  uiDefect('BUG-A11Y-LANDMARK', 'mỗi trang có đúng một vùng nội dung chính (main)', async ({ page, request }) => {
    expect(offenders(await rowsFor(page.context().browser()!, request), (row) => row.mains !== 1 && `${row.mains} vùng main`)).toEqual([])
  })

  uiDefect('BUG-A11Y-H1', 'mỗi trang có đúng một tiêu đề chính (h1) cho biết đang ở đâu', async ({ page, request }) => {
    expect(offenders(await rowsFor(page.context().browser()!, request), (row) => row.h1 !== 1 && `${row.h1} thẻ h1`)).toEqual([])
  })

  uiDefect('BUG-UX-PAGE-TITLE', 'tên tab trình duyệt cho biết đang ở trang nào, không phải mọi trang cùng một tên', async ({ page, request }) => {
    const rows = await rowsFor(page.context().browser()!, request)
    expect(new Set(rows.map((row) => row.title)).size).toBeGreaterThan(rows.length / 2)
  })

  uiDefect('BUG-UX-TINY-TEXT', 'không có chữ nhỏ hơn 11px', async ({ page, request }) => {
    expect(offenders(await rowsFor(page.context().browser()!, request), (row) => row.tinyText)).toEqual([])
  })

  uiDefect('BUG-UX-TOUCH-TARGET', 'trên điện thoại, mọi nút đều đủ lớn để chạm (tối thiểu 24px theo WCAG 2.2)', async ({ page, request }) => {
    test.skip(test.info().project.name !== 'mobile', 'chỉ đo trên điện thoại')
    expect(offenders(await rowsFor(page.context().browser()!, request), (row) => row.smallTargets)).toEqual([])
  })

  uiDefect('BUG-UI-HYDRATION-TRANSFER', 'mở lại trang mùa chuyển giao trong cùng tab không sinh lỗi React', async ({ page }) => {
    const problems = watchProblems(page)
    await signInAs(page, 'admin')
    for (let visit = 0; visit < 2; visit += 1) {
      await page.goto('/admin/transfer-seasons')
      await expect(page.getByText('Giai đoạn đang theo dõi')).toBeVisible({ timeout: 20_000 })
      await settle(page)
    }
    expect(problems.console).toEqual([])
  })
})
