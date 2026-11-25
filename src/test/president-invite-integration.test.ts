/**
 * Tích hợp trên PostgreSQL thật (DB tạm bbe_test_*, đã seed): mời Chủ tịch/Trưởng ban → kích hoạt.
 * Không giả lập gì: quyền, trigger tổ chức, ràng buộc CHECK, thay Chủ tịch cũ đều chạy thật.
 * Chạy: TEST_DATABASE_URL=postgresql://...@127.0.0.1:<port>/bbe_test_<x> node scripts/test/run-tests.cjs integration president-invite
 */
import '../../scripts/test/require-test-database.cjs'
import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { prisma } from '../lib/prisma'
import { resolveMemberInviteScope } from '../lib/member-invite-scope'
import { checkPresidentInvite, getChapterPresidentSituation } from '../lib/president-invite'
import { sendMemberInvitation, acceptInvitation } from '../lib/invitations'

const key = randomUUID().slice(0, 8)
const email = (name: string) => `${name}-${key}@test.invalid`
const now = () => new Date()

async function leadContext(leadEmail: string) {
  const lead = await prisma.user.findUniqueOrThrow({ where: { email: leadEmail }, include: { chapter_lead_binding: true } })
  return { userId: lead.id, role: lead.role as 'LEAD', chapterId: lead.chapter_lead_binding!.chapter_id }
}
async function livePresidents(unitId: string) {
  return prisma.positionAssignment.findMany({
    where: { unit_id: unitId, position: { code: 'PRESIDENT' }, starts_at: { lte: now() }, OR: [{ ends_at: null }, { ends_at: { gt: now() } }] },
    include: { user: { select: { email: true } } },
  })
}
async function invite(ctx: any, body: Record<string, unknown>, to: string) {
  const scope = await resolveMemberInviteScope(ctx, body)
  assert.equal(scope.ok, true, JSON.stringify(scope))
  if (scope.ok !== true) throw new Error('scope')
  const result = await sendMemberInvitation({ email: to, role: 'MEMBER', organizationUnitId: scope.organizationUnitId, positionCode: scope.positionCode, invitedBy: ctx.userId, mail: { kind: 'link' }, canManagePending: async () => true })
  assert.equal(result.ok, true, JSON.stringify(result))
  return { scope, result: result as any }
}

after(async () => { await prisma.$disconnect() })

describe('mời Chủ tịch trên DB thật (Chi hội Hà Nội đã có Chủ tịch Nguyễn Phương Hoa)', () => {
  it('cảnh báo → gửi → lời mời mới thay lời mời cũ → kích hoạt → Chủ tịch cũ thôi chức, chỉ còn 1 Chủ tịch', async () => {
    const ctx = await leadContext('chapter.lead.demo@bbe.vn')
    const chapter = await prisma.chapter.findUniqueOrThrow({ where: { id: ctx.chapterId } })
    const unitId = chapter.organization_unit_id!
    const before = await livePresidents(unitId)
    assert.deepEqual(before.map((row) => row.user.email), ['phuong.hoa@bbe.vn'])

    // 1. Cảnh báo: chưa xác nhận thì bị chặn, câu cảnh báo nêu tên Chủ tịch hiện tại.
    const blocked = await checkPresidentInvite(unitId, email('ct1'), undefined)
    assert.equal(blocked.ok, false)
    if (blocked.ok === false) assert.match(blocked.error.message, /Nguyễn Phương Hoa/)
    assert.equal((await checkPresidentInvite(unitId, email('ct1'), true)).ok, true)

    // 2. Gửi lời mời Chủ tịch thứ nhất rồi thứ hai: lời mời thứ nhất bị hủy.
    const first = await invite(ctx, { position: 'PRESIDENT' }, email('ct1'))
    assert.equal(first.scope.ok && first.scope.organizationUnitId, unitId)
    const situation = await getChapterPresidentSituation(unitId, email('ct2'))
    assert.deepEqual(situation.pendingInvitations.map((row) => row.email), [email('ct1')])
    const second = await invite(ctx, { position: 'PRESIDENT' }, email('ct2'))
    const firstRow = await prisma.invitation.findUniqueOrThrow({ where: { id: first.result.invitationId } })
    assert.equal(firstRow.status, 'CANCELLED')
    const secondRow = await prisma.invitation.findUniqueOrThrow({ where: { id: second.result.invitationId } })
    assert.deepEqual([secondRow.position_code, secondRow.organization_unit_id, secondRow.status], ['PRESIDENT', unitId, 'PENDING'])

    // 3. Lời mời đã bị hủy không kích hoạt được.
    const stale = await acceptInvitation(first.result.token, 'Mat-khau-123', email('ct1'))
    assert.equal(stale.ok, false)

    // 4. Kích hoạt lời mời còn hiệu lực.
    const accepted = await acceptInvitation(second.result.token, 'Mat-khau-123', email('ct2'))
    assert.equal(accepted.ok, true, JSON.stringify(accepted))
    const after = await livePresidents(unitId)
    assert.deepEqual(after.map((row) => row.user.email), [email('ct2')], 'mỗi Chapter đúng 1 Chủ tịch')
    const newUser = await prisma.user.findUniqueOrThrow({ where: { email: email('ct2') }, include: { chapter_members: true } })
    assert.equal(newUser.role, 'MEMBER')
    assert.equal(newUser.chapter_members[0]?.chapter_id, chapter.id, 'Chủ tịch mới thuộc Chapter')

    // 5. Chủ tịch cũ: vẫn thuộc Chapter, không còn chức vụ nào (thành viên chưa phân Ban), lịch sử còn nguyên.
    const old = await prisma.user.findUniqueOrThrow({ where: { email: 'phuong.hoa@bbe.vn' }, include: { chapter_members: true } })
    assert.equal(old.chapter_members[0]?.chapter_id, chapter.id)
    const oldLive = await prisma.positionAssignment.count({ where: { user_id: old.id, OR: [{ ends_at: null }, { ends_at: { gt: now() } }] } })
    assert.equal(oldLive, 0)
    const oldHistory = await prisma.positionAssignment.count({ where: { user_id: old.id, position: { code: 'PRESIDENT' } } })
    assert.ok(oldHistory >= 1, 'không xóa lịch sử Chủ tịch cũ')
  })

  it('Chapter chưa có Chủ tịch (TP. Hồ Chí Minh): không cảnh báo, mời và kích hoạt thẳng', async () => {
    const ctx = await leadContext('quoc.bao@bbe.vn')
    const unitId = (await prisma.chapter.findUniqueOrThrow({ where: { id: ctx.chapterId } })).organization_unit_id!
    assert.equal((await livePresidents(unitId)).length, 0)
    assert.equal((await checkPresidentInvite(unitId, email('hcm'), undefined)).ok, true)
    const sent = await invite(ctx, { position: 'PRESIDENT' }, email('hcm'))
    assert.equal((await acceptInvitation(sent.result.token, 'Mat-khau-123', email('hcm'))).ok, true)
    assert.deepEqual((await livePresidents(unitId)).map((row) => row.user.email), [email('hcm')])
  })

  it('Lead của Chapter này không mời được Chủ tịch cho Chapter khác (luôn về Chapter của chính mình)', async () => {
    const ctx = await leadContext('mai.anh@bbe.vn')
    const own = (await prisma.chapter.findUniqueOrThrow({ where: { id: ctx.chapterId } })).organization_unit_id
    const hanoi = await leadContext('chapter.lead.demo@bbe.vn')
    const scope = await resolveMemberInviteScope(ctx, { position: 'PRESIDENT', chapterId: hanoi.chapterId })
    assert.equal(scope.ok && scope.organizationUnitId, own)
  })

  it('người không có quyền cấp Chapter (thành viên thường, LT Ban) không mời được Chủ tịch/Trưởng ban', async () => {
    for (const memberEmail of ['member.demo@bbe.vn', 'department.lead.demo@bbe.vn']) {
      const user = await prisma.user.findUniqueOrThrow({ where: { email: memberEmail }, include: { chapter_members: true } })
      const ctx = { userId: user.id, role: user.role as 'MEMBER', chapterId: user.chapter_members[0]?.chapter_id }
      const president = await resolveMemberInviteScope(ctx, { position: 'PRESIDENT' })
      assert.equal(president.ok, false, memberEmail)
      const dept = await prisma.organizationUnit.findFirstOrThrow({ where: { type: 'DEPARTMENT', parent: { chapter: { id: ctx.chapterId } } } })
      const lead = await resolveMemberInviteScope(ctx, { position: 'DEPARTMENT_LEAD', organizationUnitId: dept.id })
      assert.equal(lead.ok, false, memberEmail)
    }
  })
})

describe('gửi đồng thời và gửi lại trên DB thật (Chi hội Đà Nẵng)', () => {
  it('5 lượt mời Chủ tịch cùng lúc → chỉ còn đúng 1 lời mời Chủ tịch đang chờ', async () => {
    const ctx = await leadContext('mai.anh@bbe.vn')
    const unitId = (await prisma.chapter.findUniqueOrThrow({ where: { id: ctx.chapterId } })).organization_unit_id!
    await Promise.all([1, 2, 3, 4, 5].map((n) => invite(ctx, { position: 'PRESIDENT' }, email(`dongthoi${n}`))))
    const pending = await prisma.invitation.count({ where: { organization_unit_id: unitId, position_code: 'PRESIDENT', status: 'PENDING' } })
    assert.equal(pending, 1)
  })

  it('gửi lại lời mời đã bị hủy khi Chapter đã có Chủ tịch → bị chặn cho tới khi xác nhận', async () => {
    const { resendInvitation } = await import('../lib/invitations')
    const ctx = await leadContext('mai.anh@bbe.vn')
    const unitId = (await prisma.chapter.findUniqueOrThrow({ where: { id: ctx.chapterId } })).organization_unit_id!
    const a = await invite(ctx, { position: 'PRESIDENT' }, email('dn-a'))
    const b = await invite(ctx, { position: 'PRESIDENT' }, email('dn-b')) // hủy lời mời của A
    assert.equal((await acceptInvitation(b.result.token, 'Mat-khau-123', email('dn-b'))).ok, true)
    const blocked = await resendInvitation(a.result.invitationId, ctx.userId, 'LEAD', true)
    assert.equal(blocked.ok, false)
    if (blocked.ok === false) assert.equal(blocked.code, 'PresidentReplaceConfirmRequired')
    assert.equal((await prisma.invitation.findUniqueOrThrow({ where: { id: a.result.invitationId } })).status, 'CANCELLED')
    assert.deepEqual((await livePresidents(unitId)).map((row) => row.user.email), [email('dn-b')])
  })
})

describe('mời Trưởng ban trên DB thật', () => {
  it('kích hoạt → DEPARTMENT_LEAD đúng ban, thuộc Chapter', async () => {
    const ctx = await leadContext('chapter.lead.demo@bbe.vn')
    const dept = await prisma.organizationUnit.findFirstOrThrow({ where: { type: 'DEPARTMENT', status: 'ACTIVE', parent: { chapter: { id: ctx.chapterId } } }, orderBy: { name: 'asc' } })
    const sent = await invite(ctx, { position: 'DEPARTMENT_LEAD', organizationUnitId: dept.id }, email('tb'))
    const accepted = await acceptInvitation(sent.result.token, 'Mat-khau-123', email('tb'))
    assert.equal(accepted.ok, true, JSON.stringify(accepted))
    const rows = await prisma.positionAssignment.findMany({ where: { user: { email: email('tb') }, ends_at: null }, include: { position: true } })
    assert.deepEqual(rows.map((row) => [row.position.code, row.unit_id]), [['DEPARTMENT_LEAD', dept.id]])
  })

  it('thành viên thường (không có position_code) vẫn kích hoạt thành DEPARTMENT_MEMBER', async () => {
    const ctx = await leadContext('chapter.lead.demo@bbe.vn')
    const dept = await prisma.organizationUnit.findFirstOrThrow({ where: { type: 'DEPARTMENT', status: 'ACTIVE', parent: { chapter: { id: ctx.chapterId } } }, orderBy: { name: 'desc' } })
    const sent = await invite(ctx, { organizationUnitId: dept.id }, email('tv'))
    assert.equal((await prisma.invitation.findUniqueOrThrow({ where: { id: sent.result.invitationId } })).position_code, null)
    assert.equal((await acceptInvitation(sent.result.token, 'Mat-khau-123', email('tv'))).ok, true)
    const rows = await prisma.positionAssignment.findMany({ where: { user: { email: email('tv') }, ends_at: null }, include: { position: true } })
    assert.deepEqual(rows.map((row) => [row.position.code, row.unit_id]), [['DEPARTMENT_MEMBER', dept.id]])
  })
})

describe('ràng buộc CHECK của migration', () => {
  const base = async () => {
    const lead = await prisma.user.findUniqueOrThrow({ where: { email: 'chapter.lead.demo@bbe.vn' } })
    const unit = await prisma.organizationUnit.findFirstOrThrow({ where: { type: 'DEPARTMENT' } })
    return { email: email(`chk-${randomUUID().slice(0, 6)}`), invited_by: lead.id, token_hash: randomUUID(), expires_at: new Date(Date.now() + 3600_000), organization_unit_id: unit.id }
  }
  it('chặn mã chức vụ lạ và chức vụ trên lời mời không phải MEMBER', async () => {
    await assert.rejects(prisma.invitation.create({ data: { ...(await base()), role: 'MEMBER', position_code: 'CHAPTER_LEAD' } }), /invitations_position_code_check/)
    await assert.rejects(prisma.invitation.create({ data: { ...(await base()), role: 'DNA_LEAD', position_code: 'PRESIDENT' } }), /invitations_position_code_check/)
  })
  it('cho phép NULL / DEPARTMENT_LEAD / PRESIDENT trên lời mời MEMBER', async () => {
    for (const code of [null, 'DEPARTMENT_LEAD', 'PRESIDENT']) {
      const row = await prisma.invitation.create({ data: { ...(await base()), role: 'MEMBER', position_code: code, status: 'CANCELLED' } })
      assert.equal(row.position_code, code)
    }
  })
})
