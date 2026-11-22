import { expect, test } from '@playwright/test'
import { as, errorCode, guest, login, tryLogin } from '../support/api'
import { one, sql } from '../support/db'
import { createLearner, defect, inviteLink, PASSWORD, uniqueEmail } from '../support/fixtures'
import { ACCOUNTS } from '../support/seed'

// Intent: docs/business-rules.md "Lời mời và tài khoản".
const accept = (request: any, token: string, email: string, password = PASSWORD, confirmPassword = password) =>
  guest(request).post('/api/v1/invitations/accept', { token, email, password, confirmPassword })

test.describe('Lời mời thành viên', () => {
  test('Lead mời vào ban của mình: lời mời PENDING, hạn 24 giờ, giao bằng link khi không gửi được mail', async ({ request }) => {
    const email = uniqueEmail('invite')
    const before = Date.now()
    const { invitation, unit } = await inviteLink(request, 'chapterLead', email)
    expect(invitation.status).toBe('PENDING')
    expect(invitation.delivery).toBe('LINK')
    expect(invitation.emailSent).toBe(false)
    expect(invitation.emailError, 'người mời được báo rõ cần dùng link').toMatch(/link/i)
    expect(invitation.organizationUnitId).toBe(unit.id)
    const lifetimeHours = (new Date(invitation.expiresAt).getTime() - before) / 3_600_000
    expect(lifetimeHours).toBeGreaterThan(23.9)
    expect(lifetimeHours).toBeLessThan(24.1)
    expect(JSON.stringify(invitation), 'phản hồi tạo lời mời không chứa token').not.toMatch(/token/i)
  })

  test('link mời: xem trước đúng đơn vị, sai email bị từ chối, đúng email kích hoạt, dùng lại bị từ chối', async ({ request }) => {
    const email = uniqueEmail('accept')
    const { token, unit } = await inviteLink(request, 'chapterLead', email)
    const preview = await guest(request).get(`/api/v1/invitations/validate?token=${token}`)
    expect(preview.status).toBe(200)
    expect(preview.body).toMatchObject({ valid: true, role: 'MEMBER', organizationUnitId: unit.id })
    expect(JSON.stringify(preview.body), 'link không tiết lộ email được mời').not.toContain(email)

    const wrongEmail = await accept(request, token, uniqueEmail('intruder'))
    expect(wrongEmail.status).toBe(403)
    expect(errorCode(wrongEmail)).toBe('EmailMismatch')
    expect(errorCode(await accept(request, token, email, 'ngan'))).toBe('WeakPassword')
    expect(errorCode(await accept(request, token, email, PASSWORD, `${PASSWORD}x`))).toBe('PasswordMismatch')

    const accepted = await accept(request, token, `  ${email.toUpperCase()} `)
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200)
    expect(accepted.body).toMatchObject({ email, role: 'MEMBER', status: 'ACTIVE' })

    const session = await login(request, email, PASSWORD)
    expect(session.user.role).toBe('MEMBER')
    expect(session.user.chapterId, 'thành viên thuộc đúng Chapter của ban được mời').toBe((await as(request, 'chapterLead')).session.user.chapterId)

    const reused = await accept(request, token, email)
    expect(reused.status).toBe(409)
    expect(errorCode(reused)).toBe('TokenAlreadyUsed')
    expect((await guest(request).get(`/api/v1/invitations/validate?token=${token}`)).body.valid).not.toBe(true)
  })

  test('thành viên mới có đúng một chức vụ và một tư cách Chapter', async ({ request }) => {
    const learner = await createLearner(request, { prefix: 'position' })
    const me = await learner.api.get('/api/v1/users/me')
    expect(me.status).toBe(200)
    expect(me.body.positions).toHaveLength(1)
    expect(me.body.positions[0].code).toBe('DEPARTMENT_MEMBER')
    expect(me.body.dna.active).toBe(false)
    expect(me.body.capabilities.learningEnabled).toBe(true)
  })

  test('"Đổi link" vô hiệu link cũ và giữ nguyên hạn 24 giờ', async ({ request }) => {
    const email = uniqueEmail('rotate')
    const first = await inviteLink(request, 'chapterLead', email)
    const lead = await as(request, 'chapterLead')
    const second = await lead.post(`/api/v1/invitations/${first.invitationId}/link`)
    expect(second.status).toBe(200)
    expect(second.headers['cache-control'] || '').toContain('no-store')
    expect(second.body.expiresAt).toBe(first.invitation.expiresAt)
    const newToken = new URL(second.body.link).searchParams.get('token')!
    expect(newToken).not.toBe(first.token)
    expect((await accept(request, first.token, email)).status, 'link cũ hết hiệu lực').toBeGreaterThanOrEqual(400)
    expect((await accept(request, newToken, email)).status).toBe(200)
  })

  test('token chỉ lưu dạng băm và mỗi lần lấy link có audit log không chứa token', async ({ request }) => {
    const email = uniqueEmail('audit')
    const { invitationId, token } = await inviteLink(request, 'chapterLead', email)
    const row = await one(`SELECT to_jsonb(i) AS data FROM invitations i WHERE id = $1`, [invitationId])
    expect(JSON.stringify(row.data)).not.toContain(token)
    const logs = await sql(`SELECT to_jsonb(a) AS data FROM audit_logs a WHERE action = 'INVITATION_LINK_ISSUED' AND entity_id = $1`, [invitationId])
    expect(logs.length).toBeGreaterThanOrEqual(1)
    expect(JSON.stringify(logs)).not.toContain(token)
  })

  test('lời mời hết hạn sau 24 giờ không kích hoạt được', async ({ request }) => {
    const email = uniqueEmail('expired')
    const { invitationId, token } = await inviteLink(request, 'chapterLead', email)
    await sql(`UPDATE invitations SET expires_at = now() - interval '1 minute' WHERE id = $1`, [invitationId])
    const result = await accept(request, token, email)
    expect(result.status).toBeGreaterThanOrEqual(400)
    expect(result.body.error.message, 'thông báo hết hạn dễ hiểu').toMatch(/hết hạn/i)
    expect((await tryLogin(request, email, PASSWORD)).status).toBe(401)
    const lead = await as(request, 'chapterLead')
    expect(errorCode(await lead.post(`/api/v1/invitations/${invitationId}/link`)), 'lời mời hết hạn không lấy link được').toBe('InvalidState')
  })

  test('hủy lời mời làm link mất hiệu lực', async ({ request }) => {
    const email = uniqueEmail('cancel')
    const { invitationId, token } = await inviteLink(request, 'chapterLead', email)
    const lead = await as(request, 'chapterLead')
    const cancelled = await lead.delete(`/api/v1/invitations/${invitationId}`)
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200)
    expect((await accept(request, token, email)).status).toBeGreaterThanOrEqual(400)
    expect((await tryLogin(request, email, PASSWORD)).status).toBe(401)
  })

  test('email không hợp lệ, email đã là thành viên và lời mời trùng đều được báo rõ', async ({ request }) => {
    const lead = await as(request, 'chapterLead')
    const unit = (await lead.get('/api/v1/organization/managed-units')).body.items.find((item: any) => item.type === 'DEPARTMENT')
    for (const email of ['', 'khong-phai-email', 'a@', '@b.c']) {
      const result = await lead.post('/api/v1/invitations/member', { email, organizationUnitId: unit.id })
      expect(result.status, email).toBe(400)
    }
    const existing = await lead.post('/api/v1/invitations/member', { email: ACCOUNTS.member, organizationUnitId: unit.id })
    expect(existing.status, JSON.stringify(existing.body)).toBeGreaterThanOrEqual(400)
    expect(existing.body.error.message.length).toBeGreaterThan(5)
    expect((await lead.post('/api/v1/invitations/member', { email: uniqueEmail('nounit') })).status).toBe(400)
    expect((await lead.post('/api/v1/invitations/member', { email: uniqueEmail('badunit'), organizationUnitId: '00000000-0000-4000-8000-000000000000' })).status).toBeGreaterThanOrEqual(400)
  })

  test('mời lại cùng email khi lời mời cũ còn chờ không tạo hai lời mời còn hiệu lực', async ({ request }) => {
    const email = uniqueEmail('twice')
    const first = await inviteLink(request, 'chapterLead', email)
    const lead = await as(request, 'chapterLead')
    await lead.post('/api/v1/invitations/member', { email, organizationUnitId: first.unit.id })
    const pending = await sql(`SELECT id FROM invitations WHERE email = $1 AND status = 'PENDING' AND expires_at > now()`, [email])
    expect(pending.length, 'một email chỉ có tối đa một lời mời còn hiệu lực').toBeLessThanOrEqual(1)
  })
})

test.describe('Phạm vi quyền mời', () => {
  test('Lead Chapter khác, thành viên thường và khách không mời được vào ban của Chapter này', async ({ request }) => {
    const lead = await as(request, 'chapterLead')
    const unit = (await lead.get('/api/v1/organization/managed-units')).body.items.find((item: any) => item.type === 'DEPARTMENT')
    for (const account of ['otherChapterLead', 'dnaLead', 'member', 'dnaMember', 'otherChapterMember'] as const) {
      const result = await (await as(request, account)).post('/api/v1/invitations/member', { email: uniqueEmail('scope'), organizationUnitId: unit.id })
      expect(result.status, account).toBe(403)
    }
    expect((await guest(request).post('/api/v1/invitations/member', { email: uniqueEmail('scope'), organizationUnitId: unit.id })).status).toBe(401)
  })

  test('Trưởng ban (MEMBER) không mời được vào ban khác trong cùng Chapter', async ({ request }) => {
    const departmentLead = await as(request, 'departmentLead')
    const own = (await departmentLead.get('/api/v1/users/me')).body.positions[0].unitId
    const others = (await (await as(request, 'chapterLead')).get('/api/v1/organization/managed-units')).body.items.filter((item: any) => item.type === 'DEPARTMENT' && item.id !== own)
    expect((await departmentLead.post('/api/v1/invitations/member', { email: uniqueEmail('other'), organizationUnitId: others[0].id })).status).toBe(403)
  })

  test('lời mời của Chapter khác: không gửi lại, không lấy link, không hủy được', async ({ request }) => {
    const { invitationId } = await inviteLink(request, 'chapterLead', uniqueEmail('foreign'))
    for (const account of ['otherChapterLead', 'dnaLead', 'member'] as const) {
      const actor = await as(request, account)
      expect((await actor.post(`/api/v1/invitations/${invitationId}/link`)).status, `${account} link`).toBe(403)
      expect((await actor.post(`/api/v1/invitations/${invitationId}/resend`)).status, `${account} resend`).toBe(403)
      expect((await actor.delete(`/api/v1/invitations/${invitationId}`)).status, `${account} cancel`).toBe(403)
    }
    const list = await (await as(request, 'otherChapterLead')).get('/api/v1/invitations?limit=100')
    expect(list.status).toBe(200)
    expect(list.body.items.map((item: any) => item.id), 'danh sách chỉ gồm lời mời trong phạm vi').not.toContain(invitationId)
  })

  test('chỉ Admin mời được Lead Chapter và Lead DNA; không có đường nâng MEMBER thành LEAD', async ({ request }) => {
    for (const account of ['chapterLead', 'dnaLead', 'member'] as const) {
      const actor = await as(request, account)
      expect((await actor.post('/api/v1/invitations/chapter-leader', { email: uniqueEmail('lead'), chapterName: 'Chi hội giả' })).status, account).toBe(403)
      expect((await actor.post('/api/v1/invitations/dna-leader', { email: uniqueEmail('lead') })).status, account).toBe(403)
    }
    const admin = await as(request, 'admin')
    const member = await one(`SELECT id FROM users WHERE email = $1`, [ACCOUNTS.member])
    const promoted = await admin.patch(`/api/v1/users/${member.id}`, { role: 'LEAD' })
    expect((await one(`SELECT role FROM users WHERE id = $1`, [member.id])).role, `PATCH role trả ${promoted.status}`).toBe('MEMBER')
    const existingAsLead = await admin.post('/api/v1/invitations/dna-leader', { email: ACCOUNTS.member })
    expect(existingAsLead.status, 'không mời LEAD cho tài khoản đã tồn tại').toBeGreaterThanOrEqual(400)
  })

  // POST /invitations/chapter-leader lưu lời mời chỉ có chapter_name nên vi phạm CHECK invitations_exactly_one_scope_check → 500.
  defect('BUG-INVITE-LEAD-500', 'Admin mời Lead Chapter mới: tài khoản kích hoạt là LEAD của đúng Chapter', async ({ request }) => {
    const admin = await as(request, 'admin')
    const email = uniqueEmail('newlead')
    const chapterName = `Chi hội E2E ${Date.now().toString(36)}`
    const invitation = await admin.post('/api/v1/invitations/chapter-leader', { email, chapterName })
    expect(invitation.status, JSON.stringify(invitation.body)).toBe(201)
    const link = await admin.post(`/api/v1/invitations/${invitation.body.invitationId}/link`)
    expect(link.status).toBe(200)
    const token = new URL(link.body.link).searchParams.get('token')!
    expect((await accept(request, token, email)).status).toBe(200)
    const session = await login(request, email, PASSWORD)
    expect(session.user).toMatchObject({ role: 'LEAD', managerKind: 'LEAD_CHAPTER', chapterName })
  })

  test('Lead không tham gia học (learningEnabled = false)', async ({ request }) => {
    for (const account of ['chapterLead', 'dnaLead'] as const) {
      const me = await (await as(request, account)).get('/api/v1/users/me')
      expect(me.body.capabilities.learningEnabled, account).toBe(false)
    }
  })
})

test.describe('Hạn mức email và mời hàng loạt', () => {
  test('hạn mức hiển thị 90 email/ngày và giờ làm mới 7h sáng Việt Nam', async ({ request }) => {
    const quota = await (await as(request, 'chapterLead')).get('/api/v1/invitations/email-quota')
    expect(quota.status).toBe(200)
    expect(quota.body.limit).toBe(90)
    expect(quota.body.used + quota.body.remaining).toBe(90)
    const reset = new Date(quota.body.resetsAt)
    expect(reset.getUTCHours()).toBe(0)
    expect(reset.getTime()).toBeGreaterThan(Date.now())
    expect(reset.getTime() - Date.now()).toBeLessThanOrEqual(24 * 3_600_000)
    expect((await (await as(request, 'member')).get('/api/v1/invitations/email-quota')).status, 'thành viên thường không xem hạn mức').toBe(403)
  })

  test('mời hàng loạt báo kết quả từng dòng: hợp lệ, sai định dạng, trùng trong lô, đã là thành viên', async ({ request }) => {
    const lead = await as(request, 'chapterLead')
    const unit = (await lead.get('/api/v1/organization/managed-units')).body.items.find((item: any) => item.type === 'DEPARTMENT')
    const fresh = uniqueEmail('bulk')
    const result = await lead.post('/api/v1/invitations/member/bulk', { emails: [fresh, 'sai-dinh-dang', fresh.toUpperCase(), ACCOUNTS.member], organizationUnitId: unit.id })
    expect(result.status, JSON.stringify(result.body)).toBe(200)
    const statuses = (email: string) => result.body.results.filter((row: any) => String(row.email).toLowerCase() === email.toLowerCase()).map((row: any) => row.status).sort()
    expect(statuses(fresh), 'một lời mời cần lấy link, dòng lặp bị đánh dấu trùng').toEqual(['DUPLICATE', 'LINK_NEEDED'])
    expect(statuses('sai-dinh-dang')).toEqual(['INVALID'])
    expect(statuses(ACCOUNTS.member)).toEqual(['ALREADY_MEMBER'])
    expect(result.body.results).toHaveLength(4)
    expect(result.body.results.find((row: any) => row.status === 'LINK_NEEDED').message, 'dòng cần link có hướng dẫn').toMatch(/link/i)
    expect(result.body.summary).toMatchObject({ total: 4, created: 1, linkNeeded: 1, invalid: 1, duplicate: 1, alreadyMember: 1, failed: 0 })
    expect((await lead.post('/api/v1/invitations/member/bulk', { emails: [], organizationUnitId: unit.id })).status).toBe(400)
    const outsider = await (await as(request, 'otherChapterLead')).post('/api/v1/invitations/member/bulk', { emails: [uniqueEmail('bulk')], organizationUnitId: unit.id })
    expect(outsider.status === 403 || outsider.body.results?.every((row: any) => row.status === 'DENIED'), 'Lead khác không mời hàng loạt vào ban này').toBe(true)
  })

  test('lấy link quá 10 lần/10 phút cho một lời mời bị giới hạn 429', async ({ request }) => {
    const { invitationId } = await inviteLink(request, 'chapterLead', uniqueEmail('limit'))
    const lead = await as(request, 'chapterLead')
    const statuses: number[] = []
    for (let attempt = 0; attempt < 11; attempt += 1) statuses.push((await lead.post(`/api/v1/invitations/${invitationId}/link`)).status)
    expect(statuses.at(-1)).toBe(429)
  })

  test('thông báo lỗi khi mời với đơn vị không hợp lệ phải bằng tiếng Việt', async ({ request }) => {
    const result = await (await as(request, 'chapterLead')).post('/api/v1/invitations/member', { email: uniqueEmail('lang'), organizationUnitId: 'khong-hop-le' })
    expect(result.status).toBe(400)
    expect(result.body.error.message).toMatch(/[àáạảãâăđêôơưèéẹẻẽìíịỉĩòóọỏõùúụủũỳýỵỷỹ]/i)
  })
})
