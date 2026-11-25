/**
 * Bổ nhiệm Trưởng ban (LT) tức thì trong tab Chuyển giao nhiệm kỳ: mỗi ban tối đa 1 LT.
 * Chạy thật route POST /chapters/{id}/members/{userId}/department, updateChapterDepartment, replaceUserPosition,
 * demoteOtherDepartmentLeads, getSingleHolderSituation và hủy lời mời LT chờ trên một DB giả trong bộ nhớ
 * (transaction có rollback). Phần client: hỏi xác nhận bằng câu của server và cập nhật lạc quan danh sách ban.
 */
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'

const stub = (name: string, exports: unknown) => { const filename = require.resolve(name); require.cache[filename] = { id: filename, filename, loaded: true, exports } as NodeJS.Module }

// ---------- tổ chức ----------
type Row = Record<string, any>
const U = { ch: 'CH', bnd: 'BND', btv: 'BTV', btt: 'BTT', ch2: 'CH2', bnd2: 'BND2' }
// Đồng hồ giả của lockLearningUser phải ở quá khứ so với đồng hồ thật (getSingleHolderSituation, demoteOtherDepartmentLeads dùng new Date()).
const NOW = new Date(Date.now() - 60_000)
const PAST = new Date('2026-01-01T00:00:00Z')
const grants: Record<string, string[]> = { lead: [U.ch], deptManager: [U.bnd], lead2: [U.ch2] }
const actors: Record<string, Row> = {
  lead: { userId: 'lead', role: 'LEAD', chapterId: 'C1' },
  deptManager: { userId: 'deptManager', role: 'MEMBER', chapterId: 'C1' },
  lead2: { userId: 'lead2', role: 'LEAD', chapterId: 'C2' },
  admin: { userId: 'admin', role: 'ADMIN' },
}

let db: Record<string, Row[]>
const events: string[] = []
const synced: string[] = []

function freshDb() {
  const units = [
    { id: U.ch, type: 'CHAPTER', status: 'ACTIVE', parent_id: null, name: 'Chapter Phoenix' },
    { id: U.bnd, type: 'DEPARTMENT', status: 'ACTIVE', parent_id: U.ch, name: 'Ban Nội Dung' },
    { id: U.btv, type: 'DEPARTMENT', status: 'ACTIVE', parent_id: U.ch, name: 'Ban Thành Viên' },
    { id: U.btt, type: 'DEPARTMENT', status: 'ACTIVE', parent_id: U.ch, name: 'Ban Truyền Thông' },
    { id: U.ch2, type: 'CHAPTER', status: 'ACTIVE', parent_id: null, name: 'Chapter Khác' },
    { id: U.bnd2, type: 'DEPARTMENT', status: 'ACTIVE', parent_id: U.ch2, name: 'Ban Nội Dung 2' },
  ]
  const users = [
    ['lt', 'Trần Thị Cũ', 'lt@bbe.vn'], ['moi', 'Lê Văn Mới', 'moi@bbe.vn'], ['mem2', 'Phạm Thành Viên', 'mem2@bbe.vn'],
    ['lt2', 'Đỗ Trưởng Hai', 'lt2@bbe.vn'], ['pres', 'Chủ Tịch Cũ', 'pres@bbe.vn'], ['noname', null, 'noname@bbe.vn'], ['other', 'Ngoài Chapter', 'other@bbe.vn'],
  ].map(([id, display_name, email]) => ({ id, display_name, email, role: 'MEMBER', status: 'ACTIVE', auth_version: 0 }))
  const positions = [
    { id: 'p-lead', code: 'DEPARTMENT_LEAD', name: 'Trưởng ban', scope: 'DEPARTMENT' },
    { id: 'p-member', code: 'DEPARTMENT_MEMBER', name: 'Thành viên ban', scope: 'DEPARTMENT' },
    { id: 'p-pres', code: 'PRESIDENT', name: 'Chủ tịch Chapter', scope: 'CHAPTER' },
  ]
  const seat = (user: string, unit: string, position: string) => ({ id: `a-${user}`, user_id: user, unit_id: unit, position_id: position, starts_at: PAST, ends_at: null, appointed_by: 'lead', is_primary: true })
  const assignments = [seat('lt', U.bnd, 'p-lead'), seat('moi', U.bnd, 'p-member'), seat('mem2', U.btv, 'p-member'), seat('lt2', U.btv, 'p-lead'), seat('pres', U.ch, 'p-pres'), seat('noname', U.btt, 'p-member'), seat('other', U.bnd2, 'p-member')]
  return {
    units, users, positions, assignments,
    memberships: assignments.map((a) => ({ id: `m-${a.user_id}`, user_id: a.user_id, unit_id: a.unit_id, starts_at: PAST, ends_at: null, status: 'ACTIVE' })),
    chapters: [{ id: 'C1', organization_unit_id: U.ch }, { id: 'C2', organization_unit_id: U.ch2 }],
    chapterMembers: ['lt', 'moi', 'mem2', 'lt2', 'pres', 'noname'].map((user_id) => ({ user_id, chapter_id: 'C1' })).concat([{ user_id: 'other', chapter_id: 'C2' }]),
    invitations: [] as Row[],
    audits: [] as Row[],
  }
}

// ---------- bộ lọc where kiểu Prisma (đủ cho các truy vấn của luồng này) ----------
const relations: Record<string, Record<string, (row: Row) => [string, Row | undefined]>> = {
  assignments: {
    position: (row) => ['positions', db.positions.find((p) => p.id === row.position_id)],
    user: (row) => ['users', db.users.find((u) => u.id === row.user_id)],
    unit: (row) => ['units', db.units.find((u) => u.id === row.unit_id)],
  },
}
const OPS = ['not', 'in', 'lt', 'lte', 'gt', 'gte']
function matchValue(value: any, cond: any): boolean {
  if (cond && typeof cond === 'object' && !(cond instanceof Date) && Object.keys(cond).every((k) => OPS.includes(k))) {
    return Object.entries(cond).every(([op, arg]: [string, any]) => {
      if (op === 'not') return arg && typeof arg === 'object' && !(arg instanceof Date) ? !matchValue(value, arg) : value !== arg
      if (op === 'in') return arg.includes(value)
      if (value === null || value === undefined) return false
      return op === 'lt' ? value < arg : op === 'lte' ? value <= arg : op === 'gt' ? value > arg : value >= arg
    })
  }
  return cond instanceof Date ? value?.getTime?.() === cond.getTime() : value === cond
}
function matches(table: string, row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (cond === undefined) return true
    if (key === 'OR') return cond.some((w: Row) => matches(table, row, w))
    if (key === 'AND') return cond.every((w: Row) => matches(table, row, w))
    const rel = relations[table]?.[key]
    if (rel) { const [t, related] = rel(row); return Boolean(related) && matches(t, related!, cond) }
    return matchValue(row[key], cond)
  })
}
function tableApi(table: string, extra: Row = {}) {
  const rows = () => db[table]
  return {
    findMany: async ({ where }: Row = {}) => rows().filter((r) => matches(table, r, where)),
    findFirst: async ({ where, orderBy, select }: Row = {}) => {
      const found = rows().filter((r) => matches(table, r, where))
      if (orderBy?.starts_at === 'desc') found.sort((a, b) => b.starts_at - a.starts_at)
      if (!found[0]) return null
      // select quan hệ (vd. { user: { select } }) → gắn bản ghi liên quan như Prisma.
      const out: Row = { ...found[0] }
      for (const key of Object.keys(select || {})) if (relations[table]?.[key]) out[key] = relations[table][key](found[0])[1] ?? null
      return out
    },
    findUnique: async ({ where }: Row) => rows().find((r) => matches(table, r, where)) ?? null,
    findUniqueOrThrow: async ({ where }: Row) => { const r = rows().find((x) => matches(table, x, where)); if (!r) throw new Error(`${table} not found`); return r },
    update: async ({ where, data }: Row) => {
      const r = rows().find((x) => matches(table, x, where))!
      for (const [k, v] of Object.entries(data as Row)) r[k] = v && typeof v === 'object' && 'increment' in v ? r[k] + v.increment : v
      return r
    },
    updateMany: async ({ where, data }: Row) => { const hit = rows().filter((r) => matches(table, r, where)); hit.forEach((r) => Object.assign(r, data)); return { count: hit.length } },
    create: async ({ data }: Row) => { const r = { id: `${table}-${rows().length + 1}`, status: 'ACTIVE', ...data }; rows().push(r); return r },
    ...extra,
  }
}
const prisma: any = {
  organizationUnit: tableApi('units'),
  user: tableApi('users'),
  position: tableApi('positions', { upsert: async ({ where }: Row) => db.positions.find((p) => p.code === where.code) }),
  positionAssignment: tableApi('assignments'),
  organizationMembership: tableApi('memberships'),
  chapter: tableApi('chapters'),
  chapterMember: tableApi('chapterMembers'),
  invitation: tableApi('invitations'),
  auditLog: { create: async ({ data }: Row) => { db.audits.push(data); return data } },
  chapterLeadBinding: { findUnique: async () => null },
  $queryRaw: async (sql: TemplateStringsArray) => { if (sql.join('?').includes('chapters')) events.push('lock:chapter'); return [] },
  // Transaction thật rollback khi lỗi: chụp lại toàn bộ DB giả, lỗi thì khôi phục.
  $transaction: async (fn: any) => {
    const snapshot = structuredClone(db)
    try { return await fn(prisma) } catch (error) { db = snapshot; throw error }
  },
}

stub('../lib/prisma', { prisma })
stub('../lib/auth', {
  authenticate: async (request: NextRequest) => {
    const actor = actors[request.headers.get('x-test-actor') || '']
    return actor ? { ok: true, context: actor } : { ok: false, error: { code: 'Unauthorized' } }
  },
})
stub('../lib/authorization', {
  canAccessChapterPermission: async (ctx: any, chapterId: string) => {
    if (ctx.role === 'ADMIN') return true
    const unit = db.chapters.find((c) => c.id === chapterId)?.organization_unit_id
    return Boolean(unit && (grants[ctx.userId] || []).includes(unit))
  },
})
stub('../lib/learning-periods', {
  lockLearningUser: async (_tx: unknown, userId: string) => { events.push(`lock:user:${userId}`); return NOW },
  enqueueAssignmentSync: async (_tx: unknown, userId: string) => { synced.push(userId) },
})
stub('../lib/learning-assignments', { reconcileLearningAssignmentsForUser: async (userId: string) => { events.push(`reconcile:${userId}`) } })
stub('../lib/organization-transition', { prepareOrganizationTransition: async () => NOW })
stub('../lib/affiliation-access', { hasActiveDnaAffiliation: async () => false })
stub('../lib/organization-view-cache', { invalidateOrganizationViews: () => {} })
stub('../lib/chapter-departments', { ensureChapterStandardDepartments: async () => [] })
stub('../lib/email', { sendInvitationEmail: async () => ({ success: true }) })

const route = require('../app/api/v1/chapters/[chapterId]/members/[userId]/department/route')
const { departmentLeadAppointmentWarning } = require('../lib/department-lead-appointment')
const { sendWithLeadReplaceConfirm, appointLeadInMembers, sortRosterMembers, hasOtherLead } = require('../app/chapter-manager/term-transition/lead-appointment')

async function post(userId: string, body: Row, actor = 'lead', chapterId = 'C1') {
  const request = new NextRequest(`http://localhost/api/v1/chapters/${chapterId}/members/${userId}/department`, {
    method: 'POST', headers: { 'x-test-actor': actor, 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
  const res = await route.POST(request, { params: { chapterId, userId } })
  return { status: res.status, body: await res.json() }
}
const codeOf = (a: Row) => db.positions.find((p) => p.id === a.position_id)?.code
const live = (a: Row) => a.ends_at === null || a.ends_at > NOW
const liveLeads = (unit: string) => db.assignments.filter((a) => a.unit_id === unit && codeOf(a) === 'DEPARTMENT_LEAD' && live(a)).map((a) => a.user_id).sort()
const liveOf = (user: string) => db.assignments.filter((a) => a.user_id === user && live(a)).map((a) => [codeOf(a), a.unit_id])
const authVersion = (user: string) => db.users.find((u) => u.id === user)!.auth_version
const future = () => new Date(Date.now() + 3600_000)
const pendingInvite = (email: string, unit: string, position_code = 'DEPARTMENT_LEAD', expires_at = future()) =>
  db.invitations.push({ id: `inv-${email}`, email, role: 'MEMBER', organization_unit_id: unit, position_code, status: 'PENDING', expires_at, created_at: NOW })
const statusOf = (email: string) => db.invitations.find((i) => i.email === email)!.status
const CONFIRM = 'DepartmentLeadReplaceConfirmRequired'

beforeEach(() => { db = freshDb(); events.length = 0; synced.length = 0 })

describe('bổ nhiệm LT vào ban đang có LT khác', () => {
  it('chưa xác nhận → 409 DepartmentLeadReplaceConfirmRequired, câu cảnh báo nêu LT hiện tại + người mới + "xuống Thành viên"; không đổi gì', async () => {
    const before = structuredClone(db)
    const res = await post('moi', { departmentUnitId: U.bnd, makeLead: true })
    assert.equal(res.status, 409)
    assert.equal(res.body.error.code, CONFIRM)
    const msg: string = res.body.error.message
    assert.match(msg, /Ban Nội Dung đang có Trưởng ban Trần Thị Cũ \(lt@bbe\.vn\)/)
    assert.match(msg, /nếu bổ nhiệm Lê Văn Mới làm Trưởng ban/)
    assert.match(msg, /Trần Thị Cũ sẽ xuống Thành viên Ban Nội Dung/)
    assert.deepEqual(db, before, 'rollback: DB y nguyên')
    assert.deepEqual(synced, [])
  })

  it('chỉ nhận đúng confirmReplace === true (chuỗi "true", 1, tên cũ confirmReplacePresident đều không tính)', async () => {
    for (const extra of [{ confirmReplace: 'true' }, { confirmReplace: 1 }, { confirmReplacePresident: true }, { confirmReplace: false }]) {
      const res = await post('moi', { departmentUnitId: U.bnd, makeLead: true, ...extra })
      assert.equal(res.status, 409, JSON.stringify(extra))
      assert.deepEqual(liveLeads(U.bnd), ['lt'])
    }
  })

  it('xác nhận → đúng 1 LT là người mới; LT cũ là Thành viên cùng ban, lịch sử còn, phiên làm mới, lộ trình đồng bộ', async () => {
    const res = await post('moi', { departmentUnitId: U.bnd, makeLead: true, confirmReplace: true })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.deepEqual(res.body, { success: true, departmentUnitId: U.bnd, isLead: true, demotedLeadUserIds: ['lt'] })
    assert.deepEqual(liveLeads(U.bnd), ['moi'])
    assert.deepEqual(liveOf('lt'), [['DEPARTMENT_MEMBER', U.bnd]], 'LT cũ là Thành viên của chính ban đó')
    assert.deepEqual(liveOf('moi'), [['DEPARTMENT_LEAD', U.bnd]])
    const history = db.assignments.find((a) => a.id === 'a-lt')!
    assert.equal(codeOf(history), 'DEPARTMENT_LEAD')
    assert.equal(history.ends_at, NOW, 'lịch sử LT cũ giữ nguyên, chỉ đóng ngày kết thúc')
    assert.ok(authVersion('lt') >= 1, 'phiên LT cũ được làm mới quyền')
    assert.ok(synced.includes('lt'), 'lộ trình học LT cũ đồng bộ lại')
    assert.ok(db.memberships.some((m) => m.user_id === 'lt' && m.unit_id === U.bnd && m.status === 'ACTIVE' && m.ends_at === null), 'LT cũ vẫn thuộc ban')
    const demoted = db.assignments.find((a) => a.user_id === 'lt' && codeOf(a) === 'DEPARTMENT_MEMBER' && live(a))!
    assert.equal(demoted.appointed_by, 'lead', 'người thao tác được ghi nhận')
    const audit = db.audits.at(-1)!
    assert.equal(audit.action, 'UPDATE_CHAPTER_DEPARTMENT')
    assert.deepEqual(audit.metadata.demotedLeadUserIds, ['lt'])
    assert.deepEqual(liveLeads(U.btv), ['lt2'], 'LT ban khác giữ nguyên')
  })

  it('khóa Chapter trước mọi người dùng; người mới bị khóa trước LT cũ (thứ tự khóa của ticket 01)', async () => {
    await post('moi', { departmentUnitId: U.bnd, makeLead: true, confirmReplace: true })
    const firstUser = events.findIndex((e) => e.startsWith('lock:user:'))
    assert.equal(events[0], 'lock:chapter', events.join(' → '))
    assert.ok(firstUser > 0)
    assert.ok(events.indexOf('lock:user:moi') < events.indexOf('lock:user:lt'), events.join(' → '))
  })

  it('đã xác nhận nhiều lần liên tiếp (bấm lại) → vẫn đúng 1 LT, không hạ thêm ai', async () => {
    await post('moi', { departmentUnitId: U.bnd, makeLead: true, confirmReplace: true })
    const again = await post('moi', { departmentUnitId: U.bnd, makeLead: true, confirmReplace: true })
    assert.equal(again.status, 200)
    assert.deepEqual(again.body.demotedLeadUserIds, [])
    assert.deepEqual(liveLeads(U.bnd), ['moi'])
    assert.deepEqual(liveOf('lt'), [['DEPARTMENT_MEMBER', U.bnd]])
  })

  it('LT hiện tại chưa có tên hiển thị → câu cảnh báo dùng email', async () => {
    await post('noname', { departmentUnitId: U.btt, makeLead: true })
    const res = await post('moi', { departmentUnitId: U.btt, makeLead: true })
    assert.equal(res.status, 409)
    assert.match(res.body.error.message, /Trưởng ban noname@bbe\.vn \(noname@bbe\.vn\)/)
    assert.match(res.body.error.message, /noname@bbe\.vn sẽ xuống Thành viên Ban Truyền Thông/)
  })

  it('người cũ đã chuyển khỏi vị trí LT trong lúc hộp xác nhận mở → gửi lại có confirmReplace vẫn đúng 1 LT', async () => {
    assert.equal((await post('moi', { departmentUnitId: U.bnd, makeLead: true })).status, 409)
    assert.equal((await post('lt', { departmentUnitId: U.btt, makeLead: false })).status, 200)
    const res = await post('moi', { departmentUnitId: U.bnd, makeLead: true, confirmReplace: true })
    assert.equal(res.status, 200)
    assert.deepEqual(res.body.demotedLeadUserIds, [])
    assert.deepEqual(liveLeads(U.bnd), ['moi'])
    assert.deepEqual(liveOf('lt'), [['DEPARTMENT_MEMBER', U.btt]])
  })
})

describe('lời mời LT đang chờ của ban (nhất quán với ticket 01)', () => {
  it('ban trống LT nhưng có lời mời LT chờ → 409 nêu email; xác nhận → lời mời bị hủy, lời mời khác không bị đụng', async () => {
    pendingInvite('cho@bbe.vn', U.btt)
    pendingInvite('banKhac@bbe.vn', U.bnd)
    pendingInvite('thanhvien@bbe.vn', U.btt, null as any)
    pendingInvite('chutich@bbe.vn', U.ch, 'PRESIDENT')
    const blocked = await post('moi', { departmentUnitId: U.btt, makeLead: true })
    assert.equal(blocked.status, 409)
    assert.match(blocked.body.error.message, /Ban Truyền Thông đang có lời mời Trưởng ban chưa kích hoạt cho cho@bbe\.vn; lời mời đó sẽ bị hủy/)
    assert.doesNotMatch(blocked.body.error.message, /đang có Trưởng ban/)
    assert.equal(statusOf('cho@bbe.vn'), 'PENDING', 'chưa xác nhận thì chưa hủy')
    const ok = await post('moi', { departmentUnitId: U.btt, makeLead: true, confirmReplace: true })
    assert.equal(ok.status, 200)
    assert.equal(statusOf('cho@bbe.vn'), 'CANCELLED')
    assert.ok(db.invitations.find((i) => i.email === 'cho@bbe.vn')!.cancelled_at instanceof Date)
    assert.equal(statusOf('banKhac@bbe.vn'), 'PENDING', 'lời mời LT ban khác giữ nguyên')
    assert.equal(statusOf('thanhvien@bbe.vn'), 'PENDING', 'lời mời thành viên thường giữ nguyên')
    assert.equal(statusOf('chutich@bbe.vn'), 'PENDING', 'lời mời Chủ tịch giữ nguyên')
  })

  it('ban có cả LT và lời mời LT chờ → câu cảnh báo nêu cả hai', async () => {
    pendingInvite('cho@bbe.vn', U.bnd)
    const res = await post('moi', { departmentUnitId: U.bnd, makeLead: true })
    assert.equal(res.status, 409)
    assert.match(res.body.error.message, /Trần Thị Cũ sẽ xuống Thành viên Ban Nội Dung.*lời mời Trưởng ban chưa kích hoạt cho cho@bbe\.vn/)
  })

  it('lời mời LT đã hết hạn không gây hỏi xác nhận', async () => {
    pendingInvite('hethan@bbe.vn', U.btt, 'DEPARTMENT_LEAD', new Date(Date.now() - 1000))
    const res = await post('moi', { departmentUnitId: U.btt, makeLead: true })
    assert.equal(res.status, 200, JSON.stringify(res.body))
  })
})

describe('các trường hợp không hỏi thừa', () => {
  it('bổ nhiệm lại chính LT hiện tại → không hỏi, không hạ ai, không hủy lời mời chờ; vẫn đúng 1 LT', async () => {
    pendingInvite('cho@bbe.vn', U.bnd)
    const res = await post('lt', { departmentUnitId: U.bnd, makeLead: true })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.deepEqual(res.body.demotedLeadUserIds, [])
    assert.deepEqual(liveLeads(U.bnd), ['lt'])
    assert.equal(statusOf('cho@bbe.vn'), 'PENDING')
    assert.deepEqual(synced, [])
    for (const user of ['moi', 'lt2', 'pres']) assert.equal(authVersion(user), 0, user)
  })

  it('chuyển LT sang ban trống LT (bổ nhiệm) → không hỏi; ban cũ trống LT, ban mới có đúng LT đó', async () => {
    const res = await post('lt2', { departmentUnitId: U.btt, makeLead: true })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.deepEqual(liveLeads(U.btv), [])
    assert.deepEqual(liveLeads(U.btt), ['lt2'])
    assert.deepEqual(liveOf('lt2'), [['DEPARTMENT_LEAD', U.btt]])
    assert.equal(db.assignments.find((a) => a.id === 'a-lt2')!.ends_at, NOW, 'lịch sử LT ở ban cũ còn')
  })

  it('chuyển LT sang ban khác làm thành viên → ban cũ trống LT, LT ban đích giữ nguyên', async () => {
    const res = await post('lt2', { departmentUnitId: U.bnd, makeLead: false })
    assert.equal(res.status, 200)
    assert.deepEqual(liveLeads(U.btv), [])
    assert.deepEqual(liveLeads(U.bnd), ['lt'])
    assert.deepEqual(liveOf('lt2'), [['DEPARTMENT_MEMBER', U.bnd]])
  })

  it('chuyển LT sang ban đang có LT khác (bổ nhiệm) → hỏi; xác nhận → ban đích đúng 1 LT, ban cũ trống LT', async () => {
    assert.equal((await post('lt2', { departmentUnitId: U.bnd, makeLead: true })).status, 409)
    assert.deepEqual(liveLeads(U.btv), ['lt2'], 'hủy thì ban cũ vẫn giữ LT')
    const res = await post('lt2', { departmentUnitId: U.bnd, makeLead: true, confirmReplace: true })
    assert.equal(res.status, 200)
    assert.deepEqual(liveLeads(U.bnd), ['lt2'])
    assert.deepEqual(liveLeads(U.btv), [])
    assert.deepEqual(liveOf('lt'), [['DEPARTMENT_MEMBER', U.bnd]])
  })

  it('đổi ban không tick bổ nhiệm vào ban có LT → không hỏi, LT ban đích giữ nguyên', async () => {
    pendingInvite('cho@bbe.vn', U.bnd)
    const res = await post('mem2', { departmentUnitId: U.bnd, makeLead: false })
    assert.equal(res.status, 200)
    assert.equal(res.body.isLead, false)
    assert.deepEqual(res.body.demotedLeadUserIds, [])
    assert.deepEqual(liveLeads(U.bnd), ['lt'])
    assert.deepEqual(liveOf('mem2'), [['DEPARTMENT_MEMBER', U.bnd]])
    assert.equal(statusOf('cho@bbe.vn'), 'PENDING')
    assert.equal(authVersion('lt'), 0)
  })

  it('makeLead dạng chuỗi/thiếu → coi như thành viên (hành vi cũ), không hỏi', async () => {
    const res = await post('mem2', { departmentUnitId: U.bnd })
    assert.equal(res.status, 200)
    assert.deepEqual(liveLeads(U.bnd), ['lt'])
  })

  it('bổ nhiệm vào ban trống LT, không lời mời chờ → không hỏi', async () => {
    const res = await post('noname', { departmentUnitId: U.btt, makeLead: true })
    assert.equal(res.status, 200)
    assert.deepEqual(liveLeads(U.btt), ['noname'])
  })

  it('Chủ tịch giữ nguyên hành vi: không hỏi, Chủ tịch cũ thành chưa phân Ban, LT các ban không đổi', async () => {
    const res = await post('moi', { departmentUnitId: U.ch, makeLead: false })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.equal(res.body.isLead, true)
    assert.deepEqual(liveOf('moi'), [['PRESIDENT', U.ch]])
    assert.deepEqual(liveOf('pres'), [])
    assert.deepEqual(liveLeads(U.bnd), ['lt'])
    assert.deepEqual(liveLeads(U.btv), ['lt2'])
  })

  it('đưa LT về Chưa phân Ban → ban trống LT, không hỏi', async () => {
    const res = await post('lt', { departmentUnitId: null, makeLead: false })
    assert.equal(res.status, 200)
    assert.deepEqual(liveLeads(U.bnd), [])
    assert.deepEqual(liveOf('lt'), [])
  })
})

describe('quyền như cũ', () => {
  it('chưa đăng nhập 401; quản lý một ban 403; Lead Chapter khác 403; không đổi gì', async () => {
    const before = structuredClone(db)
    assert.equal((await post('moi', { departmentUnitId: U.bnd, makeLead: true, confirmReplace: true }, 'nobody')).status, 401)
    assert.equal((await post('moi', { departmentUnitId: U.bnd, makeLead: true, confirmReplace: true }, 'deptManager')).status, 403)
    assert.equal((await post('moi', { departmentUnitId: U.bnd, makeLead: true, confirmReplace: true }, 'lead2')).status, 403)
    assert.deepEqual(db, before)
  })

  it('thành viên Chapter khác → 404; ban của Chapter khác → 400; Admin vẫn bổ nhiệm được (có hỏi xác nhận)', async () => {
    assert.equal((await post('other', { departmentUnitId: U.bnd, makeLead: true, confirmReplace: true })).status, 404)
    assert.equal((await post('moi', { departmentUnitId: U.bnd2, makeLead: true, confirmReplace: true })).status, 400)
    assert.deepEqual(liveLeads(U.bnd2), [])
    assert.equal((await post('moi', { departmentUnitId: U.bnd, makeLead: true }, 'admin')).status, 409)
    assert.equal((await post('moi', { departmentUnitId: U.bnd, makeLead: true, confirmReplace: true }, 'admin')).status, 200)
    assert.deepEqual(liveLeads(U.bnd), ['moi'])
  })
})

describe('câu cảnh báo (hàm thuần)', () => {
  const holder = { userId: 'lt', name: 'Trần Thị Cũ', email: 'lt@bbe.vn' }
  it('null khi ban trống LT và không lời mời chờ; null khi người giữ chính là người được bổ nhiệm', () => {
    assert.equal(departmentLeadAppointmentWarning({ unitName: 'Ban A', currentHolder: null, pendingInvitations: [] }, { userId: 'x', name: 'X' }), null)
    assert.equal(departmentLeadAppointmentWarning({ unitName: 'Ban A', currentHolder: holder, pendingInvitations: [] }, { userId: 'lt', name: 'Trần Thị Cũ' }), null)
  })
  it('không có tên ban → "Ban này"', () => {
    assert.match(departmentLeadAppointmentWarning({ unitName: '', currentHolder: holder, pendingInvitations: [] }, { userId: 'x', name: 'X' }), /^Ban này đang có Trưởng ban/)
  })
})

describe('client: hỏi xác nhận bằng câu của server', () => {
  const ok = { ok: true, status: 200, data: {} }
  const conflict = { ok: false, status: 409, error: { code: CONFIRM, message: 'Ban A đang có Trưởng ban B.' } }
  function sender(...responses: any[]) {
    const calls: any[] = []
    return { calls, send: async (extra?: any) => { calls.push(extra ?? {}); return responses[calls.length - 1] } }
  }

  it('thành công ngay → không hỏi', async () => {
    const s = sender(ok)
    let asked = 0
    assert.equal(await sendWithLeadReplaceConfirm(s.send, () => { asked++; return true }), ok)
    assert.equal(asked, 0)
    assert.deepEqual(s.calls, [{}])
  })

  it('409 LT + đồng ý → hỏi đúng câu server, gửi lại với confirmReplace: true', async () => {
    const s = sender(conflict, ok)
    const asked: string[] = []
    assert.equal(await sendWithLeadReplaceConfirm(s.send, (m: string) => { asked.push(m); return true }), ok)
    assert.equal(asked.length, 1)
    assert.ok(asked[0].startsWith('Ban A đang có Trưởng ban B.'), asked[0])
    assert.match(asked[0], /bổ nhiệm Trưởng ban mới\?$/)
    assert.deepEqual(s.calls, [{}, { confirmReplace: true }])
  })

  it('409 LT + hủy → trả null, không gửi lại (không đổi gì)', async () => {
    const s = sender(conflict, ok)
    assert.equal(await sendWithLeadReplaceConfirm(s.send, () => false), null)
    assert.deepEqual(s.calls, [{}])
  })

  it('lỗi khác (kể cả 409 khác mã) → trả nguyên lỗi, không hỏi', async () => {
    for (const error of [{ code: 'DnaMembershipConflict', message: 'x' }, { code: 'PresidentReplaceConfirmRequired', message: 'y' }, { code: 'AccessDenied', message: 'z' }]) {
      const res = { ok: false, status: 409, error }
      const s = sender(res)
      let asked = 0
      assert.equal(await sendWithLeadReplaceConfirm(s.send, () => { asked++; return true }), res)
      assert.equal(asked, 0, error.code)
    }
  })
})

describe('client: cập nhật lạc quan danh sách ban', () => {
  const ban = [
    { userId: 'lt', displayName: 'Trần Thị Cũ', isLead: true },
    { userId: 'an', displayName: 'An', isLead: false },
    { userId: 'moi', displayName: 'Lê Văn Mới', isLead: false },
  ]
  it('LT mới mang nhãn LT và đứng đầu; LT cũ vẫn ở trong ban với vai thành viên; số người không đổi', () => {
    const next = appointLeadInMembers(ban, 'moi')
    assert.equal(next.length, 3)
    assert.deepEqual(next.map((m: any) => [m.userId, m.isLead]), [['moi', true], ['an', false], ['lt', false]])
    assert.equal(ban[0].isLead, true, 'không sửa mảng gốc')
  })
  it('sắp xếp: LT trước, còn lại theo tên tiếng Việt', () => {
    assert.deepEqual(sortRosterMembers([{ userId: 'b', displayName: 'Bình' }, { userId: 'a', displayName: 'Ân' }, { userId: 'l', displayName: 'Zed', isLead: true }]).map((m: any) => m.userId), ['l', 'a', 'b'])
  })
  it('hasOtherLead: có LT khác người được chọn', () => {
    assert.equal(hasOtherLead(ban, 'moi'), true)
    assert.equal(hasOtherLead(ban, 'lt'), false)
    assert.equal(hasOtherLead([], 'moi'), false)
  })
})
