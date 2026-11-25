/**
 * assignInvitedPosition (bước gán chức vụ khi kích hoạt lời mời) chạy thật replaceUserPosition:
 * Chủ tịch mới thay Chủ tịch cũ (cũ kết thúc chức vụ, thành thành viên chưa phân Ban), mỗi Chapter chỉ 1 Chủ tịch.
 * Trưởng ban mới thay Trưởng ban cũ của cùng ban (cũ xuống Thành viên của chính ban đó), mỗi ban chỉ 1 Trưởng ban.
 */
import { it, describe } from 'node:test'
import assert from 'node:assert/strict'

const now = new Date('2026-11-25T03:00:00Z')
const stub = (name: string, exports: unknown) => { const filename = require.resolve(name); require.cache[filename] = { id: filename, filename, loaded: true, exports } as NodeJS.Module }
const synced: string[] = []
/** Thứ tự khóa: 'chapter' (khóa dòng Chapter) và 'user:<id>' (khóa người dùng). */
const lockOrder: string[] = []
stub('../lib/learning-periods', { lockLearningUser: async (_tx: unknown, userId: string) => { lockOrder.push(`user:${userId}`); return now }, enqueueAssignmentSync: async (_tx: unknown, userId: string) => { synced.push(userId) } })
stub('../lib/organization-transition', { prepareOrganizationTransition: async () => now })
const { assignInvitedPosition, demoteOtherDepartmentLeads } = require('../lib/position-replacement')

type Row = Record<string, any>
function fixture(opts: { incumbent?: boolean; deptLeads?: Array<[user: string, unit: string]> } = {}) {
  const units: Row[] = [
    { id: 'CH', type: 'CHAPTER', status: 'ACTIVE', parent_id: null },
    { id: 'BND', type: 'DEPARTMENT', status: 'ACTIVE', parent_id: 'CH' },
    { id: 'BTV', type: 'DEPARTMENT', status: 'ACTIVE', parent_id: 'CH' },
    { id: 'TT', type: 'DNA_GROUP', status: 'ACTIVE', parent_id: null },
  ]
  const positions: Row[] = []
  const assignments: Row[] = []
  const memberships: Row[] = [{ id: 'm-new', user_id: 'new', unit_id: 'CH', starts_at: now, ends_at: null, status: 'ACTIVE' }]
  if (opts.incumbent) {
    positions.push({ id: 'p-president', code: 'PRESIDENT', scope: 'CHAPTER' })
    assignments.push({ id: 'a-old', user_id: 'old', unit_id: 'CH', position_id: 'p-president', starts_at: new Date('2026-01-01'), ends_at: null })
  }
  const users: Record<string, Row> = { new: { role: 'MEMBER', auth_version: 0 }, old: { role: 'MEMBER', auth_version: 0 } }
  for (const [user, unit] of opts.deptLeads || []) {
    if (!positions.some((p) => p.code === 'DEPARTMENT_LEAD')) positions.push({ id: 'p-lead', code: 'DEPARTMENT_LEAD', scope: 'DEPARTMENT' })
    assignments.push({ id: `a-lead-${user}`, user_id: user, unit_id: unit, position_id: 'p-lead', starts_at: new Date('2026-02-01'), ends_at: null })
    memberships.push({ id: `m-${user}`, user_id: user, unit_id: unit, starts_at: new Date('2026-02-01'), ends_at: null, status: 'ACTIVE' })
    users[user] ??= { role: 'MEMBER', auth_version: 0 }
  }
  const live = (row: Row) => row.ends_at === null || row.ends_at > now
  const tx: any = {
    $queryRaw: async (sql: TemplateStringsArray) => { if (sql.join('?').includes('FROM chapters')) lockOrder.push('chapter'); return [] },
    organizationUnit: {
      findUniqueOrThrow: async ({ where }: any) => units.find((u) => u.id === where.id)!,
      findUnique: async ({ where }: any) => units.find((u) => u.id === where.id) ?? null,
    },
    position: {
      upsert: async ({ where, create }: any) => positions.find((p) => p.code === where.code) ?? (positions.push({ id: `p-${create.code}`, ...create }), positions.at(-1)),
      findUniqueOrThrow: async ({ where }: any) => positions.find((p) => p.id === where.id)!,
    },
    user: {
      findUniqueOrThrow: async ({ where }: any) => users[where.id],
      update: async ({ where }: any) => { users[where.id].auth_version++ },
    },
    positionAssignment: {
      findMany: async ({ where }: any) => assignments.filter((a) => {
        if (where.unit_id && a.unit_id !== where.unit_id) return false
        if (where.user_id?.not && a.user_id === where.user_id.not) return false
        if (typeof where.user_id === 'string' && a.user_id !== where.user_id) return false
        if (where.position?.code && positions.find((p) => p.id === a.position_id)?.code !== where.position.code) return false
        return live(a)
      }),
      update: async ({ where, data }: any) => Object.assign(assignments.find((a) => a.id === where.id)!, data),
      create: async ({ data }: any) => { const row = { id: `a-${assignments.length}`, ...data }; assignments.push(row); return row },
    },
    organizationMembership: {
      findMany: async ({ where }: any) => memberships.filter((m) => m.user_id === where.user_id && m.status === 'ACTIVE' && live(m)),
      update: async ({ where, data }: any) => Object.assign(memberships.find((m) => m.id === where.id)!, data),
      create: async ({ data }: any) => { memberships.push({ id: `m-${memberships.length}`, status: 'ACTIVE', ...data }) },
    },
    chapterLeadBinding: { findUnique: async () => null },
    chapter: { findUnique: async () => ({ id: 'C1' }) },
  }
  const codeOf = (a: Row) => positions.find((p) => p.id === a.position_id)?.code
  const livePresidents = () => assignments.filter((a) => codeOf(a) === 'PRESIDENT' && a.unit_id === 'CH' && live(a))
  const liveOf = (user: string) => assignments.filter((a) => a.user_id === user && live(a)).map((a) => [codeOf(a), a.unit_id])
  const liveLeads = (unit: string) => assignments.filter((a) => codeOf(a) === 'DEPARTMENT_LEAD' && a.unit_id === unit && live(a)).map((a) => a.user_id)
  return { tx, assignments, memberships, users, codeOf, livePresidents, liveOf, liveLeads }
}

describe('assignInvitedPosition', () => {
  it('Chủ tịch, Chapter trống → người mới là Chủ tịch tại đơn vị Chapter', async () => {
    const f = fixture()
    await assignInvitedPosition(f.tx, 'new', 'CH', 'PRESIDENT', 'lead')
    const presidents = f.livePresidents()
    assert.equal(presidents.length, 1)
    assert.equal(presidents[0].user_id, 'new')
    assert.equal(presidents[0].appointed_by, 'lead')
  })

  it('Chủ tịch, Chapter đã có Chủ tịch → Chủ tịch cũ kết thúc chức vụ ngay lúc kích hoạt, vẫn chỉ 1 Chủ tịch', async () => {
    synced.length = 0
    const f = fixture({ incumbent: true })
    await assignInvitedPosition(f.tx, 'new', 'CH', 'PRESIDENT', 'lead')
    const presidents = f.livePresidents()
    assert.equal(presidents.length, 1)
    assert.equal(presidents[0].user_id, 'new')
    const old = f.assignments.find((a) => a.id === 'a-old')!
    assert.equal(old.ends_at, now, 'lịch sử Chủ tịch cũ được giữ, chỉ đóng ngày kết thúc')
    assert.equal(f.users.old.auth_version, 1, 'phiên của Chủ tịch cũ phải làm mới quyền')
    assert.ok(synced.includes('old'), 'lộ trình học của Chủ tịch cũ được đồng bộ lại')
    assert.equal(f.assignments.filter((a) => a.user_id === 'old' && (a.ends_at === null || a.ends_at > now)).length, 0, 'Chủ tịch cũ không còn chức vụ nào = thành viên chưa phân Ban')
  })

  it('Trưởng ban → DEPARTMENT_LEAD tại ban', async () => {
    const f = fixture()
    await assignInvitedPosition(f.tx, 'new', 'BND', 'DEPARTMENT_LEAD', 'lead')
    const mine = f.assignments.filter((a) => a.user_id === 'new')
    assert.deepEqual(mine.map((a) => [f.codeOf(a), a.unit_id]), [['DEPARTMENT_LEAD', 'BND']])
  })

  it('không có chức vụ → thành viên ban (hành vi cũ)', async () => {
    const f = fixture()
    await assignInvitedPosition(f.tx, 'new', 'BND', null, 'lead')
    assert.deepEqual(f.assignments.map((a) => [f.codeOf(a), a.unit_id]), [['DEPARTMENT_MEMBER', 'BND']])
  })

  it('đơn vị không khớp chức vụ hoặc mã lạ → từ chối, không gán gì', async () => {
    for (const [unit, code, error] of [['BND', 'PRESIDENT', 'PositionScopeMismatch'], ['CH', 'DEPARTMENT_LEAD', 'PositionScopeMismatch'], ['TT', 'DEPARTMENT_LEAD', 'PositionScopeMismatch'], ['BND', 'CHAPTER_LEAD', 'PositionRoleMismatch']] as const) {
      const f = fixture({ incumbent: true })
      await assert.rejects(assignInvitedPosition(f.tx, 'new', unit, code, 'lead'), { code: error }, `${unit}/${code}`)
      assert.equal(f.assignments.length, 1, `${unit}/${code}: không đụng tới Chủ tịch hiện tại`)
      assert.equal(f.assignments[0].ends_at, null)
    }
  })
})

describe('Trưởng ban: mỗi ban tối đa 1 LT (demoteOtherDepartmentLeads)', () => {
  it('ban đã có LT → LT mới tại nhiệm, LT cũ xuống Thành viên CÙNG ban; lịch sử LT cũ còn, phiên làm mới, lộ trình đồng bộ', async () => {
    synced.length = 0
    const f = fixture({ deptLeads: [['old', 'BND']] })
    await assignInvitedPosition(f.tx, 'new', 'BND', 'DEPARTMENT_LEAD', 'lead')
    assert.deepEqual(f.liveLeads('BND'), ['new'], 'đúng 1 Trưởng ban')
    assert.deepEqual(f.liveOf('old'), [['DEPARTMENT_MEMBER', 'BND']], 'LT cũ là Thành viên của chính ban đó')
    const history = f.assignments.find((a) => a.id === 'a-lead-old')!
    assert.equal(history.ends_at, now, 'lịch sử LT cũ giữ nguyên, chỉ đóng ngày kết thúc')
    assert.equal(f.users.old.auth_version, 1, 'phiên LT cũ được làm mới quyền')
    assert.ok(synced.includes('old'), 'lộ trình học LT cũ đồng bộ lại')
    const member = f.assignments.find((a) => a.user_id === 'old' && f.codeOf(a) === 'DEPARTMENT_MEMBER')!
    assert.equal(member.appointed_by, 'lead')
    assert.ok(f.memberships.some((m) => m.user_id === 'old' && m.unit_id === 'BND' && m.status === 'ACTIVE'), 'LT cũ vẫn thuộc ban')
  })

  it('ban trống LT → không hạ ai, không đồng bộ ai khác; LT ban khác giữ nguyên', async () => {
    synced.length = 0
    const f = fixture({ deptLeads: [['old', 'BTV']] })
    await assignInvitedPosition(f.tx, 'new', 'BND', 'DEPARTMENT_LEAD', 'lead')
    assert.deepEqual(f.liveLeads('BND'), ['new'])
    assert.deepEqual(f.liveLeads('BTV'), ['old'], 'LT của ban khác giữ nguyên')
    assert.equal(f.users.old.auth_version, 0)
    assert.deepEqual(synced, [])
  })

  it('dữ liệu cũ có 2 LT trong ban → cả 2 xuống thành viên, còn đúng LT mới', async () => {
    const f = fixture({ deptLeads: [['old', 'BND'], ['old2', 'BND']] })
    await assignInvitedPosition(f.tx, 'new', 'BND', 'DEPARTMENT_LEAD', 'lead')
    assert.deepEqual(f.liveLeads('BND'), ['new'])
    assert.deepEqual(f.liveOf('old'), [['DEPARTMENT_MEMBER', 'BND']])
    assert.deepEqual(f.liveOf('old2'), [['DEPARTMENT_MEMBER', 'BND']])
  })

  it('khóa Chapter trước mọi người dùng (cùng thứ tự với nhánh Chủ tịch)', async () => {
    lockOrder.length = 0
    const f = fixture({ deptLeads: [['old', 'BND']] })
    await assignInvitedPosition(f.tx, 'new', 'BND', 'DEPARTMENT_LEAD', 'lead')
    assert.equal(lockOrder[0], 'chapter', lockOrder.join(' → '))
    assert.ok(lockOrder.includes('user:old') && lockOrder.includes('user:new'))
    lockOrder.length = 0
    await assignInvitedPosition(fixture({ incumbent: true }).tx, 'new', 'CH', 'PRESIDENT', 'lead')
    assert.equal(lockOrder[0], 'chapter', 'Chủ tịch: ' + lockOrder.join(' → '))
  })

  it('giữ lại người được bổ nhiệm (bổ nhiệm lại chính LT hiện tại → không hạ chính họ)', async () => {
    const f = fixture({ deptLeads: [['old', 'BND']] })
    assert.deepEqual(await demoteOtherDepartmentLeads(f.tx, 'BND', 'old', 'lead'), [])
    assert.deepEqual(f.liveLeads('BND'), ['old'])
    assert.equal(f.users.old.auth_version, 0)
  })

  it('trả danh sách người bị hạ; đơn vị không phải ban → từ chối', async () => {
    const f = fixture({ deptLeads: [['old', 'BND']] })
    assert.deepEqual(await demoteOtherDepartmentLeads(f.tx, 'BND', 'new', 'lead'), ['old'])
    await assert.rejects(demoteOtherDepartmentLeads(fixture().tx, 'CH', 'new'), { code: 'PositionScopeMismatch' })
    await assert.rejects(demoteOtherDepartmentLeads(fixture().tx, 'TT', 'new'), { code: 'PositionScopeMismatch' })
  })

  it('mời thành viên thường vào ban có LT → LT giữ nguyên', async () => {
    const f = fixture({ deptLeads: [['old', 'BND']] })
    await assignInvitedPosition(f.tx, 'new', 'BND', null, 'lead')
    assert.deepEqual(f.liveLeads('BND'), ['old'])
    assert.deepEqual(f.liveOf('new'), [['DEPARTMENT_MEMBER', 'BND']])
  })

  it('Chủ tịch mới không đụng LT của các ban', async () => {
    const f = fixture({ incumbent: true, deptLeads: [['lt', 'BND']] })
    await assignInvitedPosition(f.tx, 'new', 'CH', 'PRESIDENT', 'lead')
    assert.deepEqual(f.liveLeads('BND'), ['lt'])
  })

  it('người được mời không giữ được chức vụ (vai trò LEAD) → lỗi; caller rollback cả transaction', async () => {
    const f = fixture({ deptLeads: [['old', 'BND']] })
    f.users.new.role = 'LEAD'
    await assert.rejects(assignInvitedPosition(f.tx, 'new', 'BND', 'DEPARTMENT_LEAD', 'lead'), { code: 'PositionRoleMismatch' })
  })
})
