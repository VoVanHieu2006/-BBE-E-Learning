/**
 * Tích hợp trên PostgreSQL thật (DB tạm bbe_test_*, đã seed): bổ nhiệm Trưởng ban (LT) tức thì trong tab Chuyển giao
 * nhiệm kỳ (updateChapterDepartment), mỗi ban tối đa 1 LT. Không giả lập gì: khóa dòng, trigger tổ chức,
 * hạ LT cũ (xuống Thành viên cùng ban), hủy lời mời LT chờ, hàng đợi đồng bộ lộ trình học đều chạy thật.
 * Chạy: TEST_DATABASE_URL=postgresql://...@127.0.0.1:<port>/bbe_test_<x> node scripts/test/run-tests.cjs integration department-lead-appointment-integration
 */
import '../../scripts/test/require-test-database.cjs'
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { prisma } from '../lib/prisma'
import { updateChapterDepartment } from '../lib/chapter-department-update'

const key = randomUUID().slice(0, 8)
const email = (name: string) => `appoint-${name}-${key}@test.invalid`
const now = () => new Date()
const live = () => ({ starts_at: { lte: now() }, OR: [{ ends_at: null }, { ends_at: { gt: now() } }] })
const CONFIRM = 'DepartmentLeadReplaceConfirmRequired'

let chapterId = ''
let actorId = ''
const dept: Record<string, string> = {}

async function liveLeads(unitId: string) {
  const rows = await prisma.positionAssignment.findMany({ where: { unit_id: unitId, position: { code: 'DEPARTMENT_LEAD' }, ...live() }, include: { user: { select: { email: true } } } })
  return rows.map((row) => row.user.email).sort()
}
async function livePositions(userEmail: string) {
  const rows = await prisma.positionAssignment.findMany({ where: { user: { email: userEmail }, ...live() }, include: { position: true } })
  return rows.map((row) => [row.position.code, row.unit_id])
}
const userId = async (userEmail: string) => (await prisma.user.findUniqueOrThrow({ where: { email: userEmail } })).id
/** Thành viên mới của Chapter Hà Nội (seed), đặt vào một ban làm thành viên thường. */
async function newMember(name: string, unitId: string) {
  const user = await prisma.user.create({ data: { email: email(name), display_name: `Người ${name} ${key}`, password_hash: 'test-only', role: 'MEMBER', status: 'ACTIVE' } })
  await prisma.chapterMember.create({ data: { chapter_id: chapterId, user_id: user.id } })
  await updateChapterDepartment({ chapterId, userId: user.id, departmentUnitId: unitId, makeLead: false, actorId })
  return user
}
const appoint = (uid: string, unitId: string, confirmReplace?: boolean) => updateChapterDepartment({ chapterId, userId: uid, departmentUnitId: unitId, makeLead: true, actorId, confirmReplace })

before(async () => {
  const lead = await prisma.user.findUniqueOrThrow({ where: { email: 'chapter.lead.demo@bbe.vn' }, include: { chapter_lead_binding: true } })
  actorId = lead.id
  chapterId = lead.chapter_lead_binding!.chapter_id
  const chapter = await prisma.chapter.findUniqueOrThrow({ where: { id: chapterId } })
  const rows = await prisma.organizationUnit.findMany({ where: { parent_id: chapter.organization_unit_id!, type: 'DEPARTMENT', status: 'ACTIVE' } })
  for (const row of rows) dept[row.name] = row.id
  assert.ok(dept['Ban Nội Dung'] && dept['Ban Thành Viên'] && dept['Ban TT&SK'], Object.keys(dept).join(', '))
})
after(async () => { await prisma.$disconnect() })

describe('bổ nhiệm LT vào ban đã có LT (Chi hội Hà Nội, Ban Nội Dung có LT Ban Demo)', () => {
  it('chưa xác nhận → 409 + câu cảnh báo, DB không đổi; xác nhận → đúng 1 LT, LT cũ là Thành viên cùng ban, lịch sử còn', async () => {
    const bnd = dept['Ban Nội Dung']
    assert.deepEqual(await liveLeads(bnd), ['department.lead.demo@bbe.vn'])
    const fresh = await newMember('moi', dept['Ban Thành Viên'])
    const oldId = await userId('department.lead.demo@bbe.vn')
    const oldBefore = await prisma.user.findUniqueOrThrow({ where: { id: oldId } })
    const outboxBefore = await prisma.learningOutbox.count({ where: { user_id: oldId } })

    await assert.rejects(appoint(fresh.id, bnd), (error: any) => {
      assert.equal(error.code, CONFIRM)
      assert.match(error.message, /Ban Nội Dung đang có Trưởng ban LT Ban Demo \(department\.lead\.demo@bbe\.vn\)/)
      assert.match(error.message, /LT Ban Demo sẽ xuống Thành viên Ban Nội Dung/)
      return true
    })
    assert.deepEqual(await liveLeads(bnd), ['department.lead.demo@bbe.vn'], 'rollback: LT cũ còn nguyên')
    assert.deepEqual(await livePositions(fresh.email), [['DEPARTMENT_MEMBER', dept['Ban Thành Viên']]], 'rollback: người mới vẫn ở ban cũ')
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: oldId } })).auth_version, oldBefore.auth_version)

    const result = await appoint(fresh.id, bnd, true)
    assert.deepEqual(result.demotedLeadUserIds, [oldId])
    assert.deepEqual(await liveLeads(bnd), [fresh.email], 'đúng 1 LT')
    assert.deepEqual(await livePositions('department.lead.demo@bbe.vn'), [['DEPARTMENT_MEMBER', bnd]], 'LT cũ là DEPARTMENT_MEMBER cùng ban')
    const history = await prisma.positionAssignment.findMany({ where: { user_id: oldId, unit_id: bnd, position: { code: 'DEPARTMENT_LEAD' } } })
    assert.ok(history.length >= 1 && history.every((row) => row.ends_at !== null), 'lịch sử LT cũ còn, đã đóng')
    assert.ok(await prisma.organizationMembership.findFirst({ where: { user_id: oldId, unit_id: bnd, status: 'ACTIVE', ends_at: null } }), 'LT cũ vẫn thuộc ban')
    assert.ok((await prisma.user.findUniqueOrThrow({ where: { id: oldId } })).auth_version > oldBefore.auth_version, 'phiên LT cũ được làm mới')
    assert.ok(await prisma.learningOutbox.count({ where: { user_id: oldId } }) > outboxBefore, 'lộ trình LT cũ được đưa vào hàng đợi đồng bộ')
    const audit = await prisma.auditLog.findFirst({ where: { action: 'UPDATE_CHAPTER_DEPARTMENT', entity_id: fresh.id }, orderBy: { created_at: 'desc' } })
    assert.deepEqual((audit!.metadata as any).demotedLeadUserIds, [oldId])
  })

  it('bổ nhiệm lại chính LT hiện tại → không hỏi, không hạ ai', async () => {
    const bnd = dept['Ban Nội Dung']
    const [current] = await liveLeads(bnd)
    const result = await appoint(await userId(current), bnd)
    assert.deepEqual(result.demotedLeadUserIds, [])
    assert.deepEqual(await liveLeads(bnd), [current])
  })

  it('chuyển LT sang ban trống LT → không hỏi; ban cũ trống LT; đổi ban không bổ nhiệm không ảnh hưởng LT ban đích', async () => {
    const btt = dept['Ban TT&SK']
    // Làm trống Ban TT&SK: LT hiện có (nếu seed có) về Chưa phân Ban.
    for (const leadEmail of await liveLeads(btt)) await updateChapterDepartment({ chapterId, userId: await userId(leadEmail), departmentUnitId: null, makeLead: false, actorId })
    const lt = await newMember('lt-chuyen', dept['Ban Thành Viên'])
    await appoint(lt.id, dept['Ban Thành Viên'], true)
    assert.deepEqual(await liveLeads(dept['Ban Thành Viên']), [lt.email])
    await appoint(lt.id, btt)
    assert.deepEqual(await liveLeads(dept['Ban Thành Viên']), [], 'ban cũ trống LT')
    assert.deepEqual(await liveLeads(btt), [lt.email])

    const plain = await newMember('thuong', dept['Ban Thành Viên'])
    await updateChapterDepartment({ chapterId, userId: plain.id, departmentUnitId: btt, makeLead: false, actorId })
    assert.deepEqual(await liveLeads(btt), [lt.email], 'LT ban đích giữ nguyên')
    assert.deepEqual(await livePositions(plain.email), [['DEPARTMENT_MEMBER', btt]])
  })

  it('ban có lời mời LT chờ → 409 nêu email; xác nhận → lời mời đó bị hủy, lời mời ban khác còn', async () => {
    const btv = dept['Ban Thành Viên']
    const other = dept['Ban TT&SK']
    const mk = (to: string, unitId: string) => prisma.invitation.create({ data: { email: to, role: 'MEMBER', organization_unit_id: unitId, position_code: 'DEPARTMENT_LEAD', invited_by: actorId, token_hash: `t03-${randomUUID()}`, expires_at: new Date(Date.now() + 86400_000) } })
    const pending = await mk(email('cho'), btv)
    const elsewhere = await mk(email('khac'), other)
    const fresh = await newMember('moi-2', btv)
    await assert.rejects(appoint(fresh.id, btv), (error: any) => {
      assert.equal(error.code, CONFIRM)
      assert.match(error.message, new RegExp(`lời mời Trưởng ban chưa kích hoạt cho ${email('cho').replace(/[.]/g, '\\.')}`))
      return true
    })
    assert.equal((await prisma.invitation.findUniqueOrThrow({ where: { id: pending.id } })).status, 'PENDING')
    await appoint(fresh.id, btv, true)
    assert.equal((await prisma.invitation.findUniqueOrThrow({ where: { id: pending.id } })).status, 'CANCELLED')
    assert.equal((await prisma.invitation.findUniqueOrThrow({ where: { id: elsewhere.id } })).status, 'PENDING')
    assert.deepEqual(await liveLeads(btv), [fresh.email])
  })
})

describe('đồng thời trên DB thật', () => {
  it('5 lượt bổ nhiệm đã xác nhận cùng lúc vào cùng ban → đúng 1 LT, 4 người còn lại là Thành viên cùng ban, không lỗi', async () => {
    const unit = dept['Ban Nội Dung']
    const people = await Promise.all([1, 2, 3, 4, 5].map((i) => newMember(`dong-${i}`, dept['Ban Thành Viên'])))
    const results = await Promise.allSettled(people.map((p) => appoint(p.id, unit, true)))
    assert.deepEqual(results.filter((r) => r.status === 'rejected').map((r: any) => String(r.reason)), [])
    const leads = await liveLeads(unit)
    assert.equal(leads.length, 1, leads.join(', '))
    for (const p of people) {
      const expected = leads[0] === p.email ? [['DEPARTMENT_LEAD', unit]] : [['DEPARTMENT_MEMBER', unit]]
      assert.deepEqual(await livePositions(p.email), expected, p.email)
    }
  })

  it('5 lượt bổ nhiệm chưa xác nhận cùng lúc vào ban trống LT → đúng 1 thành công, 4 lượt 409', async () => {
    const unit = dept['Ban TT&SK']
    for (const leadEmail of await liveLeads(unit)) await updateChapterDepartment({ chapterId, userId: await userId(leadEmail), departmentUnitId: null, makeLead: false, actorId })
    await prisma.invitation.updateMany({ where: { organization_unit_id: unit, position_code: 'DEPARTMENT_LEAD', status: 'PENDING' }, data: { status: 'CANCELLED', cancelled_at: now() } })
    const people = await Promise.all([1, 2, 3, 4, 5].map((i) => newMember(`trong-${i}`, dept['Ban Thành Viên'])))
    const results = await Promise.allSettled(people.map((p) => appoint(p.id, unit)))
    const ok = results.filter((r) => r.status === 'fulfilled')
    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[]
    assert.equal(ok.length, 1)
    assert.deepEqual(rejected.map((r) => r.reason.code), [CONFIRM, CONFIRM, CONFIRM, CONFIRM])
    assert.equal((await liveLeads(unit)).length, 1)
  })
})
