import { expect, test } from '@playwright/test'
import { Api, as, errorCode, guest, login, tryLogin } from '../support/api'
import { one, sql, userByEmail } from '../support/db'
import { createCourse, createLearner, CRON_HEADERS, defect, PASSWORD, starBalance, watchWholeVideo } from '../support/fixtures'
import { ACCOUNTS } from '../support/seed'

// Intent: docs/business-rules.md "Vai trò và phạm vi", "Chuyển giao nhiệm kỳ", "Bảng xếp hạng".
const chapterOf = async (request: any, account: 'chapterLead' | 'otherChapterLead' | 'transferChapterLead') => (await as(request, account)).session.user.chapterId as string

test.describe('Phạm vi quản lý theo đơn vị', () => {
  test('Lead Chapter xem được thành viên và tiến độ của Chapter mình', async ({ request }) => {
    const lead = await as(request, 'chapterLead')
    const chapterId = await chapterOf(request, 'chapterLead')
    const learner = await createLearner(request)
    const members = await lead.get(`/api/v1/chapters/${chapterId}/dashboard/members`)
    expect(members.status).toBe(200)
    expect(members.body.items.map((item: any) => item.userId)).toContain(learner.userId)
    const progress = await lead.get(`/api/v1/chapters/${chapterId}/members/${learner.userId}/course-progress`)
    expect(progress.status).toBe(200)
    expect(progress.body.user.email).toBe(learner.email)
    expect(progress.body.summary).toMatchObject({ completedLessons: 0, stars: 0 })
  })

  test('Lead Chapter không đọc được bất cứ dữ liệu nào của Chapter khác', async ({ request }) => {
    const lead = await as(request, 'chapterLead')
    const other = await chapterOf(request, 'otherChapterLead')
    const outsider = await userByEmail(ACCOUNTS.otherChapterMember)
    for (const path of ['members', 'dashboard/members', 'dashboard/courses', 'current-roster', 'kpi', 'reorganizations', `members/${outsider.id}/course-progress`]) {
      const result = await lead.get(`/api/v1/chapters/${other}/${path}`)
      expect(result.status, path).toBe(403)
      expect(JSON.stringify(result.body), path).not.toContain(ACCOUNTS.otherChapterMember)
    }
  })

  test('Lead Chapter không xem được thành viên Chapter khác qua đường dẫn Chapter của mình', async ({ request }) => {
    const lead = await as(request, 'chapterLead')
    const outsider = await userByEmail(ACCOUNTS.otherChapterMember)
    const result = await lead.get(`/api/v1/chapters/${await chapterOf(request, 'chapterLead')}/members/${outsider.id}/course-progress`)
    expect([403, 404]).toContain(result.status)
  })

  test('Lead Chapter và Lead DNA không quản lý đơn vị của nhau', async ({ request }) => {
    const lead = await as(request, 'chapterLead')
    const dna = await as(request, 'dnaLead')
    const chapterUnits = (await lead.get('/api/v1/organization/managed-units')).body.items
    const dnaUnits = (await dna.get('/api/v1/organization/managed-units')).body.items
    expect(chapterUnits.every((unit: any) => ['CHAPTER', 'DEPARTMENT'].includes(unit.type))).toBe(true)
    expect(dnaUnits.every((unit: any) => ['DNA', 'DNA_GROUP'].includes(unit.type))).toBe(true)
    expect((await lead.get(`/api/v1/organization/units/${dnaUnits[0].id}/members`)).status).toBe(403)
    expect((await dna.get(`/api/v1/organization/units/${chapterUnits[0].id}/members`)).status).toBe(403)
    expect((await dna.get(`/api/v1/chapters/${await chapterOf(request, 'chapterLead')}/members`)).status).toBe(403)
    expect((await lead.post('/api/v1/invitations/member', { email: 'x@e2e.bbe.test', organizationUnitId: dnaUnits[1].id })).status).toBe(403)
  })

  test('Thành viên, Trưởng ban và President không có quyền quản lý', async ({ request }) => {
    const chapterId = await chapterOf(request, 'chapterLead')
    for (const account of ['member', 'departmentLead', 'president', 'dnaMember'] as const) {
      const actor = await as(request, account)
      expect((await actor.get('/api/v1/organization/managed-units')).body.items, account).toEqual([])
      expect((await actor.get(`/api/v1/chapters/${chapterId}/members`)).status, account).toBe(403)
      expect((await actor.get(`/api/v1/chapters/${chapterId}/dashboard/members`)).status, account).toBe(403)
      expect((await actor.get('/api/v1/users')).status, account).toBe(403)
      expect((await actor.get('/api/v1/admin/organization')).status, account).toBe(403)
      expect((await actor.get('/api/v1/admin/overview')).status, account).toBe(403)
    }
  })

  test('danh sách tài khoản toàn hệ thống và cấu trúc tổ chức chỉ dành cho Admin', async ({ request }) => {
    const admin = await as(request, 'admin')
    expect((await admin.get('/api/v1/users?limit=5')).body.items.length).toBeGreaterThan(0)
    expect((await admin.get('/api/v1/admin/organization')).status).toBe(200)
    for (const account of ['chapterLead', 'dnaLead'] as const) {
      const actor = await as(request, account)
      expect((await actor.get('/api/v1/users')).status, account).toBe(403)
      expect((await actor.get('/api/v1/admin/organization')).status, account).toBe(403)
      expect((await actor.post('/api/v1/admin/organization', { action: 'CREATE_UNIT', name: 'Lén tạo', type: 'CHAPTER' })).status, account).toBe(403)
    }
    expect((await guest(request).get('/api/v1/users')).status).toBe(401)
  })

  test('không ai tự nâng quyền qua API cập nhật tài khoản', async ({ request }) => {
    const admin = await as(request, 'admin')
    const learner = await createLearner(request)
    expect((await admin.patch(`/api/v1/users/${learner.userId}`, { role: 'ADMIN' })).status).toBe(400)
    expect((await learner.api.patch(`/api/v1/users/${learner.userId}`, { status: 'ACTIVE', role: 'ADMIN' })).status).toBe(403)
    expect((await learner.api.patch('/api/v1/users/me', { displayName: 'Tên Hợp Lệ', role: 'ADMIN' })).status).toBe(200)
    expect((await userByEmail(learner.email)).role).toBe('MEMBER')
  })
})

test.describe('Quản lý thành viên', () => {
  test('Lead vô hiệu hóa thành viên của mình: phiên bị chặn ngay; chỉ Admin kích hoạt lại', async ({ request }) => {
    const lead = await as(request, 'chapterLead')
    const learner = await createLearner(request)
    const off = await lead.patch(`/api/v1/users/${learner.userId}`, { status: 'INACTIVE' })
    expect(off.status, JSON.stringify(off.body)).toBe(200)
    expect((await learner.api.get('/api/v1/users/me')).status).toBe(401)
    const blocked = await tryLogin(request, learner.email, PASSWORD)
    expect(blocked.status).toBe(403)
    expect(blocked.body.error.message, 'thông báo tiếng Việt, dễ hiểu').toMatch(/vô hiệu|ngừng|khóa|liên hệ/i)
    const byLead = await lead.patch(`/api/v1/users/${learner.userId}`, { status: 'ACTIVE' })
    expect(byLead.status, 'chỉ Admin kích hoạt lại').toBe(403)
    expect(byLead.body.error.message).toMatch(/Chỉ Admin/)
    const on = await (await as(request, 'admin')).patch(`/api/v1/users/${learner.userId}`, { status: 'ACTIVE' })
    expect(on.status, JSON.stringify(on.body)).toBe(200)
    expect((await tryLogin(request, learner.email, PASSWORD)).status).toBe(200)
  })

  test('Lead không vô hiệu hóa được người ngoài Chapter, Lead khác hay Admin; trạng thái lạ bị từ chối', async ({ request }) => {
    const lead = await as(request, 'chapterLead')
    for (const email of [ACCOUNTS.otherChapterMember, ACCOUNTS.otherChapterLead, ACCOUNTS.admin, ACCOUNTS.dnaMember]) {
      const target = await userByEmail(email)
      expect((await lead.patch(`/api/v1/users/${target.id}`, { status: 'INACTIVE' })).status, email).toBe(403)
      expect((await userByEmail(email)).status, email).toBe('ACTIVE')
    }
    const learner = await createLearner(request)
    for (const status of ['LOCKED', 'DELETED', '', null]) expect((await lead.patch(`/api/v1/users/${learner.userId}`, { status })).status, String(status)).toBe(400)
    expect((await lead.patch('/api/v1/users/khong-phai-id', { status: 'INACTIVE' })).status).toBeGreaterThanOrEqual(400)
  })

  test('Lead chuyển ban cho thành viên trong Chapter; ban của Chapter khác bị từ chối', async ({ request }) => {
    const lead = await as(request, 'chapterLead')
    const chapterId = await chapterOf(request, 'chapterLead')
    const learner = await createLearner(request)
    const units = (await lead.get('/api/v1/organization/managed-units')).body.items
    const target = units.find((unit: any) => unit.name === 'Ban Thư Ký')
    const moved = await lead.post(`/api/v1/chapters/${chapterId}/members/${learner.userId}/department`, { departmentUnitId: target.id })
    expect(moved.status, JSON.stringify(moved.body)).toBe(200)
    const me = async () => (await new Api(request, (await login(request, learner.email, PASSWORD)).accessToken).get('/api/v1/users/me')).body
    expect((await me()).currentDepartment).toMatchObject({ id: target.id, name: 'Ban Thư Ký' })
    expect((await me()).departmentHistory.map((row: any) => row.departmentName)).toEqual(expect.arrayContaining(['Ban Chất Lượng', 'Ban Thư Ký']))

    const foreign = await one(`SELECT d.id FROM organization_units d JOIN organization_units c ON c.id = d.parent_id WHERE c.name = 'Chi hội TP. Hồ Chí Minh' AND d.type = 'DEPARTMENT' LIMIT 1`)
    const rejected = await lead.post(`/api/v1/chapters/${chapterId}/members/${learner.userId}/department`, { departmentUnitId: foreign.id })
    expect(rejected.status).toBe(400)
    expect(errorCode(rejected)).toBe('InvalidDepartment')
    expect((await me()).currentDepartment.id).toBe(target.id)

    const outsider = await userByEmail(ACCOUNTS.otherChapterMember)
    expect((await lead.post(`/api/v1/chapters/${chapterId}/members/${outsider.id}/department`, { departmentUnitId: target.id })).status).toBe(404)
    expect((await (await as(request, 'member')).post(`/api/v1/chapters/${chapterId}/members/${learner.userId}/department`, { departmentUnitId: target.id })).status).toBe(403)
  })

  defect('BUG-MOVE-SESSION-MSG', 'bị chuyển ban thì phiên cũ phải báo "đăng nhập lại" bằng tiếng Việt, không báo tài khoản bị vô hiệu hóa', async ({ request }) => {
    const lead = await as(request, 'chapterLead')
    const learner = await createLearner(request)
    const target = (await lead.get('/api/v1/organization/managed-units')).body.items.find((unit: any) => unit.name === 'Ban Thư Ký')
    await lead.post(`/api/v1/chapters/${await chapterOf(request, 'chapterLead')}/members/${learner.userId}/department`, { departmentUnitId: target.id })
    const stale = await learner.api.get('/api/v1/users/me')
    const refreshed = await new Api(request).post('/api/v1/auth/refresh', { refreshToken: learner.session.refreshToken })
    for (const result of [stale, refreshed]) {
      if (result.status === 200) continue
      expect(result.body.error.message).toMatch(/đăng nhập lại/i)
      expect(result.body.error.message).not.toMatch(/inactive|vô hiệu hóa/i)
    }
  })

  test('người dùng tự sửa tên hiển thị trong giới hạn 2–120 ký tự', async ({ request }) => {
    const learner = await createLearner(request)
    expect((await learner.api.patch('/api/v1/users/me', { displayName: '  Nguyễn Văn Á  ' })).body.displayName).toBe('Nguyễn Văn Á')
    for (const displayName of ['', 'A', 'x'.repeat(121), 42, null]) {
      const result = await learner.api.patch('/api/v1/users/me', { displayName })
      expect(result.status, String(displayName).slice(0, 10)).toBe(400)
      expect(result.body.error.message).toMatch(/2 đến 120/)
    }
    expect((await learner.api.get('/api/v1/users/me')).body.displayName).toBe('Nguyễn Văn Á')
    expect((await guest(request).patch('/api/v1/users/me', { displayName: 'Khách' })).status).toBe(401)
  })
})

test.describe('Bảng xếp hạng', () => {
  test('sao vừa nhận xuất hiện trên bảng xếp hạng; Admin và Lead không có mặt; xếp giảm dần theo sao', async ({ request }) => {
    const course = await createCourse(request, { lessons: [{ durationSeconds: 3600 }] })
    const learner = await createLearner(request)
    await watchWholeVideo(learner, course.lessons[0].lessonId, 3600)
    expect(await starBalance(learner)).toBe(60)
    const board = (await learner.api.get('/api/v1/leaderboard?limit=100')).body.items as any[]
    const mine = board.find((row) => row.userId === learner.userId)
    expect(mine, 'người học thấy mình trên bảng').toBeTruthy()
    expect(mine.stars).toBe(60)
    expect(board.map((row) => row.stars)).toEqual([...board.map((row) => row.stars)].sort((a, b) => b - a))
    const managers = await sql(`SELECT id FROM users WHERE role IN ('ADMIN', 'LEAD')`)
    expect(board.filter((row) => managers.some((manager: any) => manager.id === row.userId))).toEqual([])
  })

  test('bảng xếp hạng thành viên không lộ email của người khác', async ({ request }) => {
    const member = await as(request, 'member')
    for (const path of ['/api/v1/leaderboard?limit=100', '/api/v1/leaderboard?period=term&limit=100', '/api/v1/leaderboard/chapters']) {
      const board = await member.get(path)
      expect(board.status, path).toBe(200)
      expect(JSON.stringify(board.body), path).not.toMatch(/@(bbe\.vn|e2e\.bbe\.test)/)
    }
  })

  test('bảng xếp hạng theo kỳ và bảng nội bộ Chapter không lộ email', async ({ request }) => {
    const member = await as(request, 'member')
    const chapterId = await chapterOf(request, 'chapterLead')
    for (const path of [`/api/v1/leaderboard/chapters/${chapterId}`, '/api/v1/learning/periods', '/api/v1/leaderboard?group=MEMBER&periodType=MONTH', '/api/v1/leaderboard?group=LT&periodType=MONTH']) {
      const board = await member.get(path)
      expect(board.status, path).toBe(200)
      expect(JSON.stringify(board.body), path).not.toMatch(/@(bbe\.vn|e2e\.bbe\.test)/)
    }
  })

  test('bảng theo kỳ: thành viên Chapter chỉ xem bảng Thành viên và LT, tham số kỳ sai bị từ chối', async ({ request }) => {
    const member = await as(request, 'member')
    for (const group of ['DNA', 'CHAPTER']) {
      const denied = await member.get(`/api/v1/leaderboard?group=${group}&periodType=MONTH`)
      expect(denied.status, group).toBe(403)
      expect(denied.body.error.message).toMatch(/Thành viên và LT/)
    }
    expect((await member.get('/api/v1/leaderboard?group=MEMBER&periodType=MONTH&periodId=2026-13')).status).toBe(400)
    expect((await member.get("/api/v1/leaderboard?group=MEMBER&periodType=TERM&periodId=1'--")).status).toBe(400)
  })

  defect('BUG-LB-GUEST-SCOPE', 'khách không được xem bảng DNA/Chapter theo kỳ mà thành viên đã đăng nhập bị cấm xem', async ({ request }) => {
    const member = await as(request, 'member')
    for (const group of ['DNA', 'CHAPTER']) {
      const path = `/api/v1/leaderboard?group=${group}&periodType=MONTH`
      expect((await member.get(path)).status, group).toBe(403)
      expect((await guest(request).get(path)).status, `khách xem bảng ${group}`).not.toBe(200)
    }
  })

  test('thành viên không xem được bảng nội bộ của Chapter khác; bảng DNA chỉ cho Lead DNA và Admin', async ({ request }) => {
    const member = await as(request, 'member')
    const other = await chapterOf(request, 'otherChapterLead')
    expect((await member.get(`/api/v1/leaderboard/chapters/${other}`)).status).toBe(403)
    const denied = await member.get('/api/v1/organization/dna-leaderboard')
    expect(denied.status).toBe(403)
    expect(denied.body.error.message).toMatch(/Lead DNA hoặc Admin/)
    expect((await (await as(request, 'chapterLead')).get('/api/v1/organization/dna-leaderboard')).status).toBe(403)
    for (const account of ['dnaLead', 'admin'] as const) expect((await (await as(request, account)).get('/api/v1/organization/dna-leaderboard')).status, account).toBe(200)
  })

  test('phân trang bảng xếp hạng chịu được tham số xấu', async ({ request }) => {
    const member = await as(request, 'member')
    for (const query of ['limit=0', 'limit=-5', 'limit=999999', 'limit=abc', 'page=0', 'page=-1', 'page=abc', "page=1'%20OR%201=1"]) {
      const board = await member.get(`/api/v1/leaderboard?${query}`)
      expect(board.status, query).toBe(200)
      expect(board.body.items.length, query).toBeLessThanOrEqual(100)
    }
  })

  test('kỳ thi đua cho biết rõ vì sao chưa sẵn sàng thay vì trả bảng rỗng không lời giải thích', async ({ request }) => {
    const periods = (await (await as(request, 'member')).get('/api/v1/learning/periods')).body
    expect(periods.readiness.periods.month.ready).toBe(true)
    for (const part of Object.values(periods.readiness.periods) as any[]) expect(part.message.length).toBeGreaterThan(5)
  })
})

test.describe('Chuyển giao nhiệm kỳ', () => {
  const SEASON = { code: 'E2E_2026_H2', startsAt: '2026-07-01T00:00:00+07:00', endsAt: '2027-01-01T00:00:00+07:00', rewardBoundaryAt: '2026-10-01T00:00:00+07:00' }
  const future = () => new Date(Date.now() + 3 * 86_400_000).toISOString()
  let chapterId: string
  let nextTerm: number
  let departments: { id: string; name: string }[]
  let members: { userId: string; email: string }[]
  const dept = (name: string) => departments.find((item) => item.name === name)!.id
  const plan = (override: Record<string, string> = {}) => members.map((member) => ({ userId: member.userId, departmentUnitId: override[member.email] || dept('Ban Thư Ký') }))

  test.beforeAll(async ({ request }) => {
    chapterId = await chapterOf(request, 'transferChapterLead')
    // Fixture reset so this block can be re-run against the same disposable database.
    await sql(`DELETE FROM chapter_reorganizations WHERE chapter_id = $1`, [chapterId])
    await sql(`DELETE FROM chapter_competition_terms WHERE chapter_id = $1`, [chapterId])
    await sql(`DELETE FROM transfer_seasons WHERE code <> $1 AND starts_at < $2 AND ends_at > $3`, [SEASON.code, SEASON.endsAt, SEASON.startsAt])
    const saved = await (await as(request, 'admin')).put('/api/v1/admin/learning-config', { seasons: [SEASON] })
    expect(saved.status, JSON.stringify(saved.body)).toBe(200)
    const roster = (await (await as(request, 'transferChapterLead')).get(`/api/v1/chapters/${chapterId}/current-roster`)).body
    departments = roster.departments
    nextTerm = (roster.currentTermNumber || 0) + 1
    members = [...roster.roster.flatMap((unit: any) => unit.members), ...roster.unassignedMembers].map((member: any) => ({ userId: member.userId, email: member.email }))
    expect(members.length).toBeGreaterThanOrEqual(2)
  })

  test('mùa chuyển giao phải trùng đúng một giai đoạn nửa năm và mốc thưởng 01/04 hoặc 01/10', async ({ request }) => {
    const admin = await as(request, 'admin')
    const bad = [
      { ...SEASON, code: 'E2E_BAD_A', startsAt: '2027-01-01T00:00:00+07:00', endsAt: '2027-06-01T00:00:00+07:00', rewardBoundaryAt: '2027-04-01T00:00:00+07:00' },
      { ...SEASON, code: 'E2E_BAD_B', startsAt: '2027-01-01T00:00:00+07:00', endsAt: '2027-07-01T00:00:00+07:00', rewardBoundaryAt: '2027-05-01T00:00:00+07:00' },
      { ...SEASON, code: 'e2e bad' },
      { ...SEASON, code: 'E2E_OVERLAP' },
    ]
    for (const season of bad) {
      const result = await admin.put('/api/v1/admin/learning-config', { seasons: [season] })
      expect(result.status, season.code).toBeGreaterThanOrEqual(400)
      expect(result.body.error.message, season.code).toMatch(/[à-ỹ]/i)
    }
    expect((await (await as(request, 'chapterLead')).put('/api/v1/admin/learning-config', { seasons: [SEASON] })).status).toBe(403)
  })

  test('chưa có mùa cho giai đoạn thì không đặt lịch được và thông báo nêu rõ giai đoạn', async ({ request }) => {
    const lead = await as(request, 'transferChapterLead')
    const result = await lead.post(`/api/v1/chapters/${chapterId}/reorganizations`, { effectiveAt: '2031-03-01T00:00:00+07:00', items: plan() })
    expect(result.status).toBe(409)
    expect(errorCode(result)).toBe('SEASON_NOT_CONFIGURED')
    expect(result.body.error.message).toMatch(/01\/01\/2031.*30\/06\/2031/)
  })

  test('chỉ Lead của đúng Chapter đặt lịch; Admin chỉ xem', async ({ request }) => {
    const body = { effectiveAt: future(), items: plan() }
    const admin = await (await as(request, 'admin')).post(`/api/v1/chapters/${chapterId}/reorganizations`, body)
    expect(admin.status).toBe(403)
    expect(errorCode(admin)).toBe('AdminReadOnly')
    expect((await (await as(request, 'admin')).get(`/api/v1/chapters/${chapterId}/reorganizations`)).status).toBe(200)
    for (const account of ['chapterLead', 'dnaLead', 'transferChapterMember', 'member'] as const) {
      expect((await (await as(request, account)).post(`/api/v1/chapters/${chapterId}/reorganizations`, body)).status, account).toBe(403)
    }
    expect((await guest(request).post(`/api/v1/chapters/${chapterId}/reorganizations`, body)).status).toBe(401)
    expect(await sql(`SELECT id FROM chapter_reorganizations WHERE chapter_id = $1`, [chapterId])).toEqual([])
  })

  test('danh sách phân ban sai bị từ chối trước khi lưu', async ({ request }) => {
    const lead = await as(request, 'transferChapterLead')
    const post = (body: unknown) => lead.post(`/api/v1/chapters/${chapterId}/reorganizations`, body)
    const outsider = await userByEmail(ACCOUNTS.member)
    const foreignDepartment = await one(`SELECT d.id FROM organization_units d JOIN organization_units c ON c.id = d.parent_id WHERE c.name = 'Chi hội Hà Nội' AND d.type = 'DEPARTMENT' LIMIT 1`)
    const president = await one(`SELECT id FROM positions WHERE code = 'PRESIDENT'`)
    const cases: [string, unknown, number][] = [
      ['thiếu ngày hiệu lực', { items: plan() }, 400],
      ['ngày không hợp lệ', { effectiveAt: 'hôm nay', items: plan() }, 400],
      ['danh sách rỗng', { effectiveAt: future(), items: [] }, 400],
      ['nhiệm kỳ số 0', { effectiveAt: future(), termNumber: 0, items: plan() }, 400],
      ['trùng thành viên', { effectiveAt: future(), items: [...plan(), plan()[0]] }, 400],
      ['người ngoài Chapter', { effectiveAt: future(), items: [...plan(), { userId: outsider.id, departmentUnitId: dept('Ban Thư Ký') }] }, 409],
      ['ban của Chapter khác', { effectiveAt: future(), items: plan({ [members[0].email]: foreignDepartment.id }) }, 400],
      ['hai Chủ tịch', { effectiveAt: future(), items: members.map((member) => ({ userId: member.userId, departmentUnitId: null, positionId: president.id })) }, 400],
    ]
    for (const [label, body, status] of cases) expect((await post(body)).status, label).toBe(status)
    expect(await sql(`SELECT id FROM chapter_reorganizations WHERE chapter_id = $1`, [chapterId])).toEqual([])
  })

  test('đặt lịch tương lai: chưa đổi ban, chỉ một lịch tại một thời điểm, hủy được rồi đặt lại', async ({ request }) => {
    const lead = await as(request, 'transferChapterLead')
    const member = await as(request, 'transferChapterMember')
    const before = (await member.get('/api/v1/users/me')).body.currentDepartment.id
    const scheduled = await lead.post(`/api/v1/chapters/${chapterId}/reorganizations`, { effectiveAt: future(), termNumber: nextTerm, items: plan() })
    expect(scheduled.status, JSON.stringify(scheduled.body)).toBe(201)
    expect(scheduled.body).toMatchObject({ appliedImmediately: false, item: { status: 'SCHEDULED' } })
    expect((await member.get('/api/v1/users/me')).body.currentDepartment.id, 'chưa tới ngày hiệu lực').toBe(before)
    expect((await lead.get(`/api/v1/chapters/${chapterId}/current-roster`)).body.scheduledBatch).toBeTruthy()

    const second = await lead.post(`/api/v1/chapters/${chapterId}/reorganizations`, { effectiveAt: future(), items: plan() })
    expect(second.status).toBe(409)
    expect(errorCode(second)).toBe('ScheduledReorganizationExists')

    const batchId = scheduled.body.item.id
    expect((await (await as(request, 'admin')).delete(`/api/v1/chapters/${chapterId}/reorganizations/${batchId}`)).status).toBe(403)
    expect((await (await as(request, 'chapterLead')).delete(`/api/v1/chapters/${chapterId}/reorganizations/${batchId}`)).status).toBe(403)
    expect((await lead.delete(`/api/v1/chapters/${chapterId}/reorganizations/${batchId}`)).status).toBe(200)
    expect((await lead.delete(`/api/v1/chapters/${chapterId}/reorganizations/${batchId}`)).status, 'hủy hai lần').toBe(404)
    expect((await lead.get(`/api/v1/chapters/${chapterId}/current-roster`)).body.scheduledBatch).toBeFalsy()
    expect((await member.get('/api/v1/users/me')).body.currentDepartment.id).toBe(before)
  })

  test('áp dụng chuyển giao: đổi ban, mở chu kỳ học mới, phải học lại, sao cũ vẫn còn; mỗi giai đoạn chỉ một lần', async ({ request }) => {
    const lead = await as(request, 'transferChapterLead')
    const course = await createCourse(request, { lessons: [{}] })
    const learner = await createLearner(request, { inviter: 'transferChapterLead', unitName: 'Ban Thành Viên' })
    members.push({ userId: learner.userId, email: learner.email })
    await watchWholeVideo(learner, course.lessons[0].lessonId, 40)
    const starsBefore = await starBalance(learner)
    expect(starsBefore).toBeGreaterThan(0)
    const cycleBefore = (await learner.api.get('/api/v1/learning/me')).body.cycle.id

    const applied = await lead.post(`/api/v1/chapters/${chapterId}/reorganizations`, { effectiveAt: new Date().toISOString(), termNumber: nextTerm, items: plan({ [learner.email]: dept('Ban Nội Dung') }) })
    expect(applied.status, JSON.stringify(applied.body)).toBe(201)
    expect(applied.body).toMatchObject({ appliedImmediately: true, item: { status: 'APPLIED' } })

    const me = (await learner.api.get('/api/v1/users/me')).body
    expect(me.currentDepartment).toMatchObject({ id: dept('Ban Nội Dung'), name: 'Ban Nội Dung' })
    expect(me.currentTermNumber).toBe(nextTerm)
    expect(me.departmentHistory.map((row: any) => row.departmentName), 'lịch sử ban được giữ').toEqual(expect.arrayContaining(['Ban Thành Viên', 'Ban Nội Dung']))

    const learning = (await learner.api.get('/api/v1/learning/me')).body
    expect(learning.cycle.id, 'chu kỳ học mới').not.toBe(cycleBefore)
    expect(learning.stars.history, 'sao lịch sử không mất').toBe(starsBefore)
    expect(learning.stars.cycle, 'chu kỳ mới bắt đầu từ 0').toBe(0)
    const lesson = (await learner.api.get(`/api/v1/lessons/${course.lessons[0].lessonId}`)).body
    expect(JSON.stringify(lesson), 'tiến độ chu kỳ cũ không tính cho chu kỳ mới').not.toMatch(/"videoCompleted":true/)

    const sameTerm = await lead.post(`/api/v1/chapters/${chapterId}/reorganizations`, { effectiveAt: new Date().toISOString(), termNumber: nextTerm, items: plan() })
    expect(errorCode(sameTerm), 'số nhiệm kỳ phải tăng').toBe('InvalidTermNumber')
    const again = await lead.post(`/api/v1/chapters/${chapterId}/reorganizations`, { effectiveAt: new Date().toISOString(), items: plan() })
    expect(again.status).toBe(409)
    expect(errorCode(again)).toBe('WINDOW_ALREADY_APPLIED')
    expect(again.body.error.message, 'nêu giai đoạn kế tiếp').toMatch(/01\/01\/2027/)

    const frozen = await (await as(request, 'admin')).put('/api/v1/admin/learning-config', { seasons: [{ ...SEASON, rewardBoundaryAt: '2026-10-01T00:00:00+07:00', endsAt: '2027-01-01T00:00:00+07:00' }] })
    expect(frozen.status, 'mùa đã dùng không sửa được').toBeGreaterThanOrEqual(400)
    const progress = await (await as(request, 'admin')).get('/api/v1/admin/transfer-seasons/progress')
    expect(JSON.stringify(progress.body)).toContain(chapterId)
  })

  test('worker áp dụng chuyển giao chỉ chạy với đúng secret', async ({ request }) => {
    expect((await guest(request).get('/api/internal/organization/reorganizations/apply')).status).toBe(401)
    expect((await (await as(request, 'admin')).get('/api/internal/organization/reorganizations/apply')).status).toBe(401)
    expect((await request.get('/api/internal/organization/reorganizations/apply', { headers: { ...CRON_HEADERS, Authorization: 'Bearer sai' } })).status()).toBe(401)
    expect((await request.get('/api/internal/organization/reorganizations/apply', { headers: CRON_HEADERS })).status()).toBe(200)
  })
})
