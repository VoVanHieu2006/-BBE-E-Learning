/**
 * Tích hợp trên PostgreSQL thật (DB tạm bbe_test_*, đã seed): mời Trưởng ban (LT), mỗi ban tối đa 1 LT.
 * Không giả lập gì: khóa dòng, trigger tổ chức, thay LT cũ (xuống Thành viên cùng ban), hàng đợi đồng bộ lộ trình học đều chạy thật.
 * Chạy: TEST_DATABASE_URL=postgresql://...@127.0.0.1:<port>/bbe_test_<x> npm run test:integration -- department-lead-invite
 */
import '../../scripts/test/require-test-database.cjs'
import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { prisma } from '../lib/prisma'
import { resolveMemberInviteScope } from '../lib/member-invite-scope'
import { checkSingleHolderInvite } from '../lib/president-invite'
import { sendMemberInvitation, acceptInvitation, resendInvitation } from '../lib/invitations'
import { demoteOtherDepartmentLeads } from '../lib/position-replacement'

const key = randomUUID().slice(0, 8)
const email = (name: string) => `${name}-${key}@test.invalid`
const now = () => new Date()

async function leadContext(leadEmail: string) {
  const lead = await prisma.user.findUniqueOrThrow({ where: { email: leadEmail }, include: { chapter_lead_binding: true } })
  return { userId: lead.id, role: lead.role as 'LEAD', chapterId: lead.chapter_lead_binding!.chapter_id }
}
async function department(ctx: { chapterId: string }, name: string) {
  return prisma.organizationUnit.findFirstOrThrow({ where: { type: 'DEPARTMENT', status: 'ACTIVE', name, parent: { chapter: { id: ctx.chapterId } } } })
}
const live = () => ({ starts_at: { lte: now() }, OR: [{ ends_at: null }, { ends_at: { gt: now() } }] })
async function liveLeads(unitId: string) {
  const rows = await prisma.positionAssignment.findMany({ where: { unit_id: unitId, position: { code: 'DEPARTMENT_LEAD' }, ...live() }, include: { user: { select: { email: true } } } })
  return rows.map((row) => row.user.email).sort()
}
async function livePositions(userEmail: string) {
  const rows = await prisma.positionAssignment.findMany({ where: { user: { email: userEmail }, ...live() }, include: { position: true } })
  return rows.map((row) => [row.position.code, row.unit_id])
}
const pendingLeadInvites = (unitId: string) => prisma.invitation.count({ where: { organization_unit_id: unitId, position_code: 'DEPARTMENT_LEAD', status: 'PENDING' } })
async function invite(ctx: any, body: Record<string, unknown>, to: string) {
  const scope = await resolveMemberInviteScope(ctx, body)
  assert.equal(scope.ok, true, JSON.stringify(scope))
  if (scope.ok !== true) throw new Error('scope')
  const result = await sendMemberInvitation({ email: to, role: 'MEMBER', organizationUnitId: scope.organizationUnitId, positionCode: scope.positionCode, invitedBy: ctx.userId, mail: { kind: 'link' }, canManagePending: async () => true })
  assert.equal(result.ok, true, JSON.stringify(result))
  return result as any
}

after(async () => { await prisma.$disconnect() })

describe('quyền trên DB thật', () => {
  // Chạy trước mọi kịch bản khác: lúc này department.lead.demo vẫn đang là LT Ban Nội Dung.
  it('LT Ban (quản lý ban) và thành viên thường không mời được LT; Lead Chapter khác không mời LT vào ban của Chapter này', async () => {
    const hanoi = await leadContext('chapter.lead.demo@bbe.vn')
    const bnd = await department(hanoi, 'Ban Nội Dung')
    assert.deepEqual(await liveLeads(bnd.id), ['department.lead.demo@bbe.vn'], 'kiểm đúng tài khoản đang là LT')
    for (const memberEmail of ['member.demo@bbe.vn', 'department.lead.demo@bbe.vn']) {
      const user = await prisma.user.findUniqueOrThrow({ where: { email: memberEmail }, include: { chapter_members: true } })
      const ctx = { userId: user.id, role: user.role as 'MEMBER', chapterId: user.chapter_members[0]?.chapter_id }
      assert.equal((await resolveMemberInviteScope(ctx, { position: 'DEPARTMENT_LEAD', organizationUnitId: bnd.id })).ok, false, memberEmail)
    }
    const danang = await leadContext('mai.anh@bbe.vn')
    const other = await resolveMemberInviteScope(danang, { position: 'DEPARTMENT_LEAD', organizationUnitId: bnd.id })
    assert.equal(other.ok, false)
  })
})

describe('mời LT vào ban đã có LT (Chi hội Hà Nội, Ban Nội Dung có LT Ban Demo)', () => {
  it('cảnh báo → gửi → lời mời LT mới thay lời mời cũ → kích hoạt → LT cũ xuống Thành viên cùng ban, đúng 1 LT', async () => {
    const ctx = await leadContext('chapter.lead.demo@bbe.vn')
    const bnd = await department(ctx, 'Ban Nội Dung')
    assert.deepEqual(await liveLeads(bnd.id), ['department.lead.demo@bbe.vn'])
    const oldBefore = await prisma.user.findUniqueOrThrow({ where: { email: 'department.lead.demo@bbe.vn' } })

    // 1. Cảnh báo LT: chưa xác nhận thì chặn, câu cảnh báo nêu tên LT hiện tại và ban.
    const blocked = await checkSingleHolderInvite(bnd.id, 'DEPARTMENT_LEAD', email('lt1'), undefined)
    assert.equal(blocked.ok, false)
    if (blocked.ok === false) {
      assert.equal(blocked.error.code, 'DepartmentLeadReplaceConfirmRequired')
      assert.match(blocked.error.message, /LT Ban Demo/)
      assert.match(blocked.error.message, /xuống Thành viên Ban Nội Dung/)
    }
    assert.equal((await checkSingleHolderInvite(bnd.id, 'DEPARTMENT_LEAD', email('lt1'), true)).ok, true)

    // 2. Gửi 2 lời mời LT liên tiếp: lời mời đầu bị hủy, chỉ còn 1 lời mời LT chờ cho ban.
    const first = await invite(ctx, { position: 'DEPARTMENT_LEAD', organizationUnitId: bnd.id }, email('lt1'))
    const second = await invite(ctx, { position: 'DEPARTMENT_LEAD', organizationUnitId: bnd.id }, email('lt2'))
    assert.equal((await prisma.invitation.findUniqueOrThrow({ where: { id: first.invitationId } })).status, 'CANCELLED')
    assert.equal(await pendingLeadInvites(bnd.id), 1)
    assert.equal((await acceptInvitation(first.token, 'Mat-khau-123', email('lt1'))).ok, false, 'lời mời đã bị hủy không kích hoạt được')

    // 3. Kích hoạt: đúng 1 LT (người mới); LT cũ xuống Thành viên của chính Ban Nội Dung, lịch sử còn.
    const accepted = await acceptInvitation(second.token, 'Mat-khau-123', email('lt2'))
    assert.equal(accepted.ok, true, JSON.stringify(accepted))
    assert.deepEqual(await liveLeads(bnd.id), [email('lt2')])
    assert.deepEqual(await livePositions(email('lt2')), [['DEPARTMENT_LEAD', bnd.id]])
    assert.deepEqual(await livePositions('department.lead.demo@bbe.vn'), [['DEPARTMENT_MEMBER', bnd.id]])
    const history = await prisma.positionAssignment.count({ where: { user_id: oldBefore.id, unit_id: bnd.id, position: { code: 'DEPARTMENT_LEAD' } } })
    assert.ok(history >= 1, 'không xóa lịch sử LT cũ')
    const oldAfter = await prisma.user.findUniqueOrThrow({ where: { id: oldBefore.id }, include: { chapter_members: true } })
    assert.ok(oldAfter.auth_version > oldBefore.auth_version, 'phiên LT cũ được làm mới quyền')
    assert.equal(oldAfter.status, 'ACTIVE')
    assert.equal(oldAfter.chapter_members[0]?.chapter_id, ctx.chapterId, 'LT cũ vẫn thuộc Chapter')
    const outbox = await prisma.learningOutbox.count({ where: { user_id: oldBefore.id, kind: 'RECONCILE_ASSIGNMENTS', event_key: { startsWith: `department-lead-replaced:${bnd.id}:${oldBefore.id}:` } } })
    assert.equal(outbox, 1, 'lộ trình học LT cũ được xếp hàng đồng bộ lại')
    const membership = await prisma.organizationMembership.count({ where: { user_id: oldBefore.id, unit_id: bnd.id, status: 'ACTIVE', OR: [{ ends_at: null }, { ends_at: { gt: now() } }] } })
    assert.equal(membership, 1, 'LT cũ vẫn là thành viên đang hoạt động của ban')
  })

  it('LT mới vào ban trống (Ban Thành Viên): không cảnh báo, không đụng LT ban khác', async () => {
    const ctx = await leadContext('chapter.lead.demo@bbe.vn')
    const btv = await department(ctx, 'Ban Thành Viên')
    const bnd = await department(ctx, 'Ban Nội Dung')
    const bndBefore = await liveLeads(bnd.id)
    assert.deepEqual(await liveLeads(btv.id), [])
    assert.equal((await checkSingleHolderInvite(btv.id, 'DEPARTMENT_LEAD', email('btv'), undefined)).ok, true)
    const sent = await invite(ctx, { position: 'DEPARTMENT_LEAD', organizationUnitId: btv.id }, email('btv'))
    assert.equal((await acceptInvitation(sent.token, 'Mat-khau-123', email('btv'))).ok, true)
    assert.deepEqual(await liveLeads(btv.id), [email('btv')])
    assert.deepEqual(await liveLeads(bnd.id), bndBefore)
  })

  it('gửi lại lời mời LT đã hủy khi ban đã có LT → bị chặn tới khi xác nhận; xác nhận → lời mời LT khác của ban bị hủy', async () => {
    const ctx = await leadContext('chapter.lead.demo@bbe.vn')
    const btk = await department(ctx, 'Ban Thư Ký')
    const a = await invite(ctx, { position: 'DEPARTMENT_LEAD', organizationUnitId: btk.id }, email('btk-a'))
    const b = await invite(ctx, { position: 'DEPARTMENT_LEAD', organizationUnitId: btk.id }, email('btk-b')) // hủy lời mời của A
    assert.equal((await acceptInvitation(b.token, 'Mat-khau-123', email('btk-b'))).ok, true)
    const blocked = await resendInvitation(a.invitationId, ctx.userId, 'LEAD', true)
    assert.equal(blocked.ok, false)
    if (blocked.ok === false) assert.equal(blocked.code, 'DepartmentLeadReplaceConfirmRequired')
    assert.equal((await resendInvitation(a.invitationId, ctx.userId, 'LEAD', true, { confirmReplacePresident: true })).ok, false, 'tên cũ chỉ cho Chủ tịch')
    assert.equal((await prisma.invitation.findUniqueOrThrow({ where: { id: a.invitationId } })).status, 'CANCELLED')
    const c = await invite(ctx, { position: 'DEPARTMENT_LEAD', organizationUnitId: btk.id }, email('btk-c'))
    const renewed = await resendInvitation(a.invitationId, ctx.userId, 'LEAD', true, { confirmReplace: true })
    assert.equal(renewed.ok, true, JSON.stringify(renewed))
    assert.equal((await prisma.invitation.findUniqueOrThrow({ where: { id: c.invitationId } })).status, 'CANCELLED')
    assert.equal(await pendingLeadInvites(btk.id), 1)
    assert.deepEqual(await liveLeads(btk.id), [email('btk-b')], 'chưa kích hoạt thì LT hiện tại giữ nguyên')
  })
})

describe('đồng thời trên DB thật (Chi hội Đà Nẵng)', () => {
  it('5 lượt mời LT cùng lúc vào một ban → đúng 1 lời mời LT chờ; ban khác cùng lúc vẫn có lời mời riêng', async () => {
    const ctx = await leadContext('mai.anh@bbe.vn')
    const [d1, d2] = await prisma.organizationUnit.findMany({ where: { type: 'DEPARTMENT', status: 'ACTIVE', parent: { chapter: { id: ctx.chapterId } } }, orderBy: { name: 'asc' }, take: 2 })
    await Promise.all([
      ...[1, 2, 3, 4, 5].map((n) => invite(ctx, { position: 'DEPARTMENT_LEAD', organizationUnitId: d1.id }, email(`dt${n}`))),
      invite(ctx, { position: 'DEPARTMENT_LEAD', organizationUnitId: d2.id }, email('dt-other')),
    ])
    assert.equal(await pendingLeadInvites(d1.id), 1)
    assert.equal(await pendingLeadInvites(d2.id), 1)
  })

  it('kích hoạt LT và gửi lời mời LT mới cùng lúc (nhiều vòng) → không khóa chéo, luôn ≤ 1 lời mời chờ và đúng 1 LT', async () => {
    const ctx = await leadContext('mai.anh@bbe.vn')
    const dept = (await prisma.organizationUnit.findMany({ where: { type: 'DEPARTMENT', status: 'ACTIVE', parent: { chapter: { id: ctx.chapterId } } }, orderBy: { name: 'asc' } }))[2]
    for (let round = 0; round < 4; round++) {
      const a = await invite(ctx, { position: 'DEPARTMENT_LEAD', organizationUnitId: dept.id }, email(`race-a${round}`))
      const [accepted] = await Promise.all([
        acceptInvitation(a.token, 'Mat-khau-123', email(`race-a${round}`)),
        invite(ctx, { position: 'DEPARTMENT_LEAD', organizationUnitId: dept.id }, email(`race-b${round}`)),
      ])
      const pending = await pendingLeadInvites(dept.id)
      assert.ok(pending <= 1, `vòng ${round}: ${pending} lời mời chờ`)
      // Gửi trước → lời mời A bị hủy, kích hoạt thất bại; kích hoạt trước → A thành LT. Không có trường hợp lỗi khác.
      if (!accepted.ok) assert.ok(['InvitationNoLongerValid', 'InvalidState', 'TokenInvalid', 'InvitationNotFound'].includes((accepted as any).code) || /hiệu lực|hủy/.test((accepted as any).message || ''), JSON.stringify(accepted))
      const leads = await liveLeads(dept.id)
      assert.ok(leads.length <= 1, `vòng ${round}: ${leads.join(', ')}`)
      // Dọn lời mời B cho vòng sau (không để lời mời B làm lời mời A vòng sau bị hủy ngay).
      await prisma.invitation.updateMany({ where: { organization_unit_id: dept.id, position_code: 'DEPARTMENT_LEAD', status: 'PENDING' }, data: { status: 'CANCELLED', cancelled_at: now() } })
    }
  })

  it('hai lượt hạ LT đồng thời trên cùng ban (gọi thẳng demoteOtherDepartmentLeads) → không lỗi, ban không còn LT nào khác ngoài người giữ lại', async () => {
    const ctx = await leadContext('mai.anh@bbe.vn')
    const dept = (await prisma.organizationUnit.findMany({ where: { type: 'DEPARTMENT', status: 'ACTIVE', parent: { chapter: { id: ctx.chapterId } } }, orderBy: { name: 'asc' } }))[3]
    const sent = await invite(ctx, { position: 'DEPARTMENT_LEAD', organizationUnitId: dept.id }, email('demote'))
    assert.equal((await acceptInvitation(sent.token, 'Mat-khau-123', email('demote'))).ok, true)
    const keep = await prisma.user.findUniqueOrThrow({ where: { email: 'member.demo@bbe.vn' } })
    const results = await Promise.all([1, 2].map(() => prisma.$transaction((tx) => demoteOtherDepartmentLeads(tx, dept.id, keep.id, ctx.userId))))
    assert.deepEqual(results.flat().length, 1, 'chỉ một lượt thực sự hạ LT, lượt sau thấy ban đã trống')
    assert.deepEqual(await liveLeads(dept.id), [])
    assert.deepEqual(await livePositions(email('demote')), [['DEPARTMENT_MEMBER', dept.id]])
  })
})
