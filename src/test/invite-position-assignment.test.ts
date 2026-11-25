/**
 * assignInvitedPosition (bước gán chức vụ khi kích hoạt lời mời) chạy thật replaceUserPosition:
 * Chủ tịch mới thay Chủ tịch cũ (cũ kết thúc chức vụ, thành thành viên chưa phân Ban), mỗi Chapter chỉ 1 Chủ tịch.
 */
import { it, describe } from 'node:test'
import assert from 'node:assert/strict'

const now = new Date('2026-11-25T03:00:00Z')
const stub = (name: string, exports: unknown) => { const filename = require.resolve(name); require.cache[filename] = { id: filename, filename, loaded: true, exports } as NodeJS.Module }
const synced: string[] = []
stub('../lib/learning-periods', { lockLearningUser: async () => now, enqueueAssignmentSync: async (_tx: unknown, userId: string) => { synced.push(userId) } })
stub('../lib/organization-transition', { prepareOrganizationTransition: async () => now })
const { assignInvitedPosition } = require('../lib/position-replacement')

type Row = Record<string, any>
function fixture(opts: { incumbent?: boolean } = {}) {
  const units: Row[] = [
    { id: 'CH', type: 'CHAPTER', status: 'ACTIVE', parent_id: null },
    { id: 'BND', type: 'DEPARTMENT', status: 'ACTIVE', parent_id: 'CH' },
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
  const live = (row: Row) => row.ends_at === null || row.ends_at > now
  const tx: any = {
    $queryRaw: async () => [],
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
  return { tx, assignments, memberships, users, codeOf, livePresidents }
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
