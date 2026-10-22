import { PrismaClient } from '@prisma/client'
import assert from 'node:assert/strict'

const prisma = new PrismaClient()

async function main() {
  console.log('=== P1 VERIFICATION SUITE ===')

  // P1.1: Verify Guest Public Course & Document access in DB
  console.log('\n[P1.1] Testing Public Course & Document permissions...')
  const publicLesson = await prisma.lesson.findFirst({
    where: {
      session: {
        course: {
          status: 'PUBLISHED',
          visibility: 'PUBLIC',
        },
      },
    },
    include: {
      session: { include: { course: true } },
      documents: true,
      video: true,
    },
  })
  assert.ok(publicLesson, 'Public published lesson exists in DB')
  console.log(`✓ Found public lesson: "${publicLesson.title}" (ID: ${publicLesson.id})`)
  console.log(`✓ Course visibility: ${publicLesson.session.course.visibility}, status: ${publicLesson.session.course.status}`)
  console.log(`✓ Attached documents: ${publicLesson.documents.length}`)

  // P1.2: Verify DNA Member Demo Separation
  console.log('\n[P1.2] Testing DNA - Chapter Separation for dna.member.demo@bbe.vn...')
  const dnaUser = await prisma.user.findUnique({
    where: { email: 'dna.member.demo@bbe.vn' },
    include: {
      chapter_members: true,
      organization_memberships: {
        where: { status: 'ACTIVE' },
        include: { unit: true },
      },
      stars: true,
    },
  })
  assert.ok(dnaUser, 'dna.member.demo@bbe.vn exists')
  assert.equal(dnaUser.chapter_members.length, 0, 'Must have 0 active ChapterMember records')
  assert.ok(
    dnaUser.organization_memberships.every((m) => ['DNA', 'DNA_GROUP'].includes(m.unit.type)),
    'Active memberships must only be DNA / DNA_GROUP'
  )
  assert.ok(dnaUser.stars.length > 0, 'StarLedger records must be preserved')
  assert.ok(
    dnaUser.stars.every((s) => s.chapter_at_award_id !== null),
    'All historical StarLedger records must have chapter_at_award_id preserved'
  )

  const intervals = await prisma.chapterAffiliationInterval.findMany({
    where: { user_id: dnaUser.id },
  })
  assert.ok(intervals.length > 0, 'Affiliation interval must exist')
  assert.ok(
    intervals.every((i) => i.ends_at !== null),
    'All former ChapterAffiliationIntervals must be ended (ends_at != null)'
  )
  console.log(`✓ Chapter members count: 0`)
  console.log(`✓ Active units: ${dnaUser.organization_memberships.map((m) => `${m.unit.name} (${m.unit.type})`).join(', ')}`)
  console.log(`✓ Star count: ${dnaUser.stars.length} (chapter_at_award_id preserved)`)
  console.log(`✓ Affiliation intervals ended: ${intervals.map((i) => i.ends_at?.toISOString()).join(', ')}`)

  // P1.3: Verify User Status Guard
  console.log('\n[P1.3] Testing User Status Guard...')
  const { assertCanChangeUserStatus } = await import('../src/lib/user-status-rules.ts')
  const leadActor = { userId: 'lead-test-id', role: 'CHAPTER_LEADER', chapterId: 'chap-1' }
  const inactiveTarget = { id: 'member-test-id', role: 'MEMBER', status: 'INACTIVE', deactivated_by_role: 'LEAD' }

  const leadReactivateAttempt = assertCanChangeUserStatus(leadActor, inactiveTarget, 'ACTIVE')
  assert.equal(leadReactivateAttempt.allowed, false, 'Lead cannot reactivate account')
  assert.equal(leadReactivateAttempt.code, 'AccessDenied')
  assert.match(leadReactivateAttempt.message, /Chỉ Admin mới có quyền kích hoạt lại/)

  const adminActor = { userId: 'admin-test-id', role: 'ADMIN' }
  const adminReactivateAttempt = assertCanChangeUserStatus(adminActor, inactiveTarget, 'ACTIVE')
  assert.equal(adminReactivateAttempt.allowed, true, 'Admin can reactivate account')
  console.log(`✓ Lead activation blocked with: ${leadReactivateAttempt.message}`)
  console.log(`✓ Admin activation allowed: ${adminReactivateAttempt.allowed}`)

  console.log('\n=== ALL P1 VERIFICATIONS PASSED 100% ===')
}

main()
  .catch((e) => {
    console.error('P1 VERIFICATION FAILED:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
