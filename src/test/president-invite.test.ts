/**
 * Mời thành viên với chức vụ Chủ tịch / Trưởng ban (Lead Chapter).
 * Chạy thật các API route mời lẻ, mời loạt, trạng thái Chủ tịch và lib lời mời trên một DB giả trong bộ nhớ.
 * Kịch bản chính:
 *  - mời Chủ tịch khi Chapter trống / đã có Chủ tịch (cảnh báo + xác nhận) / đã có lời mời Chủ tịch khác;
 *  - mời loạt: 2 email trở lên cho Chủ tịch bị chặn trước khi gửi bất kỳ lời mời nào;
 *  - quyền: chỉ người quản lý cấp Chapter mời được Chủ tịch/Trưởng ban;
 *  - kích hoạt: đơn vị phải khớp chức vụ, chức vụ được chuyển đúng sang bước gán;
 *  - lời mời cũ (không có position_code) chạy như trước.
 */
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { hashToken } from '../lib/tokens'

const stub = (name: string, exports: unknown) => { const filename = require.resolve(name); require.cache[filename] = { id: filename, filename, loaded: true, exports } as NodeJS.Module }

// ---------- dữ liệu tổ chức ----------
const U = {
  chapter: '11111111-1111-4111-8111-111111111111',
  bnd: '22222222-2222-4222-8222-222222222222',
  btv: '33333333-3333-4333-8333-333333333333',
  dna: '44444444-4444-4444-8444-444444444444',
  chapter2: '55555555-5555-4555-8555-555555555555',
  bnd2: '66666666-6666-4666-8666-666666666666',
  inactiveDept: '77777777-7777-4777-8777-777777777777',
}
type Unit = { id: string; type: string; status: string; parent_id: string | null; name: string }
const units: Unit[] = [
  { id: U.chapter, type: 'CHAPTER', status: 'ACTIVE', parent_id: null, name: 'Chapter Phoenix' },
  { id: U.bnd, type: 'DEPARTMENT', status: 'ACTIVE', parent_id: U.chapter, name: 'Ban Nội Dung' },
  { id: U.btv, type: 'DEPARTMENT', status: 'ACTIVE', parent_id: U.chapter, name: 'Ban Thành Viên' },
  { id: U.dna, type: 'DNA_GROUP', status: 'ACTIVE', parent_id: null, name: 'DNA TT' },
  { id: U.chapter2, type: 'CHAPTER', status: 'ACTIVE', parent_id: null, name: 'Chapter Khác' },
  { id: U.bnd2, type: 'DEPARTMENT', status: 'ACTIVE', parent_id: U.chapter2, name: 'Ban Nội Dung 2' },
  { id: U.inactiveDept, type: 'DEPARTMENT', status: 'INACTIVE', parent_id: U.chapter, name: 'Ban cũ' },
]
const chapters = [{ id: 'C1', organization_unit_id: U.chapter }, { id: 'C2', organization_unit_id: U.chapter2 }]
const ancestors = (unitId: string) => { const out: string[] = []; let cur: string | null = unitId; while (cur) { out.push(cur); cur = units.find((u) => u.id === cur)?.parent_id ?? null } return out }

// Quyền: actor → các đơn vị được cấp quyền quản lý thành viên (quyền lan xuống đơn vị con).
const grants: Record<string, string[]> = {
  lead: [U.chapter], // Lead Chapter Phoenix
  deptManager: [U.bnd], // chỉ quản lý Ban Nội Dung
  dnaManager: [U.dna],
  lead2: [U.chapter2],
}
const actors: Record<string, { userId: string; role: string; chapterId?: string }> = {
  lead: { userId: 'lead', role: 'LEAD', chapterId: 'C1' },
  deptManager: { userId: 'deptManager', role: 'MEMBER', chapterId: 'C1' },
  dnaManager: { userId: 'dnaManager', role: 'MEMBER' },
  lead2: { userId: 'lead2', role: 'LEAD', chapterId: 'C2' },
  admin: { userId: 'admin', role: 'ADMIN' },
  leadNoChapter: { userId: 'leadNoChapter', role: 'LEAD' },
}

// ---------- DB giả ----------
type Row = Record<string, any>
const db = {
  invitations: [] as Row[],
  users: [] as Row[],
  presidents: [] as Array<{ unit_id: string; user: { id: string; email: string; display_name: string | null } }>,
  deptLeads: [] as Array<{ unit_id: string; user: { id: string; email: string; display_name: string | null } }>,
  assigned: [] as Array<{ userId: string; unitId: string; positionCode: string | null }>,
  memberships: [] as Row[],
  lockedUnits: [] as string[],
  /** Thứ tự 'lock:<unit>' / 'claim:<id>' để kiểm khóa Chapter trước khi chiếm lời mời. */
  events: [] as string[],
  locks: 0,
}
const emailCalls: Row[] = []

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'OR') return (cond as Row[]).some((c) => matches(row, c))
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('not' in cond) return row[key] !== cond.not
      if ('in' in cond) return (cond.in as unknown[]).includes(row[key])
      if ('gt' in cond) return row[key] > cond.gt
      return true
    }
    return row[key] === cond
  })
}

const prisma: any = {
  organizationUnit: {
    findUnique: async ({ where }: any) => units.find((u) => u.id === where.id) ?? null,
    findUniqueOrThrow: async ({ where }: any) => { const u = units.find((x) => x.id === where.id); if (!u) throw new Error('missing unit'); return u },
  },
  chapter: {
    findUnique: async ({ where }: any) => chapters.find((c) => c.id === where.id) ?? null,
    update: async () => ({}),
  },
  positionAssignment: {
    findFirst: async ({ where }: any) => (where.position?.code === 'DEPARTMENT_LEAD' ? db.deptLeads : where.position?.code === 'PRESIDENT' ? db.presidents : []).find((p) => p.unit_id === where.unit_id) ?? null,
  },
  user: {
    findUnique: async ({ where }: any) => db.users.find((u) => u.email === where.email) ?? null,
    findMany: async ({ where }: any) => db.users.filter((u) => where.email.in.includes(u.email)),
    create: async ({ data }: any) => { const row = { id: `user-${db.users.length + 1}`, ...data }; db.users.push(row); return row },
  },
  invitation: {
    findFirst: async ({ where }: any) => db.invitations.find((row) => matches(row, where)) ?? null,
    findMany: async ({ where }: any) => db.invitations.filter((row) => matches(row, where)).map((row) => ({ ...row })),
    findUnique: async ({ where }: any) => db.invitations.find((row) => (where.id ? row.id === where.id : row.token_hash === where.token_hash)) ?? null,
    create: async ({ data }: any) => { const row = { id: `inv-${db.invitations.length + 1}`, delivery_method: 'EMAIL', created_at: new Date(), ...data }; db.invitations.push(row); return row },
    update: async ({ where, data }: any) => { const row = db.invitations.find((r) => r.id === where.id)!; Object.assign(row, data); return row },
    updateMany: async ({ where, data }: any) => { const rows = db.invitations.filter((row) => matches(row, where)); rows.forEach((row) => Object.assign(row, data)); if (data.status === 'ACCEPTED') db.events.push(...rows.map((row) => `claim:${row.id}`)); return { count: rows.length } },
  },
  chapterMember: { upsert: async () => ({}) },
  organizationMembership: { create: async ({ data }: any) => { db.memberships.push(data) } },
  auditLog: { count: async () => 0, create: async () => ({}) },
  $transaction: async (fn: any) => fn(prisma),
  $queryRaw: async () => { db.locks++; return [] },
}

stub('../lib/prisma', { prisma })
stub('../lib/authorization', {
  memberManagementPermission: (type: string) => (type === 'DNA' || type === 'DNA_GROUP' ? 'MANAGE_DNA_MEMBERS' : 'MANAGE_CHAPTER_MEMBERS'),
  canAccessOrganizationUnitPermission: async (ctx: any, unitId: string) => {
    if (ctx.role === 'ADMIN') return true
    const unit = units.find((u) => u.id === unitId)
    if (!unit || unit.status !== 'ACTIVE') return false
    return ancestors(unitId).some((id) => (grants[ctx.userId] || []).includes(id))
  },
  canAccessChapterPermission: async (ctx: any, chapterId: string) => {
    if (ctx.role === 'ADMIN') return true
    const unitId = chapters.find((c) => c.id === chapterId)?.organization_unit_id
    return Boolean(unitId && (grants[ctx.userId] || []).includes(unitId))
  },
})
stub('../lib/auth', {
  authenticate: async (request: NextRequest) => {
    const key = request.headers.get('x-test-actor') || ''
    return actors[key] ? { ok: true, context: actors[key] } : { ok: false, error: { code: 'Unauthorized' } }
  },
})
stub('../lib/email', { sendInvitationEmail: async (params: any) => { emailCalls.push(params); return { success: true } } })
stub('../lib/email-quota', { reserveEmailSlots: async (n: number) => ({ day: '2026-11-25', granted: n }), releaseEmailSlots: async () => {} })
stub('../lib/server-cache', { invalidateInvitationsServerCache: () => {} })
stub('../lib/learning-assignments', { reconcileLearningAssignmentsForUser: async () => {} })
stub('../lib/position-replacement', {
  assignMembershipPosition: async () => { throw new Error('acceptInvitation must call assignInvitedPosition') },
  assignInvitedPosition: async (_tx: unknown, userId: string, unitId: string, positionCode: string | null) => { db.assigned.push({ userId, unitId, positionCode }) },
  // SQL thật khóa Chapter chứa đơn vị; ở đây ghi lại đơn vị được khóa và đếm số lần khóa.
  lockUnitChapter: async (tx: any, unitId: string) => { db.lockedUnits.push(unitId); db.events.push(`lock:${unitId}`); return tx.$queryRaw() },
})

const { resolveMemberInviteScope } = require('../lib/member-invite-scope')
const { checkPresidentInvite, getChapterPresidentSituation } = require('../lib/president-invite')
const { sendMemberInvitation, resendInvitation, acceptInvitation, validateInvitationToken } = require('../lib/invitations')
const singleRoute = require('../app/api/v1/invitations/member/route')
const bulkRoute = require('../app/api/v1/invitations/member/bulk/route')
const statusRoute = require('../app/api/v1/invitations/member/president-status/route')

function request(actor: string, body?: unknown, url = 'http://localhost/api/v1/invitations/member') {
  return new NextRequest(url, { method: body === undefined ? 'GET' : 'POST', headers: { 'x-test-actor': actor, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
}
async function call(route: any, actor: string, body: unknown) {
  const res = await route.POST(request(actor, body))
  return { status: res.status, body: await res.json() }
}
const future = () => new Date(Date.now() + 3600_000)
const pendingPresident = (email: string, unit = U.chapter) => db.invitations.push({ id: `seed-${email}`, email, role: 'MEMBER', organization_unit_id: unit, position_code: 'PRESIDENT', status: 'PENDING', expires_at: future(), invited_by: 'lead', token_hash: `h-${email}`, created_at: new Date() })
const seatPresident = (email = 'cu@bbe.vn', name: string | null = 'Nguyễn Văn Cũ') => db.presidents.push({ unit_id: U.chapter, user: { id: 'old-president', email, display_name: name } })
const live = (email: string) => db.invitations.filter((row) => row.email === email && row.status === 'PENDING')

beforeEach(() => {
  db.invitations.length = 0
  db.users.length = 0
  db.presidents.length = 0
  db.deptLeads.length = 0
  db.assigned.length = 0
  db.memberships.length = 0
  db.locks = 0
  db.lockedUnits.length = 0
  db.events.length = 0
  emailCalls.length = 0
})

describe('phạm vi mời theo chức vụ (resolveMemberInviteScope)', () => {
  it('không gửi position → thành viên ban như cũ (positionCode null)', async () => {
    assert.deepEqual(await resolveMemberInviteScope(actors.lead, { organizationUnitId: U.bnd }), { ok: true, organizationUnitId: U.bnd, positionCode: null })
    assert.deepEqual(await resolveMemberInviteScope(actors.lead, { organizationUnitId: U.bnd, position: 'MEMBER' }), { ok: true, organizationUnitId: U.bnd, positionCode: null })
  })

  it('Chủ tịch: Lead Chapter → đích là đơn vị CHAPTER của chính Chapter đó, bỏ qua ban gửi kèm', async () => {
    assert.deepEqual(await resolveMemberInviteScope(actors.lead, { position: 'PRESIDENT' }), { ok: true, organizationUnitId: U.chapter, positionCode: 'PRESIDENT' })
    assert.deepEqual(await resolveMemberInviteScope(actors.lead, { position: 'PRESIDENT', organizationUnitId: U.bnd2 }), { ok: true, organizationUnitId: U.chapter, positionCode: 'PRESIDENT' })
    assert.deepEqual(await resolveMemberInviteScope(actors.lead2, { position: 'PRESIDENT' }), { ok: true, organizationUnitId: U.chapter2, positionCode: 'PRESIDENT' })
  })

  it('Chủ tịch: người chỉ quản lý một ban, quản lý DNA, Admin, Lead chưa có Chapter đều bị từ chối', async () => {
    for (const key of ['deptManager', 'dnaManager', 'admin', 'leadNoChapter']) {
      const result = await resolveMemberInviteScope(actors[key], { position: 'PRESIDENT' })
      assert.equal(result.ok, false, key)
      assert.equal(result.status, 403, key)
    }
  })

  it('Trưởng ban: cần một ban + quyền cấp Chapter', async () => {
    assert.deepEqual(await resolveMemberInviteScope(actors.lead, { position: 'DEPARTMENT_LEAD', organizationUnitId: U.bnd }), { ok: true, organizationUnitId: U.bnd, positionCode: 'DEPARTMENT_LEAD' })
    const deptOnly = await resolveMemberInviteScope(actors.deptManager, { position: 'DEPARTMENT_LEAD', organizationUnitId: U.bnd })
    assert.equal(deptOnly.status, 403, 'quản lý một ban chưa đủ để bổ nhiệm Trưởng ban')
    // Người quản lý ban vẫn mời thành viên thường vào ban của mình được (hành vi cũ giữ nguyên).
    assert.equal((await resolveMemberInviteScope(actors.deptManager, { organizationUnitId: U.bnd })).ok, true)
  })

  it('Trưởng ban: nhóm DNA → 400, ban của Chapter khác → 403, thiếu ban → 400, ban ngừng hoạt động → 404', async () => {
    assert.equal((await resolveMemberInviteScope(actors.lead, { position: 'DEPARTMENT_LEAD', organizationUnitId: U.dna })).status, 400)
    assert.equal((await resolveMemberInviteScope(actors.dnaManager, { position: 'DEPARTMENT_LEAD', organizationUnitId: U.dna })).status, 400)
    assert.equal((await resolveMemberInviteScope(actors.lead, { position: 'DEPARTMENT_LEAD', organizationUnitId: U.bnd2 })).status, 403)
    assert.equal((await resolveMemberInviteScope(actors.lead, { position: 'DEPARTMENT_LEAD' })).status, 400)
    assert.equal((await resolveMemberInviteScope(actors.lead, { position: 'DEPARTMENT_LEAD', organizationUnitId: U.inactiveDept })).status, 404)
  })

  it('chức vụ lạ hoặc sai kiểu → 400 InvalidInvitePosition', async () => {
    for (const position of ['CHAPTER_LEAD', 'president', 'DNA_LEAD', 42, ['PRESIDENT']]) {
      const result = await resolveMemberInviteScope(actors.lead, { position, organizationUnitId: U.bnd })
      assert.equal(result.status, 400, String(position))
      assert.equal(result.error.code, 'InvalidInvitePosition')
    }
  })
})

describe('cảnh báo Chủ tịch (checkPresidentInvite / president-status)', () => {
  it('Chapter trống, không lời mời Chủ tịch nào → cho gửi, không cảnh báo', async () => {
    const check = await checkPresidentInvite(U.chapter, 'moi@bbe.vn', undefined)
    assert.equal(check.ok, true)
  })

  it('đã có Chủ tịch, chưa xác nhận → 409, câu cảnh báo nêu tên + email Chủ tịch hiện tại', async () => {
    seatPresident()
    const check = await checkPresidentInvite(U.chapter, 'moi@bbe.vn', undefined)
    assert.equal(check.ok, false)
    assert.equal(check.status, 409)
    assert.equal(check.error.code, 'PresidentReplaceConfirmRequired')
    assert.match(check.error.message, /Nguyễn Văn Cũ/)
    assert.match(check.error.message, /cu@bbe\.vn/)
    assert.match(check.error.message, /thôi chức Chủ tịch/)
  })

  it('xác nhận phải đúng true; "true", 1, "yes" không được tính là xác nhận', async () => {
    seatPresident()
    for (const value of ['true', 1, 'yes', {}]) assert.equal((await checkPresidentInvite(U.chapter, 'moi@bbe.vn', value)).ok, false, String(value))
    assert.equal((await checkPresidentInvite(U.chapter, 'moi@bbe.vn', true)).ok, true)
  })

  it('Chủ tịch chưa đặt tên hiển thị → cảnh báo dùng email', async () => {
    seatPresident('khongten@bbe.vn', null)
    const check = await checkPresidentInvite(U.chapter, 'moi@bbe.vn', undefined)
    assert.match(check.error.message, /Chủ tịch khongten@bbe\.vn/)
  })

  it('đang có lời mời Chủ tịch khác còn hiệu lực → cũng phải cảnh báo; lời mời của chính email đó thì không tính', async () => {
    pendingPresident('cho@bbe.vn')
    const other = await checkPresidentInvite(U.chapter, 'moi@bbe.vn', undefined)
    assert.equal(other.ok, false)
    assert.match(other.error.message, /cho@bbe\.vn/)
    assert.match(other.error.message, /sẽ bị hủy/)
    assert.equal((await checkPresidentInvite(U.chapter, 'cho@bbe.vn', undefined)).ok, true, 'mời lại đúng người đang chờ không phải thay thế')
  })

  it('lời mời Chủ tịch đã hết hạn / đã hủy / của Chapter khác không gây cảnh báo', async () => {
    pendingPresident('het-han@bbe.vn'); db.invitations.at(-1)!.expires_at = new Date(Date.now() - 1000)
    pendingPresident('da-huy@bbe.vn'); db.invitations.at(-1)!.status = 'CANCELLED'
    pendingPresident('chapter-khac@bbe.vn', U.chapter2)
    assert.equal((await checkPresidentInvite(U.chapter, 'moi@bbe.vn', undefined)).ok, true)
  })

  it('GET president-status: Lead thấy quyền + cảnh báo; người quản lý ban không có quyền mời chức vụ', async () => {
    seatPresident()
    const leadRes = await statusRoute.GET(request('lead', undefined, 'http://localhost/api/v1/invitations/member/president-status'))
    const leadBody = await leadRes.json()
    assert.equal(leadBody.canInviteLeadership, true)
    assert.match(leadBody.warning, /Nguyễn Văn Cũ/)
    const deptBody = await (await statusRoute.GET(request('deptManager', undefined, 'http://localhost/api/v1/invitations/member/president-status'))).json()
    assert.deepEqual(deptBody, { canInviteLeadership: false, situation: null, warning: null, departmentLead: null })
  })
})

describe('API mời một email', () => {
  it('Lead mời Chủ tịch khi Chapter trống → 201, lời mời lưu position_code PRESIDENT trỏ vào đơn vị Chapter', async () => {
    const res = await call(singleRoute, 'lead', { email: 'ChuTich@BBE.vn ', position: 'PRESIDENT' })
    assert.equal(res.status, 201)
    assert.equal(res.body.positionCode, 'PRESIDENT')
    const [row] = live('chutich@bbe.vn')
    assert.equal(row.organization_unit_id, U.chapter)
    assert.equal(row.position_code, 'PRESIDENT')
    assert.equal(row.chapter_id, null)
  })

  it('Chapter đã có Chủ tịch: lần đầu 409 + cảnh báo, KHÔNG tạo lời mời và KHÔNG gửi mail; gửi lại có xác nhận → 201', async () => {
    seatPresident()
    const first = await call(singleRoute, 'lead', { email: 'moi@bbe.vn', position: 'PRESIDENT' })
    assert.equal(first.status, 409)
    assert.equal(first.body.error.code, 'PresidentReplaceConfirmRequired')
    assert.match(first.body.error.message, /Nguyễn Văn Cũ/)
    assert.equal(db.invitations.length, 0)
    assert.equal(emailCalls.length, 0)
    const confirmed = await call(singleRoute, 'lead', { email: 'moi@bbe.vn', position: 'PRESIDENT', confirmReplacePresident: true })
    assert.equal(confirmed.status, 201)
    assert.equal(live('moi@bbe.vn').length, 1)
  })

  it('đang có lời mời Chủ tịch cho người khác: 409; xác nhận → lời mời cũ bị hủy, chỉ còn 1 lời mời Chủ tịch đang chờ', async () => {
    pendingPresident('cho@bbe.vn')
    assert.equal((await call(singleRoute, 'lead', { email: 'moi@bbe.vn', position: 'PRESIDENT' })).status, 409)
    assert.equal(live('cho@bbe.vn').length, 1, 'chưa xác nhận thì không đụng lời mời cũ')
    assert.equal((await call(singleRoute, 'lead', { email: 'moi@bbe.vn', position: 'PRESIDENT', confirmReplacePresident: true })).status, 201)
    assert.equal(live('cho@bbe.vn').length, 0)
    assert.equal(db.invitations.find((r) => r.email === 'cho@bbe.vn')!.status, 'CANCELLED')
    assert.equal(db.invitations.filter((r) => r.position_code === 'PRESIDENT' && r.status === 'PENDING').length, 1)
  })

  it('mời Chủ tịch không hủy lời mời Chủ tịch của Chapter khác, cũng không hủy lời mời Trưởng ban/thành viên', async () => {
    pendingPresident('chapter-khac@bbe.vn', U.chapter2)
    db.invitations.push({ id: 'lead-inv', email: 'truongban@bbe.vn', role: 'MEMBER', organization_unit_id: U.bnd, position_code: 'DEPARTMENT_LEAD', status: 'PENDING', expires_at: future(), invited_by: 'lead', token_hash: 'x' })
    assert.equal((await call(singleRoute, 'lead', { email: 'moi@bbe.vn', position: 'PRESIDENT' })).status, 201)
    assert.equal(live('chapter-khac@bbe.vn').length, 1)
    assert.equal(live('truongban@bbe.vn').length, 1)
  })

  it('Trưởng ban: 201, lưu đúng ban + DEPARTMENT_LEAD; không cần xác nhận Chủ tịch', async () => {
    seatPresident()
    const res = await call(singleRoute, 'lead', { email: 'tb@bbe.vn', position: 'DEPARTMENT_LEAD', organizationUnitId: U.bnd })
    assert.equal(res.status, 201)
    const [row] = live('tb@bbe.vn')
    assert.deepEqual([row.organization_unit_id, row.position_code], [U.bnd, 'DEPARTMENT_LEAD'])
  })

  it('thành viên thường (client cũ, không gửi position): position_code null như trước', async () => {
    const res = await call(singleRoute, 'lead', { email: 'tv@bbe.vn', organizationUnitId: U.bnd })
    assert.equal(res.status, 201)
    assert.equal(live('tv@bbe.vn')[0].position_code, null)
  })

  it('người quản lý một ban mời Chủ tịch → 403, không tạo gì', async () => {
    const res = await call(singleRoute, 'deptManager', { email: 'moi@bbe.vn', position: 'PRESIDENT' })
    assert.equal(res.status, 403)
    assert.equal(db.invitations.length, 0)
  })

  it('email sai định dạng khi mời Chủ tịch → 400 trước cả khi xét cảnh báo', async () => {
    seatPresident()
    const res = await call(singleRoute, 'lead', { email: 'khong-phai-email', position: 'PRESIDENT' })
    assert.equal(res.status, 400)
    assert.equal(db.invitations.length, 0)
  })

  it('email đã có tài khoản → bị từ chối kể cả khi mời Chủ tịch', async () => {
    db.users.push({ id: 'u1', email: 'dacotk@bbe.vn', status: 'ACTIVE' })
    const res = await call(singleRoute, 'lead', { email: 'dacotk@bbe.vn', position: 'PRESIDENT' })
    assert.equal(res.status, 400)
    assert.equal(res.body.error.code, 'EmailAlreadyActive')
  })

  it('mời lại cùng email từ thành viên ban sang Chủ tịch: lời mời cũ bị thay, chỉ còn lời mời Chủ tịch', async () => {
    assert.equal((await call(singleRoute, 'lead', { email: 'doi@bbe.vn', organizationUnitId: U.bnd })).status, 201)
    assert.equal((await call(singleRoute, 'lead', { email: 'doi@bbe.vn', position: 'PRESIDENT' })).status, 201)
    const pending = live('doi@bbe.vn')
    assert.equal(pending.length, 1)
    assert.equal(pending[0].position_code, 'PRESIDENT')
  })

  it('cùng email đang có lời mời ngoài phạm vi (Chapter khác) → 409 PendingInvitationOutOfScope, không bị thay', async () => {
    db.invitations.push({ id: 'foreign', email: 'ngoai@bbe.vn', role: 'MEMBER', organization_unit_id: U.bnd2, position_code: null, status: 'PENDING', expires_at: future(), invited_by: 'lead2', token_hash: 'f' })
    const res = await call(singleRoute, 'lead', { email: 'ngoai@bbe.vn', position: 'PRESIDENT' })
    assert.equal(res.status, 409)
    assert.equal(res.body.error.code, 'PendingInvitationOutOfScope')
    assert.equal(live('ngoai@bbe.vn')[0].id, 'foreign')
  })
})

describe('API mời nhiều email', () => {
  it('Chủ tịch + 2 email → 400 PresidentSingleEmail, KHÔNG tạo lời mời nào, KHÔNG gửi mail', async () => {
    const res = await call(bulkRoute, 'lead', { emails: 'a@bbe.vn\nb@bbe.vn', position: 'PRESIDENT' })
    assert.equal(res.status, 400)
    assert.equal(res.body.error.code, 'PresidentSingleEmail')
    assert.match(res.body.error.message, /chỉ có 1 Chủ tịch/)
    assert.match(res.body.error.message, /2 email/)
    assert.equal(db.invitations.length, 0)
    assert.equal(emailCalls.length, 0)
  })

  it('Chủ tịch + 10 email → 400, báo đúng số email', async () => {
    const emails = Array.from({ length: 10 }, (_, i) => `ct${i}@bbe.vn`)
    const res = await call(bulkRoute, 'lead', { emails, position: 'PRESIDENT', confirmReplacePresident: true })
    assert.equal(res.status, 400)
    assert.match(res.body.error.message, /10 email/)
    assert.equal(db.invitations.length, 0)
  })

  it('Chủ tịch + 1 email đúng + 1 email sai định dạng → vẫn chặn (2 dòng), không gửi email đúng', async () => {
    const res = await call(bulkRoute, 'lead', { emails: 'a@bbe.vn, sai-dinh-dang', position: 'PRESIDENT' })
    assert.equal(res.status, 400)
    assert.equal(res.body.error.code, 'PresidentSingleEmail')
    assert.equal(db.invitations.length, 0)
  })

  it('Chủ tịch + 1 email lặp lại nhiều lần (khác hoa thường) → tính là 1 email, gửi được', async () => {
    const res = await call(bulkRoute, 'lead', { emails: 'a@bbe.vn\nA@BBE.vn\na@bbe.vn', position: 'PRESIDENT' })
    assert.equal(res.status, 200)
    assert.equal(res.body.results.filter((r: any) => r.status === 'SENT').length, 1)
    assert.equal(live('a@bbe.vn')[0].position_code, 'PRESIDENT')
  })

  it('Chủ tịch + 1 email, Chapter đã có Chủ tịch → 409 cảnh báo, chưa gửi; xác nhận → gửi', async () => {
    seatPresident()
    const first = await call(bulkRoute, 'lead', { emails: ['moi@bbe.vn'], position: 'PRESIDENT' })
    assert.equal(first.status, 409)
    assert.equal(first.body.error.code, 'PresidentReplaceConfirmRequired')
    assert.equal(db.invitations.length, 0)
    const second = await call(bulkRoute, 'lead', { emails: ['moi@bbe.vn'], position: 'PRESIDENT', confirmReplacePresident: true })
    assert.equal(second.status, 200)
    assert.equal(second.body.results[0].status, 'SENT')
  })

  it('Trưởng ban nhiều email (cùng một ban) → 400 DepartmentLeadSingleEmail (mỗi ban 1 LT), không gửi gì', async () => {
    const res = await call(bulkRoute, 'lead', { emails: ['x@bbe.vn', 'y@bbe.vn'], position: 'DEPARTMENT_LEAD', organizationUnitId: U.bnd })
    assert.equal(res.status, 400)
    assert.equal(res.body.error.code, 'DepartmentLeadSingleEmail')
    assert.match(res.body.error.message, /2 email/)
    assert.equal(db.invitations.length, 0)
    assert.equal(emailCalls.length, 0)
  })

  it('thành viên thường nhiều email: không bị giới hạn 1 email (hành vi cũ)', async () => {
    const res = await call(bulkRoute, 'lead', { emails: 'm1@bbe.vn\nm2@bbe.vn\nm3@bbe.vn', organizationUnitId: U.btv })
    assert.equal(res.status, 200)
    assert.equal(db.invitations.filter((r) => r.position_code === null).length, 3)
  })

  it('người quản lý một ban mời loạt Chủ tịch → 403', async () => {
    assert.equal((await call(bulkRoute, 'deptManager', { emails: 'a@bbe.vn', position: 'PRESIDENT' })).status, 403)
  })
})

describe('sendMemberInvitation: đơn vị phải khớp chức vụ (chặn ở lib, không chỉ ở route)', () => {
  const base = { email: 'z@bbe.vn', role: 'MEMBER', invitedBy: 'lead' }
  it('Chủ tịch trỏ vào ban → MemberPositionRequired', async () => {
    const result = await sendMemberInvitation({ ...base, organizationUnitId: U.bnd, positionCode: 'PRESIDENT' })
    assert.equal(result.code, 'MemberPositionRequired')
  })
  it('Trưởng ban trỏ vào Chapter hoặc DNA → MemberPositionRequired', async () => {
    assert.equal((await sendMemberInvitation({ ...base, organizationUnitId: U.chapter, positionCode: 'DEPARTMENT_LEAD' })).code, 'MemberPositionRequired')
    assert.equal((await sendMemberInvitation({ ...base, organizationUnitId: U.dna, positionCode: 'DEPARTMENT_LEAD' })).code, 'MemberPositionRequired')
  })
  it('thành viên thường trỏ vào Chapter → MemberPositionRequired (hành vi cũ)', async () => {
    assert.equal((await sendMemberInvitation({ ...base, organizationUnitId: U.chapter })).code, 'MemberPositionRequired')
  })
  it('chức vụ cho lời mời không phải MEMBER → ValidationError', async () => {
    assert.equal((await sendMemberInvitation({ ...base, role: 'DNA_LEAD', organizationUnitId: U.dna, positionCode: 'PRESIDENT' })).code, 'ValidationError')
  })
  it('không lời mời nào được tạo ở các ca trên', () => assert.equal(db.invitations.length, 0))
})

describe('gửi lại lời mời Chủ tịch (cùng luật cảnh báo như gửi mới)', () => {
  const RESEND_ID = '99999999-9999-4999-8999-999999999999'
  const oldPresidentInvite = (status = 'CANCELLED') => db.invitations.push({ id: RESEND_ID, email: 'cu-moi@bbe.vn', role: 'MEMBER', organization_unit_id: U.chapter, position_code: 'PRESIDENT', status, expires_at: future(), invited_by: 'lead', token_hash: 'o', delivery_method: 'EMAIL' })
  const resendRoute = require('../app/api/v1/invitations/[id]/resend/route')
  const resend = async (actor: string, body: unknown = {}) => {
    const res = await resendRoute.POST(request(actor, body, `http://localhost/api/v1/invitations/${RESEND_ID}/resend`))
    return { status: res.status, body: await res.json() }
  }

  it('Chapter đang có Chủ tịch: gửi lại không xác nhận → 409 cảnh báo, lời mời vẫn CANCELLED (không lẳng lặng thay Chủ tịch)', async () => {
    seatPresident()
    oldPresidentInvite()
    const res = await resend('lead')
    assert.equal(res.status, 409)
    assert.equal(res.body.error.code, 'PresidentReplaceConfirmRequired')
    assert.match(res.body.error.message, /Nguyễn Văn Cũ/)
    assert.equal(db.invitations[0].status, 'CANCELLED')
    assert.equal(emailCalls.length, 0)
  })

  it('đã xác nhận → gửi lại được, lời mời sống lại', async () => {
    seatPresident()
    oldPresidentInvite()
    const res = await resend('lead', { confirmReplacePresident: true })
    assert.equal(res.status, 200)
    assert.equal(db.invitations[0].status, 'PENDING')
  })

  it('đang có lời mời Chủ tịch khác: không xác nhận → 409; xác nhận → lời mời kia bị hủy, chỉ còn 1 lời mời chờ', async () => {
    oldPresidentInvite()
    pendingPresident('dang-cho@bbe.vn')
    assert.equal((await resend('lead')).status, 409)
    assert.equal(live('dang-cho@bbe.vn').length, 1)
    assert.equal((await resend('lead', { confirmReplacePresident: true })).status, 200)
    assert.equal(live('dang-cho@bbe.vn').length, 0)
    assert.deepEqual(db.invitations.filter((r) => r.position_code === 'PRESIDENT' && r.status === 'PENDING').map((r) => r.email), ['cu-moi@bbe.vn'])
  })

  it('Chapter trống, không lời mời khác → gửi lại thẳng, không hỏi', async () => {
    oldPresidentInvite('EXPIRED')
    assert.equal((await resend('lead')).status, 200)
  })

  it('người chỉ quản lý một ban không gửi lại được lời mời Chủ tịch', async () => {
    oldPresidentInvite('PENDING')
    assert.equal((await resend('deptManager', { confirmReplacePresident: true })).status, 403)
  })

  it('gửi lại lời mời thành viên thường không bị hỏi gì dù Chapter có Chủ tịch', async () => {
    seatPresident()
    db.invitations.push({ id: 'tv', email: 'tv@bbe.vn', role: 'MEMBER', organization_unit_id: U.bnd, position_code: null, status: 'EXPIRED', expires_at: future(), invited_by: 'lead', token_hash: 't', delivery_method: 'EMAIL' })
    assert.equal((await resendInvitation('tv', 'lead', 'LEAD')).ok, true)
  })
})

describe('gửi Chủ tịch khóa Chapter trước khi hủy/tạo (chống hai lượt gửi cùng lúc)', () => {
  it('mời Chủ tịch có khóa dòng Chapter; mời thành viên thường thì không', async () => {
    await call(singleRoute, 'lead', { email: 'tv@bbe.vn', organizationUnitId: U.bnd })
    assert.equal(db.locks, 0)
    await call(singleRoute, 'lead', { email: 'ct@bbe.vn', position: 'PRESIDENT' })
    assert.equal(db.locks, 1)
  })
})

describe('kích hoạt lời mời (acceptInvitation)', () => {
  const seed = (id: string, unit: string, positionCode: string | null) => {
    const token = `token-${id}`
    db.invitations.push({ id, email: `${id}@bbe.vn`, role: 'MEMBER', organization_unit_id: unit, chapter_id: null, position_code: positionCode, status: 'PENDING', expires_at: future(), invited_by: 'lead', token_hash: hashToken(token), delivery_method: 'EMAIL' })
    return token
  }
  // Chapter của đơn vị được tìm qua organizationUnit.chapter; DB giả trả về chapter cho đơn vị CHAPTER.
  const realFindUnique = prisma.organizationUnit.findUnique
  beforeEach(() => {
    prisma.organizationUnit.findUnique = async (args: any) => {
      const unit = await realFindUnique(args)
      if (!unit) return null
      const chapter = chapters.find((c) => c.organization_unit_id === unit.id)
      return { ...unit, chapter: chapter ? { id: chapter.id } : null }
    }
  })

  it('lời mời Chủ tịch → gán PRESIDENT tại đơn vị Chapter cho tài khoản mới', async () => {
    const result = await acceptInvitation(seed('ct', U.chapter, 'PRESIDENT'), 'Mat-khau-1', 'ct@bbe.vn')
    assert.equal(result.ok, true)
    assert.deepEqual(db.assigned, [{ userId: result.userId, unitId: U.chapter, positionCode: 'PRESIDENT' }])
    assert.equal(db.users[0].role, 'MEMBER', 'Chủ tịch vẫn là MEMBER, không thành LEAD')
  })

  it('lời mời Trưởng ban → gán DEPARTMENT_LEAD tại ban', async () => {
    const result = await acceptInvitation(seed('tb', U.bnd, 'DEPARTMENT_LEAD'), 'Mat-khau-1', 'tb@bbe.vn')
    assert.equal(result.ok, true)
    assert.deepEqual(db.assigned[0], { userId: result.userId, unitId: U.bnd, positionCode: 'DEPARTMENT_LEAD' })
  })

  it('lời mời cũ (không có position_code) → như trước: thành viên của ban', async () => {
    const result = await acceptInvitation(seed('tv', U.bnd, null), 'Mat-khau-1', 'tv@bbe.vn')
    assert.equal(result.ok, true)
    assert.deepEqual(db.assigned[0], { userId: result.userId, unitId: U.bnd, positionCode: null })
  })

  it('kích hoạt Chủ tịch hủy mọi lời mời Chủ tịch khác còn sót của Chapter (không để ai thay ngầm sau này)', async () => {
    pendingPresident('sot@bbe.vn')
    pendingPresident('chapter-khac@bbe.vn', U.chapter2)
    const result = await acceptInvitation(seed('ct2', U.chapter, 'PRESIDENT'), 'Mat-khau-1', 'ct2@bbe.vn')
    assert.equal(result.ok, true)
    assert.equal(live('sot@bbe.vn').length, 0)
    assert.equal(live('chapter-khac@bbe.vn').length, 1, 'Chapter khác không bị ảnh hưởng')
  })

  it('kích hoạt Trưởng ban không đụng lời mời Chủ tịch đang chờ', async () => {
    pendingPresident('cho@bbe.vn')
    assert.equal((await acceptInvitation(seed('tb2', U.bnd, 'DEPARTMENT_LEAD'), 'Mat-khau-1', 'tb2@bbe.vn')).ok, true)
    assert.equal(live('cho@bbe.vn').length, 1)
  })

  it('dữ liệu hỏng: Chủ tịch trỏ vào ban → từ chối, không tạo tài khoản', async () => {
    const result = await acceptInvitation(seed('hong', U.bnd, 'PRESIDENT'), 'Mat-khau-1', 'hong@bbe.vn')
    assert.equal(result.ok, false)
    assert.equal(result.code, 'MemberPositionRequired')
    assert.equal(db.users.length, 0)
    assert.equal(db.assigned.length, 0)
  })

  it('trang kích hoạt nhận được chức vụ đích', async () => {
    const info = await validateInvitationToken(seed('xem', U.chapter, 'PRESIDENT'))
    assert.equal(info.ok, true)
    assert.equal(info.positionCode, 'PRESIDENT')
  })
})

describe('getChapterPresidentSituation', () => {
  it('trả Chủ tịch hiện tại và lời mời chờ, bỏ qua email đang được mời', async () => {
    seatPresident()
    pendingPresident('cho1@bbe.vn')
    pendingPresident('cho2@bbe.vn')
    const situation = await getChapterPresidentSituation(U.chapter, 'cho2@bbe.vn')
    assert.equal(situation.currentPresident.email, 'cu@bbe.vn')
    assert.deepEqual(situation.pendingInvitations.map((r: any) => r.email), ['cho1@bbe.vn'])
  })
})

// ======================= Trưởng ban (LT): mỗi ban tối đa 1 LT =======================
const { checkSingleHolderInvite, getSingleHolderSituation } = require('../lib/president-invite')
const { inviteSelection, replaceConfirmed, departmentLeadReplacementWarning, PRESIDENT_TARGET } = require('../lib/member-invite-position')
const seatLead = (unit = U.bnd, email = 'lt-cu@bbe.vn', name: string | null = 'Trần Thị Cũ') => db.deptLeads.push({ unit_id: unit, user: { id: `lt-${email}`, email, display_name: name } })
const pendingLead = (email: string, unit = U.bnd) => db.invitations.push({ id: `lead-${email}`, email, role: 'MEMBER', organization_unit_id: unit, position_code: 'DEPARTMENT_LEAD', status: 'PENDING', expires_at: future(), invited_by: 'lead', token_hash: `hl-${email}`, created_at: new Date(), delivery_method: 'EMAIL' })
const pendingLeadCount = (unit = U.bnd) => db.invitations.filter((r) => r.position_code === 'DEPARTMENT_LEAD' && r.organization_unit_id === unit && r.status === 'PENDING').length
const statusUrl = (query = '') => `http://localhost/api/v1/invitations/member/president-status${query}`

describe('LT: lựa chọn trong modal (inviteSelection) và cờ xác nhận (replaceConfirmed)', () => {
  it('chọn ban, không tick → thành viên; tick → Trưởng ban; chọn Chủ tịch → bỏ ban, bỏ tick', () => {
    assert.deepEqual(inviteSelection(U.bnd, false), { position: 'MEMBER', departmentUnitId: U.bnd })
    assert.deepEqual(inviteSelection(U.bnd, true), { position: 'DEPARTMENT_LEAD', departmentUnitId: U.bnd })
    assert.deepEqual(inviteSelection(PRESIDENT_TARGET, true), { position: 'PRESIDENT', departmentUnitId: '' })
    assert.deepEqual(inviteSelection('', true), { position: 'MEMBER', departmentUnitId: '' }, 'chưa chọn ban thì tick LT không có tác dụng')
  })

  it('confirmReplace chỉ nhận đúng true; confirmReplacePresident (tên cũ) chỉ có tác dụng với Chủ tịch', () => {
    assert.equal(replaceConfirmed({ confirmReplace: true }, 'DEPARTMENT_LEAD'), true)
    assert.equal(replaceConfirmed({ confirmReplace: true }, 'PRESIDENT'), true)
    assert.equal(replaceConfirmed({ confirmReplacePresident: true }, 'PRESIDENT'), true)
    assert.equal(replaceConfirmed({ confirmReplacePresident: true }, 'DEPARTMENT_LEAD'), false)
    for (const value of ['true', 1, 'yes', {}, null]) assert.equal(replaceConfirmed({ confirmReplace: value }, 'DEPARTMENT_LEAD'), false, String(value))
    assert.equal(replaceConfirmed(null, 'PRESIDENT'), false)
  })

  it('câu cảnh báo LT: nêu tên, email, LT cũ xuống Thành viên của chính ban; LT chưa đặt tên → dùng email', () => {
    const text = departmentLeadReplacementWarning({ unitName: 'Ban Nội Dung', currentHolder: { userId: 'x', name: 'Trần Thị Cũ', email: 'lt-cu@bbe.vn' }, pendingInvitations: [] })
    assert.match(text, /Ban Nội Dung đang có Trưởng ban Trần Thị Cũ \(lt-cu@bbe\.vn\)/)
    assert.match(text, /Trần Thị Cũ sẽ xuống Thành viên Ban Nội Dung/)
    assert.match(departmentLeadReplacementWarning({ unitName: 'Ban Nội Dung', currentHolder: { userId: 'x', name: '', email: 'khongten@bbe.vn' }, pendingInvitations: [] }), /Trưởng ban khongten@bbe\.vn/)
    assert.equal(departmentLeadReplacementWarning({ unitName: 'Ban Nội Dung', currentHolder: null, pendingInvitations: [] }), null)
  })
})

describe('LT: cảnh báo (checkSingleHolderInvite / president-status ?departmentUnitId=)', () => {
  it('ban trống LT, không lời mời LT nào → cho gửi, không cảnh báo', async () => {
    assert.equal((await checkSingleHolderInvite(U.bnd, 'DEPARTMENT_LEAD', 'moi@bbe.vn', undefined)).ok, true)
  })

  it('ban đã có LT, chưa xác nhận → 409 DepartmentLeadReplaceConfirmRequired nêu tên + email LT + tên ban', async () => {
    seatLead()
    const check = await checkSingleHolderInvite(U.bnd, 'DEPARTMENT_LEAD', 'moi@bbe.vn', undefined)
    assert.equal(check.ok, false)
    assert.equal(check.status, 409)
    assert.equal(check.error.code, 'DepartmentLeadReplaceConfirmRequired')
    assert.match(check.error.message, /Trần Thị Cũ/)
    assert.match(check.error.message, /lt-cu@bbe\.vn/)
    assert.match(check.error.message, /xuống Thành viên Ban Nội Dung/)
    assert.equal(check.error.situation.currentHolder.email, 'lt-cu@bbe.vn')
  })

  it('xác nhận phải đúng true', async () => {
    seatLead()
    for (const value of ['true', 1, 'yes', {}]) assert.equal((await checkSingleHolderInvite(U.bnd, 'DEPARTMENT_LEAD', 'moi@bbe.vn', value)).ok, false, String(value))
    assert.equal((await checkSingleHolderInvite(U.bnd, 'DEPARTMENT_LEAD', 'moi@bbe.vn', true)).ok, true)
  })

  it('lời mời LT khác của ban còn hiệu lực → cảnh báo "sẽ bị hủy"; lời mời của chính email đó không tính', async () => {
    pendingLead('cho-lt@bbe.vn')
    const other = await checkSingleHolderInvite(U.bnd, 'DEPARTMENT_LEAD', 'moi@bbe.vn', undefined)
    assert.equal(other.ok, false)
    assert.match(other.error.message, /cho-lt@bbe\.vn/)
    assert.match(other.error.message, /sẽ bị hủy/)
    assert.equal((await checkSingleHolderInvite(U.bnd, 'DEPARTMENT_LEAD', 'cho-lt@bbe.vn', undefined)).ok, true)
  })

  it('LT / lời mời LT ở ban khác, Chapter khác, Chủ tịch của Chapter, lời mời LT hết hạn/đã hủy → không cảnh báo cho ban này', async () => {
    seatLead(U.btv)
    seatLead(U.bnd2, 'lt-khac@bbe.vn')
    seatPresident()
    pendingLead('ban-khac@bbe.vn', U.btv)
    pendingLead('chapter-khac@bbe.vn', U.bnd2)
    pendingLead('het-han@bbe.vn'); db.invitations.at(-1)!.expires_at = new Date(Date.now() - 1000)
    pendingLead('da-huy@bbe.vn'); db.invitations.at(-1)!.status = 'CANCELLED'
    pendingPresident('ct-cho@bbe.vn')
    assert.equal((await checkSingleHolderInvite(U.bnd, 'DEPARTMENT_LEAD', 'moi@bbe.vn', undefined)).ok, true)
  })

  it('Chủ tịch vẫn kiểm theo Chapter: LT của ban không làm phát sinh cảnh báo Chủ tịch', async () => {
    seatLead()
    pendingLead('cho-lt@bbe.vn')
    assert.equal((await checkPresidentInvite(U.chapter, 'moi@bbe.vn', undefined)).ok, true)
  })

  it('getSingleHolderSituation trả tên ban, LT hiện tại, lời mời chờ (bỏ email đang mời)', async () => {
    seatLead()
    pendingLead('c1@bbe.vn')
    pendingLead('c2@bbe.vn')
    const situation = await getSingleHolderSituation(U.bnd, 'DEPARTMENT_LEAD', 'c2@bbe.vn')
    assert.equal(situation.unitName, 'Ban Nội Dung')
    assert.equal(situation.currentHolder.email, 'lt-cu@bbe.vn')
    assert.deepEqual(situation.pendingInvitations.map((r: any) => r.email), ['c1@bbe.vn'])
  })

  it('GET president-status?departmentUnitId=: Lead thấy cảnh báo LT của ban mình', async () => {
    seatLead()
    const body = await (await statusRoute.GET(request('lead', undefined, statusUrl(`?departmentUnitId=${U.bnd}`)))).json()
    assert.equal(body.canInviteLeadership, true)
    assert.match(body.departmentLead.warning, /Trần Thị Cũ/)
    assert.equal(body.warning, null, 'Chapter chưa có Chủ tịch')
    const empty = await (await statusRoute.GET(request('lead', undefined, statusUrl(`?departmentUnitId=${U.btv}`)))).json()
    assert.equal(empty.departmentLead.warning, null)
    assert.equal(empty.departmentLead.situation.unitName, 'Ban Thành Viên')
  })

  it('GET president-status: ban Chapter khác / ban ngừng hoạt động / nhóm DNA / id sai / không gửi → departmentLead null; người quản lý ban không thấy gì', async () => {
    seatLead(U.bnd2, 'lt-khac@bbe.vn')
    for (const query of [`?departmentUnitId=${U.bnd2}`, `?departmentUnitId=${U.inactiveDept}`, `?departmentUnitId=${U.dna}`, `?departmentUnitId=${U.chapter}`, '?departmentUnitId=khong-phai-uuid', '']) {
      const body = await (await statusRoute.GET(request('lead', undefined, statusUrl(query)))).json()
      assert.equal(body.departmentLead, null, query)
    }
    seatLead()
    const dept = await (await statusRoute.GET(request('deptManager', undefined, statusUrl(`?departmentUnitId=${U.bnd}`)))).json()
    assert.deepEqual(dept, { canInviteLeadership: false, situation: null, warning: null, departmentLead: null })
  })
})

describe('LT: API mời một email', () => {
  it('tick LT + ban trống LT → 201 lời mời DEPARTMENT_LEAD, không hỏi gì, có khóa Chapter theo ban', async () => {
    const res = await call(singleRoute, 'lead', { email: 'LT-Moi@BBE.vn', position: 'DEPARTMENT_LEAD', organizationUnitId: U.bnd })
    assert.equal(res.status, 201)
    assert.equal(res.body.positionCode, 'DEPARTMENT_LEAD')
    const [row] = live('lt-moi@bbe.vn')
    assert.deepEqual([row.organization_unit_id, row.position_code], [U.bnd, 'DEPARTMENT_LEAD'])
    assert.deepEqual(db.lockedUnits, [U.bnd])
  })

  it('ban đã có LT: 409 + cảnh báo, KHÔNG tạo lời mời, KHÔNG gửi mail; confirmReplace: true → 201', async () => {
    seatLead()
    const first = await call(singleRoute, 'lead', { email: 'moi@bbe.vn', position: 'DEPARTMENT_LEAD', organizationUnitId: U.bnd })
    assert.equal(first.status, 409)
    assert.equal(first.body.error.code, 'DepartmentLeadReplaceConfirmRequired')
    assert.match(first.body.error.message, /Trần Thị Cũ/)
    assert.equal(db.invitations.length, 0)
    assert.equal(emailCalls.length, 0)
    const confirmed = await call(singleRoute, 'lead', { email: 'moi@bbe.vn', position: 'DEPARTMENT_LEAD', organizationUnitId: U.bnd, confirmReplace: true })
    assert.equal(confirmed.status, 201)
    assert.equal(live('moi@bbe.vn')[0].position_code, 'DEPARTMENT_LEAD')
  })

  it('xác nhận sai kiểu ("true", 1) hoặc dùng tên cũ confirmReplacePresident → vẫn 409', async () => {
    seatLead()
    for (const extra of [{ confirmReplace: 'true' }, { confirmReplace: 1 }, { confirmReplacePresident: true }]) {
      const res = await call(singleRoute, 'lead', { email: 'moi@bbe.vn', position: 'DEPARTMENT_LEAD', organizationUnitId: U.bnd, ...extra })
      assert.equal(res.status, 409, JSON.stringify(extra))
    }
    assert.equal(db.invitations.length, 0)
  })

  it('đang có lời mời LT cho người khác cùng ban: 409; xác nhận → lời mời đó bị hủy, còn đúng 1 lời mời LT chờ; ban khác / Chapter khác / Chủ tịch / thành viên không bị đụng', async () => {
    pendingLead('cho-lt@bbe.vn')
    pendingLead('ban-khac@bbe.vn', U.btv)
    pendingLead('chapter-khac@bbe.vn', U.bnd2)
    pendingPresident('ct-cho@bbe.vn')
    db.invitations.push({ id: 'tv-bnd', email: 'tv-bnd@bbe.vn', role: 'MEMBER', organization_unit_id: U.bnd, position_code: null, status: 'PENDING', expires_at: future(), invited_by: 'lead', token_hash: 'tvb' })
    assert.equal((await call(singleRoute, 'lead', { email: 'moi@bbe.vn', position: 'DEPARTMENT_LEAD', organizationUnitId: U.bnd })).status, 409)
    assert.equal(live('cho-lt@bbe.vn').length, 1, 'chưa xác nhận thì không đụng lời mời cũ')
    assert.equal((await call(singleRoute, 'lead', { email: 'moi@bbe.vn', position: 'DEPARTMENT_LEAD', organizationUnitId: U.bnd, confirmReplace: true })).status, 201)
    assert.equal(db.invitations.find((r) => r.email === 'cho-lt@bbe.vn')!.status, 'CANCELLED')
    assert.equal(pendingLeadCount(), 1)
    for (const email of ['ban-khac@bbe.vn', 'chapter-khac@bbe.vn', 'ct-cho@bbe.vn', 'tv-bnd@bbe.vn']) assert.equal(live(email).length, 1, email)
  })

  it('mời thành viên thường vào ban đã có LT: 201, không hỏi, không hủy lời mời LT chờ', async () => {
    seatLead()
    pendingLead('cho-lt@bbe.vn')
    const res = await call(singleRoute, 'lead', { email: 'tv@bbe.vn', organizationUnitId: U.bnd })
    assert.equal(res.status, 201)
    assert.equal(live('tv@bbe.vn')[0].position_code, null)
    assert.equal(live('cho-lt@bbe.vn').length, 1)
    assert.equal(db.locks, 0, 'thành viên thường không khóa Chapter')
  })

  it('Chủ tịch: tên xác nhận chung confirmReplace cũng dùng được (bên cạnh tên cũ)', async () => {
    seatPresident()
    assert.equal((await call(singleRoute, 'lead', { email: 'ct-moi@bbe.vn', position: 'PRESIDENT', confirmReplace: true })).status, 201)
    assert.deepEqual(db.lockedUnits, [U.chapter])
  })

  it('quyền: người quản lý một ban, Admin, Lead Chapter khác không mời được LT; không tạo lời mời nào', async () => {
    for (const [actor, unit, status] of [['deptManager', U.bnd, 403], ['admin', U.bnd, 400], ['lead2', U.bnd, 403], ['lead', U.bnd2, 403], ['dnaManager', U.dna, 400]] as const) {
      const res = await call(singleRoute, actor, { email: 'moi@bbe.vn', position: 'DEPARTMENT_LEAD', organizationUnitId: unit, confirmReplace: true })
      assert.equal(res.status, status, `${actor}/${unit}`)
    }
    assert.equal(db.invitations.length, 0)
  })

  it('người quản lý một ban vẫn mời thành viên thường vào ban của mình (không đổi)', async () => {
    seatLead()
    assert.equal((await call(singleRoute, 'deptManager', { email: 'tv2@bbe.vn', organizationUnitId: U.bnd })).status, 201)
  })
})

describe('LT: API mời nhiều email (tạm thời ở ticket 01)', () => {
  it('position DEPARTMENT_LEAD + 1 email đúng + 1 email sai định dạng → vẫn chặn (2 dòng)', async () => {
    const res = await call(bulkRoute, 'lead', { emails: 'a@bbe.vn, sai', position: 'DEPARTMENT_LEAD', organizationUnitId: U.bnd })
    assert.equal(res.status, 400)
    assert.equal(res.body.error.code, 'DepartmentLeadSingleEmail')
    assert.equal(db.invitations.length, 0)
  })

  it('position DEPARTMENT_LEAD + 1 email, ban đã có LT → 409, chưa gửi; confirmReplace → gửi', async () => {
    seatLead()
    const first = await call(bulkRoute, 'lead', { emails: ['moi@bbe.vn'], position: 'DEPARTMENT_LEAD', organizationUnitId: U.bnd })
    assert.equal(first.status, 409)
    assert.equal(first.body.error.code, 'DepartmentLeadReplaceConfirmRequired')
    assert.equal(db.invitations.length, 0)
    assert.equal(emailCalls.length, 0)
    const second = await call(bulkRoute, 'lead', { emails: ['moi@bbe.vn'], position: 'DEPARTMENT_LEAD', organizationUnitId: U.bnd, confirmReplace: true })
    assert.equal(second.status, 200)
    assert.equal(second.body.results[0].status, 'SENT')
  })

  it('chọn ban ở tab Nhiều email = mọi email là thành viên (không hỏi dù ban đã có LT)', async () => {
    seatLead()
    const res = await call(bulkRoute, 'lead', { emails: ['m1@bbe.vn', 'm2@bbe.vn'], organizationUnitId: U.bnd })
    assert.equal(res.status, 200)
    assert.deepEqual(db.invitations.map((r) => r.position_code), [null, null])
  })

  it('Chủ tịch trong tab Nhiều email với tên xác nhận chung confirmReplace', async () => {
    seatPresident()
    const res = await call(bulkRoute, 'lead', { emails: ['ct@bbe.vn'], position: 'PRESIDENT', confirmReplace: true })
    assert.equal(res.status, 200)
  })
})

describe('LT: mời nhiều email có chọn Trưởng ban (leadEmail, ticket 02)', () => {
  const bulk = (body: Record<string, unknown>, actor = 'lead') => call(bulkRoute, actor, { organizationUnitId: U.bnd, ...body })
  const positions = () => Object.fromEntries(db.invitations.filter((r) => r.status === 'PENDING').map((r) => [r.email, r.position_code]))

  it('không chọn LT (không gửi / null / chuỗi rỗng / khoảng trắng) → mọi email là thành viên như cũ, không hỏi dù ban đã có LT', async () => {
    seatLead()
    const values = [undefined, null, '', '   ']
    for (let i = 0; i < values.length; i++) {
      const leadEmail = values[i]
      const res = await bulk({ emails: [`k${i}a@bbe.vn`, `k${i}b@bbe.vn`], ...(leadEmail === undefined ? {} : { leadEmail }) })
      assert.equal(res.status, 200, String(leadEmail))
      assert.ok(res.body.results.every((r: any) => r.positionCode === undefined))
    }
    assert.ok(db.invitations.every((r) => r.position_code === null))
    assert.equal(db.locks, 0, 'không có LT thì không khóa Chapter')
  })

  it('ban trống LT: đúng 1 lời mời DEPARTMENT_LEAD cho email được chọn, còn lại thành viên cùng ban; dòng kết quả LT gắn positionCode', async () => {
    const res = await bulk({ emails: 'a@bbe.vn\nlt@bbe.vn\nb@bbe.vn', leadEmail: 'lt@bbe.vn' })
    assert.equal(res.status, 200)
    assert.deepEqual(positions(), { 'a@bbe.vn': null, 'lt@bbe.vn': 'DEPARTMENT_LEAD', 'b@bbe.vn': null })
    assert.ok(db.invitations.every((r) => r.organization_unit_id === U.bnd))
    assert.deepEqual(res.body.results.map((r: any) => [r.email, r.status, r.positionCode]), [['a@bbe.vn', 'SENT', undefined], ['lt@bbe.vn', 'SENT', 'DEPARTMENT_LEAD'], ['b@bbe.vn', 'SENT', undefined]])
    assert.equal(emailCalls.length, 3)
    assert.deepEqual(db.lockedUnits, [U.bnd], 'chỉ lời mời LT khóa Chapter (theo ban)')
    assert.equal(res.body.summary.created, 3)
  })

  it('leadEmail khác hoa-thường / có khoảng trắng vẫn khớp email trong danh sách (cũng viết hoa)', async () => {
    const res = await bulk({ emails: ['x@bbe.vn', 'LT@Bbe.VN'], leadEmail: '  lt@BBE.vn ' })
    assert.equal(res.status, 200)
    assert.deepEqual(positions(), { 'x@bbe.vn': null, 'lt@bbe.vn': 'DEPARTMENT_LEAD' })
    assert.equal(res.body.results.find((r: any) => r.email === 'lt@bbe.vn').positionCode, 'DEPARTMENT_LEAD')
  })

  it('email LT xuất hiện 2 lần trong danh sách (khác hoa-thường) → 1 lời mời LT, dòng lặp báo DUPLICATE và không gắn nhãn LT', async () => {
    const res = await bulk({ emails: 'lt@bbe.vn\nLT@bbe.vn\nm@bbe.vn', leadEmail: 'lt@bbe.vn' })
    assert.equal(res.status, 200)
    assert.equal(db.invitations.filter((r) => r.position_code === 'DEPARTMENT_LEAD').length, 1)
    assert.deepEqual(res.body.results.map((r: any) => [r.status, r.positionCode]), [['DUPLICATE', undefined], ['SENT', 'DEPARTMENT_LEAD'], ['SENT', undefined]])
  })

  it('leadEmail không có trong danh sách → 400 LeadEmailNotInList, không tạo lời mời, không gửi mail', async () => {
    seatLead()
    const res = await bulk({ emails: ['a@bbe.vn', 'b@bbe.vn'], leadEmail: 'khac@bbe.vn', confirmReplace: true })
    assert.equal(res.status, 400)
    assert.equal(res.body.error.code, 'LeadEmailNotInList')
    assert.equal(db.invitations.length, 0)
    assert.equal(emailCalls.length, 0)
  })

  it('leadEmail sai định dạng hoặc sai kiểu → 400 InvalidLeadEmail; trùng một dòng sai định dạng của danh sách cũng 400', async () => {
    for (const leadEmail of ['sai-dinh-dang', 'a@b', 42, ['a@bbe.vn'], { email: 'a@bbe.vn' }, true]) {
      const res = await bulk({ emails: ['a@bbe.vn', 'sai-dinh-dang'], leadEmail })
      assert.equal(res.status, 400, JSON.stringify(leadEmail))
      assert.equal(res.body.error.code, 'InvalidLeadEmail', JSON.stringify(leadEmail))
    }
    assert.equal(db.invitations.length, 0)
    assert.equal(emailCalls.length, 0)
  })

  it('leadEmail đi cùng Chủ tịch hoặc chức vụ Trưởng ban cho cả lô → 400 LeadEmailWithPosition, không gửi gì', async () => {
    for (const body of [
      { emails: ['ct@bbe.vn'], position: 'PRESIDENT', leadEmail: 'ct@bbe.vn' },
      { emails: ['ct@bbe.vn'], position: 'PRESIDENT', leadEmail: 'ct@bbe.vn', confirmReplace: true },
      { emails: ['lt@bbe.vn'], position: 'DEPARTMENT_LEAD', leadEmail: 'lt@bbe.vn' },
      { emails: ['lt@bbe.vn', 'b@bbe.vn'], position: 'DEPARTMENT_LEAD', leadEmail: 'lt@bbe.vn' },
    ]) {
      const res = await bulk(body)
      assert.equal(res.status, 400, JSON.stringify(body))
      assert.equal(res.body.error.code, 'LeadEmailWithPosition', JSON.stringify(body))
    }
    // Chức vụ lạ vẫn báo lỗi chức vụ như cũ, không bị che bởi leadEmail.
    assert.equal((await bulk({ emails: ['a@bbe.vn'], position: 'BOSS', leadEmail: 'a@bbe.vn' })).body.error.code, 'InvalidInvitePosition')
    assert.equal(db.invitations.length, 0)
    assert.equal(emailCalls.length, 0)
  })

  it('leadEmail khi đích là nhóm DNA → 400, không tạo lời mời (người quản lý DNA vẫn mời loạt DNA được nếu không chọn LT)', async () => {
    const res = await call(bulkRoute, 'dnaManager', { emails: ['d1@bbe.vn', 'd2@bbe.vn'], organizationUnitId: U.dna, leadEmail: 'd1@bbe.vn' })
    assert.equal(res.status, 400)
    assert.equal(res.body.error.code, 'InvalidInvitePosition')
    assert.equal(db.invitations.length, 0)
    assert.equal((await call(bulkRoute, 'dnaManager', { emails: ['d1@bbe.vn', 'd2@bbe.vn'], organizationUnitId: U.dna })).status, 200)
  })

  it('quyền: chỉ người quản lý thành viên cấp Chapter dùng được leadEmail; quản lý một ban / Admin / Lead Chapter khác bị chặn, không tạo gì', async () => {
    for (const [actor, unit, status] of [['deptManager', U.bnd, 403], ['admin', U.bnd, 400], ['lead2', U.bnd, 403], ['lead', U.bnd2, 403]] as const) {
      const res = await call(bulkRoute, actor, { emails: ['lt@bbe.vn', 'm@bbe.vn'], organizationUnitId: unit, leadEmail: 'lt@bbe.vn', confirmReplace: true })
      assert.equal(res.status, status, `${actor}/${unit}`)
    }
    const dept = await call(bulkRoute, 'deptManager', { emails: ['lt@bbe.vn'], organizationUnitId: U.bnd, leadEmail: 'lt@bbe.vn' })
    assert.match(dept.body.error.message, /cấp Chapter/)
    assert.equal(db.invitations.length, 0)
    assert.equal(emailCalls.length, 0)
    // Không chọn LT thì người quản lý ban vẫn mời loạt thành viên vào ban mình (hành vi cũ).
    assert.equal((await call(bulkRoute, 'deptManager', { emails: ['m1@bbe.vn', 'm2@bbe.vn'], organizationUnitId: U.bnd })).status, 200)
  })

  it('ban đã có LT, chưa xác nhận → 409 nêu LT hiện tại, KHÔNG tạo lời mời nào, KHÔNG gửi email nào (kể cả email thành viên)', async () => {
    seatLead()
    const res = await bulk({ emails: ['a@bbe.vn', 'lt@bbe.vn', 'b@bbe.vn'], leadEmail: 'lt@bbe.vn' })
    assert.equal(res.status, 409)
    assert.equal(res.body.error.code, 'DepartmentLeadReplaceConfirmRequired')
    assert.match(res.body.error.message, /Trần Thị Cũ/)
    assert.match(res.body.error.message, /xuống Thành viên Ban Nội Dung/)
    assert.equal(db.invitations.length, 0)
    assert.equal(emailCalls.length, 0)
  })

  it('xác nhận sai kiểu ("true", 1) hoặc tên cũ confirmReplacePresident → vẫn 409; confirmReplace: true → 1 lời mời LT, còn lại thành viên', async () => {
    seatLead()
    for (const extra of [{ confirmReplace: 'true' }, { confirmReplace: 1 }, { confirmReplacePresident: true }]) {
      assert.equal((await bulk({ emails: ['a@bbe.vn', 'lt@bbe.vn'], leadEmail: 'lt@bbe.vn', ...extra })).status, 409, JSON.stringify(extra))
    }
    assert.equal(db.invitations.length, 0)
    const res = await bulk({ emails: ['a@bbe.vn', 'lt@bbe.vn'], leadEmail: 'lt@bbe.vn', confirmReplace: true })
    assert.equal(res.status, 200)
    assert.deepEqual(positions(), { 'a@bbe.vn': null, 'lt@bbe.vn': 'DEPARTMENT_LEAD' })
    assert.equal(emailCalls.length, 2)
  })

  it('lời mời LT chờ của người khác cùng ban: 409; xác nhận → lời mời đó bị hủy, còn đúng 1 lời mời LT; ban khác / Chapter khác / Chủ tịch / thành viên không bị đụng', async () => {
    pendingLead('cho-lt@bbe.vn')
    pendingLead('ban-khac@bbe.vn', U.btv)
    pendingLead('chapter-khac@bbe.vn', U.bnd2)
    pendingPresident('ct-cho@bbe.vn')
    db.invitations.push({ id: 'tv-bnd', email: 'tv-bnd@bbe.vn', role: 'MEMBER', organization_unit_id: U.bnd, position_code: null, status: 'PENDING', expires_at: future(), invited_by: 'lead', token_hash: 'tvb' })
    const first = await bulk({ emails: ['lt@bbe.vn', 'm@bbe.vn'], leadEmail: 'lt@bbe.vn' })
    assert.equal(first.status, 409)
    assert.match(first.body.error.message, /cho-lt@bbe\.vn/)
    assert.equal(live('cho-lt@bbe.vn').length, 1, 'chưa xác nhận thì không đụng lời mời cũ')
    const second = await bulk({ emails: ['lt@bbe.vn', 'm@bbe.vn'], leadEmail: 'lt@bbe.vn', confirmReplace: true })
    assert.equal(second.status, 200)
    assert.equal(db.invitations.find((r) => r.email === 'cho-lt@bbe.vn')!.status, 'CANCELLED')
    assert.equal(pendingLeadCount(), 1)
    assert.equal(live('lt@bbe.vn')[0].position_code, 'DEPARTMENT_LEAD')
    for (const email of ['ban-khac@bbe.vn', 'chapter-khac@bbe.vn', 'ct-cho@bbe.vn', 'tv-bnd@bbe.vn']) assert.equal(live(email).length, 1, email)
  })

  it('lời mời LT chờ của CHÍNH email được chọn không gây cảnh báo; được làm mới thành lời mời LT mới', async () => {
    pendingLead('lt@bbe.vn')
    const res = await bulk({ emails: ['lt@bbe.vn', 'm@bbe.vn'], leadEmail: 'lt@bbe.vn' })
    assert.equal(res.status, 200)
    assert.equal(res.body.results.find((r: any) => r.email === 'lt@bbe.vn').status, 'SENT')
    assert.equal(pendingLeadCount(), 1)
  })

  it('email LT đang có lời mời thành viên chờ cùng ban → được thay bằng lời mời LT (không báo ALREADY_INVITED); email khác đang chờ vẫn ALREADY_INVITED', async () => {
    for (const email of ['lt@bbe.vn', 'cho@bbe.vn']) db.invitations.push({ id: `tv-${email}`, email, role: 'MEMBER', organization_unit_id: U.bnd, position_code: null, status: 'PENDING', expires_at: future(), invited_by: 'lead', token_hash: `t-${email}` })
    const res = await bulk({ emails: ['lt@bbe.vn', 'cho@bbe.vn'], leadEmail: 'lt@bbe.vn' })
    assert.equal(res.status, 200)
    assert.deepEqual(res.body.results.map((r: any) => [r.email, r.status]), [['lt@bbe.vn', 'SENT'], ['cho@bbe.vn', 'ALREADY_INVITED']])
    assert.equal(db.invitations.find((r) => r.id === 'tv-lt@bbe.vn')!.status, 'CANCELLED')
    assert.equal(live('lt@bbe.vn')[0].position_code, 'DEPARTMENT_LEAD')
    assert.equal(live('cho@bbe.vn')[0].position_code, null, 'email không chọn LT giữ nguyên lời mời cũ')
  })

  it('email LT đã có tài khoản → ALREADY_MEMBER (không gắn nhãn LT vì không có lời mời LT), không hỏi xác nhận dù ban có LT, không tạo lời mời LT; email khác vẫn được mời', async () => {
    seatLead()
    db.users.push({ id: 'u-co-tk', email: 'co-tk@bbe.vn', status: 'ACTIVE' })
    const res = await bulk({ emails: ['co-tk@bbe.vn', 'm@bbe.vn'], leadEmail: 'co-tk@bbe.vn' })
    assert.equal(res.status, 200)
    assert.deepEqual(res.body.results.map((r: any) => [r.email, r.status, r.positionCode]), [['co-tk@bbe.vn', 'ALREADY_MEMBER', undefined], ['m@bbe.vn', 'SENT', undefined]])
    assert.equal(pendingLeadCount(), 0)
  })

  it('"Thử lại email lỗi": gửi lại riêng email LT với leadEmail → vẫn là lời mời LT; gửi lại email thường không kèm leadEmail → thành viên', async () => {
    const retryLead = await bulk({ emails: ['lt@bbe.vn'], leadEmail: 'lt@bbe.vn' })
    assert.equal(retryLead.status, 200)
    assert.equal(retryLead.body.results[0].positionCode, 'DEPARTMENT_LEAD')
    const retryMember = await bulk({ emails: ['m@bbe.vn'] })
    assert.equal(retryMember.body.results[0].positionCode, undefined)
    assert.deepEqual(positions(), { 'lt@bbe.vn': 'DEPARTMENT_LEAD', 'm@bbe.vn': null })
  })

  it('position DEPARTMENT_LEAD cho cả lô ≥ 2 email vẫn 400 DepartmentLeadSingleEmail (không đổi)', async () => {
    const res = await bulk({ emails: ['a@bbe.vn', 'b@bbe.vn'], position: 'DEPARTMENT_LEAD' })
    assert.equal(res.status, 400)
    assert.equal(res.body.error.code, 'DepartmentLeadSingleEmail')
    assert.equal(db.invitations.length, 0)
  })
})

describe('LT: gửi lại lời mời (cùng luật cảnh báo như gửi mới)', () => {
  const RESEND_ID = '88888888-8888-4888-8888-888888888888'
  const oldLeadInvite = (status = 'CANCELLED', unit = U.bnd) => db.invitations.push({ id: RESEND_ID, email: 'lt-gui-lai@bbe.vn', role: 'MEMBER', organization_unit_id: unit, position_code: 'DEPARTMENT_LEAD', status, expires_at: future(), invited_by: 'lead', token_hash: 'r', delivery_method: 'EMAIL' })
  const resendRoute = require('../app/api/v1/invitations/[id]/resend/route')
  const resend = async (actor: string, body: unknown = {}) => {
    const res = await resendRoute.POST(request(actor, body, `http://localhost/api/v1/invitations/${RESEND_ID}/resend`))
    return { status: res.status, body: await res.json() }
  }

  it('ban đã có LT: gửi lại không xác nhận → 409, lời mời vẫn CANCELLED, không gửi mail; confirmReplace → 200 PENDING', async () => {
    seatLead()
    oldLeadInvite()
    const res = await resend('lead')
    assert.equal(res.status, 409)
    assert.equal(res.body.error.code, 'DepartmentLeadReplaceConfirmRequired')
    assert.match(res.body.error.message, /Trần Thị Cũ/)
    assert.equal(db.invitations[0].status, 'CANCELLED')
    assert.equal(emailCalls.length, 0)
    assert.equal((await resend('lead', { confirmReplacePresident: true })).status, 409, 'tên cũ chỉ dành cho Chủ tịch')
    const ok = await resend('lead', { confirmReplace: true })
    assert.equal(ok.status, 200)
    assert.equal(db.invitations[0].status, 'PENDING')
  })

  it('đang có lời mời LT khác cùng ban: 409; xác nhận → lời mời kia bị hủy, còn đúng 1 lời mời LT chờ; ban khác không bị đụng', async () => {
    oldLeadInvite()
    pendingLead('dang-cho@bbe.vn')
    pendingLead('ban-khac@bbe.vn', U.btv)
    assert.equal((await resend('lead')).status, 409)
    assert.equal(live('dang-cho@bbe.vn').length, 1)
    assert.equal((await resend('lead', { confirmReplace: true })).status, 200)
    assert.equal(live('dang-cho@bbe.vn').length, 0)
    assert.equal(pendingLeadCount(), 1)
    assert.equal(live('ban-khac@bbe.vn').length, 1)
    assert.deepEqual(db.lockedUnits, [U.bnd])
  })

  it('ban trống LT, không lời mời khác → gửi lại thẳng', async () => {
    oldLeadInvite('EXPIRED')
    assert.equal((await resend('lead')).status, 200)
  })

  it('người chỉ quản lý ban đó không gửi lại được lời mời LT (cần quyền cấp Chapter); Lead Chapter khác cũng không', async () => {
    oldLeadInvite('PENDING')
    const dept = await resend('deptManager', { confirmReplace: true })
    assert.equal(dept.status, 403)
    assert.equal((await resend('lead2', { confirmReplace: true })).status, 403)
    assert.equal(emailCalls.length, 0)
  })

  it('người quản lý ban vẫn gửi lại được lời mời thành viên thường của ban mình', async () => {
    db.invitations.push({ id: RESEND_ID, email: 'tv@bbe.vn', role: 'MEMBER', organization_unit_id: U.bnd, position_code: null, status: 'EXPIRED', expires_at: future(), invited_by: 'lead', token_hash: 't', delivery_method: 'EMAIL' })
    assert.equal((await resend('deptManager')).status, 200)
  })
})

describe('LT: kích hoạt lời mời', () => {
  const seed = (id: string, unit: string, positionCode: string | null) => {
    const token = `token-${id}`
    db.invitations.push({ id, email: `${id}@bbe.vn`, role: 'MEMBER', organization_unit_id: unit, chapter_id: null, position_code: positionCode, status: 'PENDING', expires_at: future(), invited_by: 'lead', token_hash: hashToken(token), delivery_method: 'EMAIL' })
    return token
  }
  const realFindUnique = prisma.organizationUnit.findUnique
  beforeEach(() => {
    prisma.organizationUnit.findUnique = async (args: any) => {
      const unit = await realFindUnique(args)
      if (!unit) return null
      const chapter = chapters.find((c) => c.organization_unit_id === unit.id)
      return { ...unit, chapter: chapter ? { id: chapter.id } : null }
    }
  })

  it('kích hoạt LT: khóa Chapter trước khi chiếm lời mời, hủy mọi lời mời LT khác của ban, gán DEPARTMENT_LEAD', async () => {
    pendingLead('sot@bbe.vn')
    pendingLead('ban-khac@bbe.vn', U.btv)
    pendingLead('chapter-khac@bbe.vn', U.bnd2)
    pendingPresident('ct-cho@bbe.vn')
    const result = await acceptInvitation(seed('ltnew', U.bnd, 'DEPARTMENT_LEAD'), 'Mat-khau-1', 'ltnew@bbe.vn')
    assert.equal(result.ok, true)
    assert.equal(live('sot@bbe.vn').length, 0)
    for (const email of ['ban-khac@bbe.vn', 'chapter-khac@bbe.vn', 'ct-cho@bbe.vn']) assert.equal(live(email).length, 1, email)
    assert.deepEqual(db.assigned, [{ userId: result.userId, unitId: U.bnd, positionCode: 'DEPARTMENT_LEAD' }])
    assert.deepEqual(db.events.slice(0, 2), [`lock:${U.bnd}`, 'claim:ltnew'], 'khóa Chapter trước khi chiếm lời mời (cùng thứ tự với lượt gửi)')
  })

  it('kích hoạt thành viên thường không khóa Chapter, không hủy lời mời LT', async () => {
    pendingLead('cho-lt@bbe.vn')
    assert.equal((await acceptInvitation(seed('tvnew', U.bnd, null), 'Mat-khau-1', 'tvnew@bbe.vn')).ok, true)
    assert.equal(db.locks, 0)
    assert.equal(live('cho-lt@bbe.vn').length, 1)
  })

  it('kích hoạt Chủ tịch không hủy lời mời LT nào', async () => {
    pendingLead('cho-lt@bbe.vn')
    assert.equal((await acceptInvitation(seed('ctnew', U.chapter, 'PRESIDENT'), 'Mat-khau-1', 'ctnew@bbe.vn')).ok, true)
    assert.equal(live('cho-lt@bbe.vn').length, 1)
  })
})
