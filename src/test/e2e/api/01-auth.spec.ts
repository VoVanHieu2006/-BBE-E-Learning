import { expect, test } from '@playwright/test'
import { Api, as, errorCode, guest, login, tryLogin } from '../support/api'
import { userByEmail } from '../support/db'
import { createLearner, defect, PASSWORD } from '../support/fixtures'
import { ACCOUNTS, SEED_PASSWORD } from '../support/seed'

// Intent: docs/business-rules.md "Lời mời và tài khoản" (KHBB 7.2).
test.describe('Đăng nhập', () => {
  test('mỗi vai đăng nhập được và nhận đúng khu vực quản lý của mình', async ({ request }) => {
    const expected = [
      ['admin', 'ADMIN', null], ['chapterLead', 'LEAD', 'LEAD_CHAPTER'], ['dnaLead', 'LEAD', 'LEAD_DNA'],
      ['member', 'MEMBER', null], ['departmentLead', 'MEMBER', null], ['president', 'MEMBER', null], ['dnaMember', 'MEMBER', null],
    ] as const
    for (const [account, role, managerKind] of expected) {
      const session = await login(request, ACCOUNTS[account])
      expect(session.user.role, account).toBe(role)
      expect(session.user.managerKind ?? null, account).toBe(managerKind)
      expect(session.accessToken, account).toBeTruthy()
      expect(session.refreshToken, account).toBeTruthy()
      expect(JSON.stringify(session.user), 'không lộ hash mật khẩu').not.toMatch(/password|hash/i)
    }
  })

  test('email không phân biệt hoa thường và khoảng trắng thừa', async ({ request }) => {
    const result = await tryLogin(request, `  ${ACCOUNTS.member.toUpperCase()}  `, SEED_PASSWORD)
    expect(result.status).toBe(200)
  })

  test('thiếu hoặc sai kiểu email/mật khẩu trả 400 ValidationError', async ({ request }) => {
    for (const data of [{}, { email: ACCOUNTS.member }, { password: 'x' }, { email: 123, password: 'x' }, { email: 'a@b.c', password: 'x'.repeat(201) }, { email: `${'a'.repeat(260)}@b.c`, password: 'x' }]) {
      const response = await request.post('/api/v1/auth/login', { data })
      expect(response.status(), JSON.stringify(data).slice(0, 60)).toBe(400)
      expect((await response.json()).error.code).toBe('ValidationError')
    }
  })

  test('chống dò email: email không tồn tại và sai mật khẩu trả cùng một nội dung 401', async ({ request }) => {
    const unknown = await tryLogin(request, 'khong-ton-tai@e2e.bbe.test', 'Sai-mat-khau-1')
    const wrong = await tryLogin(request, ACCOUNTS.president, 'Sai-mat-khau-1')
    expect(unknown.status).toBe(401)
    expect(wrong.status).toBe(401)
    expect(wrong.body).toEqual(unknown.body)
    expect(errorCode(wrong)).toBe('InvalidCredentials')
    expect(JSON.stringify(wrong.body)).not.toContain('remainingAttempts')
    expect(wrong.body.error.message, 'người dùng được hướng dẫn cách tự gỡ').toContain('Quên mật khẩu')
    await login(request, ACCOUNTS.president) // đăng nhập đúng đếm lại số lần sai
    expect((await userByEmail(ACCOUNTS.president)).failed_login_count).toBe(0)
  })

  test('đăng nhập đặt cookie phiên HttpOnly, không để script đọc token', async ({ request }) => {
    const response = await request.post('/api/v1/auth/login', { data: { email: ACCOUNTS.member, password: SEED_PASSWORD } })
    const cookies = response.headersArray().filter((header) => header.name.toLowerCase() === 'set-cookie').map((header) => header.value)
    expect(cookies.length).toBeGreaterThanOrEqual(2)
    for (const cookie of cookies.filter((value) => /token/i.test(value.split('=')[0]))) {
      expect(cookie.toLowerCase(), cookie.split('=')[0]).toContain('httponly')
      expect(cookie.toLowerCase(), cookie.split('=')[0]).toMatch(/samesite=(lax|strict)/)
    }
  })
})

test.describe('Khóa tài khoản do sai mật khẩu', () => {
  test('sai 4 lần chưa khóa, lần thứ 5 khóa; mật khẩu đúng sau đó bị từ chối với hướng dẫn rõ ràng', async ({ request }) => {
    const learner = await createLearner(request, { prefix: 'lock' })
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const result = await tryLogin(request, learner.email, 'Sai-mat-khau-1')
      expect(result.status).toBe(401)
      expect((await userByEmail(learner.email)).status, `lần ${attempt}`).toBe('ACTIVE')
    }
    const fifth = await tryLogin(request, learner.email, 'Sai-mat-khau-1')
    expect(fifth.status).toBe(401)
    expect(errorCode(fifth), 'lần khóa cũng không tiết lộ tài khoản tồn tại').toBe('InvalidCredentials')
    const locked = await userByEmail(learner.email)
    expect(locked.status).toBe('LOCKED')
    expect(locked.lock_reason).toBe('PASSWORD_LOCK')

    const correct = await tryLogin(request, learner.email, PASSWORD)
    expect(correct.status).toBe(403)
    expect(errorCode(correct)).toBe('AccountLocked')
    expect(correct.body.error.lockReason).toBe('PASSWORD_LOCK')
    expect(correct.body.error.message).toContain('Quên mật khẩu')

    // Phiên đang mở trước khi bị khóa không còn dùng được (không tin JWT cũ).
    expect((await learner.api.get('/api/v1/users/me')).status).toBe(401)
    expect((await guest(request).post('/api/v1/auth/refresh', { refreshToken: learner.session.refreshToken })).status).toBeGreaterThanOrEqual(401)
  })

  test('đặt lại mật khẩu mở khóa PASSWORD_LOCK; link dùng một lần; mật khẩu cũ hết hiệu lực', async ({ request }) => {
    const learner = await createLearner(request, { prefix: 'reset' })
    for (let attempt = 0; attempt < 5; attempt += 1) await tryLogin(request, learner.email, 'Sai-mat-khau-1')
    expect((await userByEmail(learner.email)).status).toBe('LOCKED')

    const admin = await as(request, 'admin')
    const issued = await admin.post(`/api/v1/users/${learner.userId}/password-reset/link`)
    expect(issued.status).toBe(200)
    expect(issued.headers['cache-control'] || '').toContain('no-store')
    const token = new URL(issued.body.link).searchParams.get('token')
    const anonymous = guest(request)

    expect(errorCode(await anonymous.post('/api/v1/auth/password-reset/confirm', { token, newPassword: 'ngan', confirmPassword: 'ngan' }))).toBe('WeakPassword')
    expect(errorCode(await anonymous.post('/api/v1/auth/password-reset/confirm', { token, newPassword: 'Mat-khau-moi-1', confirmPassword: 'Mat-khau-khac-1' }))).toBe('PasswordMismatch')
    const confirmed = await anonymous.post('/api/v1/auth/password-reset/confirm', { token, newPassword: 'Mat-khau-moi-1', confirmPassword: 'Mat-khau-moi-1' })
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200)

    const after = await userByEmail(learner.email)
    expect(after.status).toBe('ACTIVE')
    expect(after.lock_reason).toBeNull()
    expect(after.failed_login_count).toBe(0)
    expect((await tryLogin(request, learner.email, PASSWORD)).status).toBe(401)
    expect((await tryLogin(request, learner.email, 'Mat-khau-moi-1')).status).toBe(200)

    const reused = await anonymous.post('/api/v1/auth/password-reset/confirm', { token, newPassword: 'Mat-khau-moi-2', confirmPassword: 'Mat-khau-moi-2' })
    expect(reused.status).toBeGreaterThanOrEqual(400)
    expect(['TokenAlreadyUsed', 'TokenExpired']).toContain(errorCode(reused))
  })

  test('quên mật khẩu trả cùng một thông báo cho email có và không tồn tại', async ({ request }) => {
    const anonymous = guest(request)
    const known = await anonymous.post('/api/v1/auth/password-reset/request', { email: ACCOUNTS.otherChapterMember })
    const unknown = await anonymous.post('/api/v1/auth/password-reset/request', { email: 'khong-ton-tai@e2e.bbe.test' })
    expect(known.status).toBe(200)
    expect(unknown.status).toBe(200)
    expect(known.body).toEqual(unknown.body)
    expect(Object.keys(known.body)).toEqual(['message'])
    expect((await anonymous.post('/api/v1/auth/password-reset/request', {})).status).toBe(400)
  })

  test('chỉ Admin lấy được link đặt lại mật khẩu của người khác', async ({ request }) => {
    const target = await userByEmail(ACCOUNTS.member)
    for (const account of ['chapterLead', 'dnaLead', 'member'] as const) {
      const result = await (await as(request, account)).post(`/api/v1/users/${target.id}/password-reset/link`)
      expect(result.status, account).toBe(403)
    }
    expect([401, 403]).toContain((await guest(request).post(`/api/v1/users/${target.id}/password-reset/link`)).status)
  })
})

test.describe('Phiên đăng nhập', () => {
  test('refresh cấp access token mới; đăng xuất thu hồi refresh token', async ({ request }) => {
    const session = await login(request, ACCOUNTS.dnaMember)
    const anonymous = guest(request)
    const refreshed = await anonymous.post('/api/v1/auth/refresh', { refreshToken: session.refreshToken })
    expect(refreshed.status).toBe(200)
    expect((await new Api(request, refreshed.body.accessToken).get('/api/v1/auth/me')).status).toBe(200)
    expect((await anonymous.post('/api/v1/auth/logout', { refreshToken: session.refreshToken })).status).toBe(200)
    const revoked = await anonymous.post('/api/v1/auth/refresh', { refreshToken: session.refreshToken })
    expect(revoked.status).toBe(401)
    expect(errorCode(revoked)).toBe('InvalidToken')
  })

  test('token giả, token bị sửa và không có token đều bị từ chối 401', async ({ request }) => {
    const session = await login(request, ACCOUNTS.member)
    const tampered = `${session.accessToken.slice(0, -4)}AAAA`
    for (const token of [undefined, 'khong-phai-jwt', tampered]) {
      expect((await new Api(request, token).get('/api/v1/users/me')).status, String(token).slice(0, 12)).toBe(401)
    }
    expect((await guest(request).post('/api/v1/auth/refresh', { refreshToken: 'gia-mao' })).status).toBe(401)
  })

  test('tài khoản bị khóa sẵn trong dữ liệu mẫu không đăng nhập được', async ({ request }) => {
    const result = await tryLogin(request, ACCOUNTS.seededLocked, SEED_PASSWORD)
    expect(result.status).toBe(403)
    expect(['AccountLocked', 'AccountInactive']).toContain(errorCode(result))
    expect(result.body.error.message.length).toBeGreaterThan(10)
  })

  // docs/known-issues.md: endpoint xác thực chưa có rate limit theo IP/gateway.
  defect('BUG-AUTH-RATE', 'đăng nhập sai dồn dập từ một nguồn phải bị giới hạn tần suất (429)', async ({ request }) => {
    const statuses: number[] = []
    for (let attempt = 0; attempt < 40; attempt += 1) statuses.push((await tryLogin(request, `do-mat-khau-${attempt}@e2e.bbe.test`, 'Sai-mat-khau-1')).status)
    expect(statuses).toContain(429)
  })
})
