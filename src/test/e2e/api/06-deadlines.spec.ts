import { expect, test } from '@playwright/test'
import { as, errorCode, guest, tryLogin } from '../support/api'
import { one, sql, userByEmail } from '../support/db'
import { createCourse, createLearner, daysBetween, enforceDeadlines, makeOverdue, PASSWORD, setMandatory, watchWholeVideo } from '../support/fixtures'
import { ACCOUNTS } from '../support/seed'

// Intent: docs/business-rules.md "Chương trình, deadline" + docs/KHBB.md — một hạn chung cho mọi khóa bắt buộc.
const TARGET = 'DEPARTMENT_MEMBER_BND'
const UNIT = 'Ban Nội Dung'
const ticked: string[] = []
async function mandatoryCourse(request: any, dueDays: number, lessons = 1) {
  const course = await createCourse(request, { lessons: Array.from({ length: lessons }, () => ({})), programCode: 'CORE_MEMBER' })
  await setMandatory(request, course.courseId, TARGET, dueDays)
  ticked.push(course.courseId)
  return course
}
const deadlines = async (learner: any) => (await learner.api.get('/api/v1/members/me/deadlines')).body

// Start from a group with no mandatory course, whatever earlier specs or the seed left ticked.
test.beforeAll(async ({ request }) => {
  const stale = await sql<{ course_id: string }>(`SELECT DISTINCT course_id FROM learning_rules WHERE target_code = $1 AND effective_until IS NULL AND mandatory`, [TARGET])
  for (const { course_id } of stale) await setMandatory(request, course_id, TARGET, null)
})

test.afterEach(async ({ request }) => {
  for (const courseId of ticked.splice(0)) await setMandatory(request, courseId, TARGET, null)
})

test.describe('Hạn chung của lộ trình bắt buộc', () => {
  test('người mới của nhóm học nhận khóa bắt buộc với hạn = ngày bắt đầu + số ngày của khóa', async ({ request }) => {
    const course = await mandatoryCourse(request, 10)
    const learner = await createLearner(request, { unitName: UNIT })
    const mine = await deadlines(learner)
    expect(mine.summary).toMatchObject({ totalMandatoryCourses: 1, completedMandatoryCourses: 0 })
    expect(mine.items[0]).toMatchObject({ courseId: course.courseId, status: 'ASSIGNED' })
    const path = (await learner.api.get('/api/v1/learning/me')).body.path
    expect(daysBetween(path.startsAt, path.dueAt)).toBeCloseTo(10, 1)
    expect(mine.summary.latestDueAt).toBe(path.dueAt)
  })

  test('hai khóa 10 ngày + 10 ngày cho một hạn chung 20 ngày, không phải mỗi khóa một hạn', async ({ request }) => {
    await mandatoryCourse(request, 10)
    await mandatoryCourse(request, 10)
    const learner = await createLearner(request, { unitName: UNIT })
    const mine = await deadlines(learner)
    expect(mine.summary.totalMandatoryCourses).toBe(2)
    expect(new Set(mine.items.map((item: any) => item.dueAt)).size, 'mọi khóa dùng chung một hạn').toBe(1)
    expect(mine.summary.earliestDueAt).toBe(mine.summary.latestDueAt)
    const path = (await learner.api.get('/api/v1/learning/me')).body.path
    expect(daysBetween(path.startsAt, path.dueAt)).toBeCloseTo(20, 1)
  })

  test('thêm khóa cho người đang học: D_new = max(D_start + T_new, D_change + T_added)', async ({ request }) => {
    await mandatoryCourse(request, 10)
    const learner = await createLearner(request, { unitName: UNIT })
    // Lùi lộ trình về 5 ngày trước: hôm nay là "ngày 5" của lộ trình 10 ngày.
    await sql(`UPDATE learning_paths SET starts_at = starts_at - interval '5 days', due_at = due_at - interval '5 days' WHERE user_id = $1`, [learner.userId])
    await sql(`UPDATE user_learning_assignments SET due_at = due_at - interval '5 days', assigned_at = assigned_at - interval '5 days' WHERE user_id = $1`, [learner.userId])
    await mandatoryCourse(request, 11)
    const path = (await learner.api.get('/api/v1/learning/me')).body.path
    // max(start + 21, hôm nay + 11) = start + 21 → còn 16 ngày kể từ hôm nay.
    expect(daysBetween(path.startsAt, path.dueAt)).toBeCloseTo(21, 1)
    expect(daysBetween(new Date(), path.dueAt)).toBeCloseTo(16, 0)
  })

  test('người đã xong hết, thêm khóa 10 ngày → hạn = ngày thêm + 10', async ({ request }) => {
    const done = await mandatoryCourse(request, 10)
    const learner = await createLearner(request, { unitName: UNIT })
    await watchWholeVideo(learner, done.lessons[0].lessonId, 40)
    expect((await deadlines(learner)).summary.completedMandatoryCourses).toBe(1)
    await sql(`UPDATE learning_paths SET starts_at = starts_at - interval '40 days', due_at = due_at - interval '40 days' WHERE user_id = $1`, [learner.userId])
    await mandatoryCourse(request, 10)
    const path = (await learner.api.get('/api/v1/learning/me')).body.path
    expect(daysBetween(new Date(), path.dueAt)).toBeCloseTo(10, 0)
  })

  test('bỏ tick khóa bắt buộc duy nhất thì không còn hạn', async ({ request }) => {
    const course = await mandatoryCourse(request, 10)
    const learner = await createLearner(request, { unitName: UNIT })
    expect((await deadlines(learner)).summary.totalMandatoryCourses).toBe(1)
    await setMandatory(request, course.courseId, TARGET, null)
    const mine = await deadlines(learner)
    expect(mine.summary.totalMandatoryCourses).toBe(0)
    expect((await learner.api.get('/api/v1/learning/me')).body.path.dueAt).toBeNull()
  })

  test('khóa bắt buộc chỉ áp cho đúng nhóm học: ban khác, DNA và Lead không nhận', async ({ request }) => {
    await mandatoryCourse(request, 10)
    const otherDepartment = await createLearner(request)
    expect((await deadlines(otherDepartment)).summary.totalMandatoryCourses).toBe(0)
    expect((await deadlines(await as(request, 'dnaMember').then((api) => ({ api })))).summary.totalMandatoryCourses).toBe(0)
    const leads = await sql(`SELECT count(*)::int AS total FROM user_learning_assignments a JOIN users u ON u.id = a.user_id WHERE u.role IN ('ADMIN', 'LEAD') AND a.ended_at IS NULL`)
    expect(leads[0].total, 'ADMIN và LEAD không có khóa bắt buộc').toBe(0)
  })

  test('số ngày không hợp lệ và nhóm học không tồn tại bị từ chối', async ({ request }) => {
    const admin = await as(request, 'admin')
    const course = await createCourse(request, { lessons: [{}], programCode: 'CORE_MEMBER' })
    for (const dueDays of [0, -3, 1.5, 3651, 'abc']) {
      const result = await admin.put('/api/v1/admin/mandatory-matrix', { changes: [{ courseId: course.courseId, targetKey: TARGET, enabled: true, dueDays }] })
      expect(result.status, String(dueDays)).toBe(400)
    }
    const unknown = await admin.put('/api/v1/admin/mandatory-matrix', { changes: [{ courseId: course.courseId, targetKey: 'NHOM_KHONG_CO', enabled: true, dueDays: 5 }] })
    expect(unknown.status).toBe(400)
    expect(unknown.body.error.message).toMatch(/18 đối tượng/)
    expect((await admin.put('/api/v1/admin/mandatory-matrix', {})).status).toBe(400)
  })

  test('chỉ Admin cấu hình khóa bắt buộc', async ({ request }) => {
    for (const account of ['chapterLead', 'dnaLead', 'member'] as const) {
      const actor = await as(request, account)
      expect((await actor.get('/api/v1/admin/mandatory-matrix')).status, account).toBe(403)
      expect((await actor.put('/api/v1/admin/mandatory-matrix', { changes: [] })).status, account).toBe(403)
    }
    expect((await guest(request).get('/api/v1/admin/mandatory-matrix')).status).toBe(401)
  })
})

test.describe('Khóa tài khoản do quá hạn', () => {
  test('quá hạn → cron khóa; đăng nhập báo rõ lý do; chỉ "Mở khóa & Gia hạn" mở được; lịch sử khóa được giữ', async ({ request }) => {
    await mandatoryCourse(request, 10)
    const learner = await createLearner(request, { unitName: UNIT })
    await makeOverdue(learner.userId)
    const cron = await enforceDeadlines(request)
    expect(cron.lockedUsers).toContain(learner.userId)
    expect(await userByEmail(learner.email)).toMatchObject({ status: 'LOCKED', lock_reason: 'OVERDUE_LOCK' })

    const blocked = await tryLogin(request, learner.email, PASSWORD)
    expect(blocked.status).toBe(403)
    expect(blocked.body.error).toMatchObject({ code: 'AccountLocked', lockReason: 'OVERDUE_LOCK' })
    expect(blocked.body.error.message).toMatch(/quá hạn/)
    expect(blocked.body.error.message, 'người học biết phải làm gì').toMatch(/Admin/)
    expect((await learner.api.get('/api/v1/users/me')).status, 'phiên đang mở bị chặn ngay').toBe(401)

    const admin = await as(request, 'admin')
    const activate = await admin.patch(`/api/v1/users/${learner.userId}`, { status: 'ACTIVE' })
    expect(activate.status).toBe(409)
    expect(errorCode(activate)).toBe('OverdueUnlockRequiresExtension')
    expect(activate.body.error.message).toContain('Mở khóa & Gia hạn')
    expect((await admin.post('/api/v1/admin/restrictions', { action: 'LIFT', targetType: 'USER', targetId: learner.userId })).status).toBe(409)

    const extend = (body: unknown) => admin.post(`/api/v1/admin/users/${learner.userId}/extend-deadline`, body)
    expect(errorCode(await extend({ extensionDays: 5 }))).toBe('ReasonRequired')
    for (const extensionDays of [0, -1, 366, 2.5, 'abc']) expect((await extend({ extensionDays, reason: 'Nghỉ ốm' })).status, String(extensionDays)).toBe(400)
    expect((await userByEmail(learner.email)).status).toBe('LOCKED')

    const extended = await extend({ extensionDays: 5, reason: 'Nghỉ ốm có giấy' })
    expect(extended.status, JSON.stringify(extended.body)).toBe(200)
    expect(extended.body).toMatchObject({ unlocked: true, accountStatus: 'ACTIVE', accountLockReason: null })
    expect(daysBetween(new Date(), extended.body.newDueAt), 'hạn mới = hôm nay + N ngày').toBeCloseTo(5, 1)
    expect((await tryLogin(request, learner.email, PASSWORD)).status).toBe(200)

    const history = await sql(`SELECT type, lifted_at, lifted_by_user_id FROM access_restrictions WHERE user_id = $1`, [learner.userId])
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({ type: 'DEADLINE', lifted_by_user_id: admin.session.user.id })
    expect(history[0].lifted_at).not.toBeNull()
    expect((await enforceDeadlines(request)).lockedUsers, 'hạn đã gia thì cron không khóa lại').not.toContain(learner.userId)
  })

  test('còn hạn thì cron không khóa; chạy cron hai lần không khóa hai lần', async ({ request }) => {
    await mandatoryCourse(request, 10)
    const onTime = await createLearner(request, { unitName: UNIT })
    const late = await createLearner(request, { unitName: UNIT })
    await makeOverdue(late.userId)
    expect((await enforceDeadlines(request)).lockedUsers).toEqual(expect.not.arrayContaining([onTime.userId]))
    await enforceDeadlines(request)
    expect((await userByEmail(onTime.email)).status).toBe('ACTIVE')
    expect(await sql(`SELECT id FROM access_restrictions WHERE user_id = $1`, [late.userId])).toHaveLength(1)
  })

  test('đã học xong trước hạn thì không bị khóa dù hạn đã qua', async ({ request }) => {
    const course = await mandatoryCourse(request, 10)
    const learner = await createLearner(request, { unitName: UNIT })
    await watchWholeVideo(learner, course.lessons[0].lessonId, 40)
    await makeOverdue(learner.userId)
    expect((await enforceDeadlines(request)).lockedUsers).not.toContain(learner.userId)
    expect((await userByEmail(learner.email)).status).toBe('ACTIVE')
  })

  test('khóa đã hủy xuất bản không làm ai bị khóa quá hạn', async ({ request }) => {
    const course = await mandatoryCourse(request, 10)
    const learner = await createLearner(request, { unitName: UNIT })
    expect((await (await as(request, 'admin')).post(`/api/v1/courses/${course.courseId}/unpublish`)).status).toBe(200)
    await makeOverdue(learner.userId)
    expect((await enforceDeadlines(request)).lockedUsers).not.toContain(learner.userId)
    expect((await userByEmail(learner.email)).status).toBe('ACTIVE')
  })

  test('"Mở khóa & Gia hạn" chỉ dùng cho khóa quá hạn: không mở khóa mật khẩu, không áp cho tài khoản đang hoạt động', async ({ request }) => {
    const admin = await as(request, 'admin')
    const active = await createLearner(request)
    expect((await admin.post(`/api/v1/admin/users/${active.userId}/extend-deadline`, { extensionDays: 5, reason: 'Thử' })).status).toBeGreaterThanOrEqual(400)
    for (let attempt = 0; attempt < 5; attempt += 1) await tryLogin(request, active.email, 'Sai-mat-khau-1')
    expect((await userByEmail(active.email)).lock_reason).toBe('PASSWORD_LOCK')
    expect((await admin.post(`/api/v1/admin/users/${active.userId}/extend-deadline`, { extensionDays: 5, reason: 'Thử' })).status).toBeGreaterThanOrEqual(400)
    expect((await userByEmail(active.email)).status, 'khóa mật khẩu chỉ mở bằng đặt lại mật khẩu').toBe('LOCKED')
  })

  test('chỉ Admin gia hạn; cron chỉ chạy với đúng secret', async ({ request }) => {
    const target = await one(`SELECT id FROM users WHERE email = $1`, [ACCOUNTS.member])
    for (const account of ['chapterLead', 'dnaLead', 'member'] as const) {
      const actor = await as(request, account)
      expect((await actor.post(`/api/v1/admin/users/${target.id}/extend-deadline`, { extensionDays: 5, reason: 'Thử' })).status, account).toBe(403)
      expect((await actor.get('/api/v1/admin/restrictions')).status, account).toBe(403)
      expect((await actor.post('/api/v1/admin/restrictions', { action: 'LOCK', targetType: 'USER', targetId: target.id })).status, account).toBe(403)
      expect((await actor.post('/api/internal/learning/deadlines/enforce')).status, account).toBe(401)
    }
    expect((await guest(request).post('/api/internal/learning/deadlines/enforce')).status).toBe(401)
    expect((await request.post('/api/internal/learning/deadlines/enforce', { headers: { Cookie: 'x=1', Authorization: 'Bearer sai' } })).status()).toBe(401)
  })
})

test.describe('Khóa và mở tài khoản thủ công', () => {
  test('Admin khóa trực tiếp một thành viên: không đăng nhập được, mở lại thì dùng bình thường; không khóa được Admin', async ({ request }) => {
    const admin = await as(request, 'admin')
    const learner = await createLearner(request)
    const locked = await admin.post('/api/v1/admin/restrictions', { action: 'LOCK', targetType: 'USER', targetId: learner.userId, reason: 'Vi phạm nội quy' })
    expect(locked.status, JSON.stringify(locked.body)).toBeLessThan(300)
    const blocked = await tryLogin(request, learner.email, PASSWORD)
    expect(blocked.status).toBe(403)
    expect(blocked.body.error.message.length).toBeGreaterThan(10)
    expect((await learner.api.get('/api/v1/users/me')).status).toBe(401)
    const lifted = await admin.post('/api/v1/admin/restrictions', { action: 'LIFT', targetType: 'USER', targetId: learner.userId })
    expect(lifted.status, JSON.stringify(lifted.body)).toBeLessThan(300)
    expect((await tryLogin(request, learner.email, PASSWORD)).status).toBe(200)
    const self = await admin.post('/api/v1/admin/restrictions', { action: 'LOCK', targetType: 'USER', targetId: admin.session.user.id })
    expect(self.status).toBe(403)
    expect((await admin.post('/api/v1/admin/restrictions', { action: 'XOA', targetType: 'USER', targetId: learner.userId })).status).toBe(400)
  })
})
