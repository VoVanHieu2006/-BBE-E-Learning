import '../../scripts/test/require-test-database.cjs'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { prisma } from '../lib/prisma'
import { ensureChapterStandardDepartments } from '../lib/chapter-departments'
import { updateChapterDepartment } from '../lib/chapter-department-update'

async function run() {
  console.log('=== TEST: ADMIN COURSE PROGRAM CLASSIFICATION & LEAD DEPT TRANSFER ===')

  const key = randomUUID()
  const adminId = randomUUID()
  const memberId = randomUUID()
  const chapterId = randomUUID()
  const chapterUnitId = randomUUID()
  const courseId = randomUUID()
  const programIds: string[] = []

  try {
    // -------------------------------------------------------------
    // Test 1: Course Program Classification
    // -------------------------------------------------------------
    console.log('\n--- 1. Testing Course Program Auto-Classification ---')
    const admin = await prisma.user.create({
      data: { id: adminId, email: `program-admin-${key}@test.invalid`, password_hash: 'test-only', role: 'ADMIN', status: 'ACTIVE' },
    })

    const testCourse = await prisma.course.create({
      data: {
        id: courseId,
        title: `Classification fixture ${key}`,
        visibility: 'PRIVATE',
        status: 'DRAFT',
        created_by: admin.id,
      },
    })

    // Test PATCH course logic
    const { LEARNING_PROGRAMS } = await import('../lib/learning-catalog')
    for (const progDef of LEARNING_PROGRAMS) {
      // Own the category records as well; do not seed or alter the shared catalog.
      const fixtureCode = `${progDef.code}_${key.replace(/-/g, '')}`
      const prog = await prisma.learningProgram.create({
        data: { ...progDef, code: fixtureCode },
      })
      programIds.push(prog.id)

      const updated = await prisma.course.update({
        where: { id: testCourse.id },
        data: { program_id: prog.id },
        include: { program: true },
      })
      assert.equal(updated.program?.code, fixtureCode, `Course must be categorized under the ${progDef.code} fixture`)
      assert.equal(updated.program?.is_core, progDef.is_core)
      assert.equal(updated.program?.name, progDef.name)
    }

    // Unclassify
    const unclassified = await prisma.course.update({
      where: { id: testCourse.id },
      data: { program_id: null },
      include: { program: true },
    })
    assert.equal(unclassified.program_id, null, 'Course must be unclassified')
    console.log('✓ Course program classification tests passed successfully!')

    // Cleanup test course
    await prisma.course.delete({ where: { id: testCourse.id } })

    // -------------------------------------------------------------
    // Test 2: Chapter Standard Departments & Member Transfer
    // -------------------------------------------------------------
    console.log('\n--- 2. Testing Lead Chapter Department Transfer ---')
    const chapterUnit = await prisma.organizationUnit.create({
      data: { id: chapterUnitId, name: `Department fixture ${key}`, type: 'CHAPTER' },
    })
    const chapter = await prisma.chapter.create({
      data: { id: chapterId, name: chapterUnit.name, organization_unit_id: chapterUnit.id },
    })

    // Ensure 7 departments
    const departments = await ensureChapterStandardDepartments(chapter.organization_unit_id!)
    assert.equal(departments.length, 7, 'Chapter must have exactly 7 standard departments')

    // Create test member in chapter
    const testMemberEmail = `department-member-${key}@test.invalid`
    const testMember = await prisma.user.create({
      data: {
        id: memberId,
        email: testMemberEmail,
        password_hash: 'test-hash-not-real',
        role: 'MEMBER',
        status: 'ACTIVE',
      },
    })

    await prisma.chapterMember.create({
      data: {
        chapter_id: chapter.id,
        user_id: testMember.id,
      },
    })

    {
      const bnd = departments.find((d) => d.name === 'Ban Nội Dung')!
      const btv = departments.find((d) => d.name === 'Ban Thành Viên')!
      assert.ok(bnd, 'Ban Nội Dung must exist')
      assert.ok(btv, 'Ban Thành Viên must exist')

      // Move to Ban Nội Dung (ordinary member)
      const res1 = await updateChapterDepartment({
        chapterId: chapter.id,
        userId: testMember.id,
        departmentUnitId: bnd.id,
        makeLead: false,
        actorId: admin.id,
      })
      assert.equal(res1.departmentUnitId, bnd.id)
      assert.equal(res1.isLead, false)

      const membership1 = await prisma.organizationMembership.findFirst({
        where: { user_id: testMember.id, unit_id: bnd.id, status: 'ACTIVE', ends_at: null },
      })
      assert.ok(membership1, 'Member must have active membership in Ban Nội Dung')

      // Idempotent call to same department
      const resIdempotent = await updateChapterDepartment({
        chapterId: chapter.id,
        userId: testMember.id,
        departmentUnitId: bnd.id,
        makeLead: false,
        actorId: admin.id,
      })
      assert.equal(resIdempotent.departmentUnitId, bnd.id)
      assert.equal(resIdempotent.isLead, false)
      assert.equal(await prisma.organizationMembership.count({
        where: { user_id: testMember.id, unit_id: bnd.id, status: 'ACTIVE', ends_at: null },
      }), 1, 'An idempotent update must not duplicate the active membership')

      // Move to Ban Thành Viên (appoint as Lead)
      const res2 = await updateChapterDepartment({
        chapterId: chapter.id,
        userId: testMember.id,
        departmentUnitId: btv.id,
        makeLead: true,
        actorId: admin.id,
      })
      assert.equal(res2.departmentUnitId, btv.id)
      assert.equal(res2.isLead, true)

      const oldMembership = await prisma.organizationMembership.findFirst({
        where: { user_id: testMember.id, unit_id: bnd.id, ends_at: null },
      })
      assert.equal(oldMembership, null, 'Old membership in Ban Nội Dung must be ended')

      const newMembership = await prisma.organizationMembership.findFirst({
        where: { user_id: testMember.id, unit_id: btv.id, status: 'ACTIVE', ends_at: null },
      })
      assert.ok(newMembership, 'New membership in Ban Thành Viên must be active')

      const leadPosition = await prisma.positionAssignment.findFirst({
        where: {
          user_id: testMember.id,
          unit_id: btv.id,
          position: { code: 'DEPARTMENT_LEAD' },
          ends_at: null,
        },
      })
      assert.ok(leadPosition, 'Member must hold DEPARTMENT_LEAD position in Ban Thành Viên')

      // Move to Chủ Tịch Chapter
      const res3 = await updateChapterDepartment({
        chapterId: chapter.id,
        userId: testMember.id,
        departmentUnitId: chapter.organization_unit_id,
        makeLead: true,
        actorId: admin.id,
      })
      assert.equal(res3.isLead, true)

      const presidentPosition = await prisma.positionAssignment.findFirst({
        where: {
          user_id: testMember.id,
          unit_id: chapter.organization_unit_id!,
          position: { code: 'CHAPTER_PRESIDENT' },
          ends_at: null,
        },
      })
      assert.ok(presidentPosition, 'Member must hold CHAPTER_PRESIDENT position in Chapter unit')

      // Move back to unassigned
      const res4 = await updateChapterDepartment({
        chapterId: chapter.id,
        userId: testMember.id,
        departmentUnitId: null,
        makeLead: false,
        actorId: admin.id,
      })
      assert.equal(res4.departmentUnitId, null)
      assert.equal(res4.isLead, false)

      const activeDeptMemberships = await prisma.organizationMembership.count({
        where: {
          user_id: testMember.id,
          unit: { type: 'DEPARTMENT' },
          status: 'ACTIVE',
          ends_at: null,
        },
      })
      assert.equal(activeDeptMemberships, 0, 'Member must have 0 active department memberships')

      console.log('✓ Lead chapter department transfer tests passed successfully!')
    }

    console.log('\n=== ALL TESTS PASSED SUCCESSFULLY! ===')
  } finally {
    // Every write is scoped to this run, including cleanup after partial setup.
    await prisma.positionAssignment.deleteMany({ where: { user_id: memberId } })
    await prisma.organizationMembership.deleteMany({ where: { user_id: memberId } })
    await prisma.userLearningAssignment.deleteMany({ where: { user_id: memberId } })
    const paths = await prisma.learningPath.findMany({ where: { user_id: memberId }, select: { id: true } })
    await prisma.learningPathChange.deleteMany({ where: { path_id: { in: paths.map(path => path.id) } } })
    await prisma.learningPath.deleteMany({ where: { user_id: memberId } })
    await prisma.supplementalLearningRequirement.deleteMany({ where: { user_id: memberId } })
    await prisma.learningCycle.deleteMany({ where: { user_id: memberId } })
    await prisma.learningOutbox.deleteMany({ where: { user_id: memberId } })
    await prisma.learningNotice.deleteMany({ where: { user_id: memberId } })
    await prisma.course.deleteMany({ where: { id: courseId } })
    await prisma.learningProgram.deleteMany({ where: { id: { in: programIds } } })
    await prisma.chapterMember.deleteMany({ where: { user_id: memberId } })
    await prisma.user.deleteMany({ where: { id: { in: [memberId, adminId] } } })
    // History triggers have no Prisma user relation; remove their owned rows explicitly.
    await prisma.accountStateInterval.deleteMany({ where: { user_id: { in: [memberId, adminId] } } })
    await prisma.chapterAffiliationInterval.deleteMany({ where: { user_id: memberId } })
    await prisma.chapter.deleteMany({ where: { id: chapterId } })
    await prisma.organizationUnit.deleteMany({ where: { parent_id: chapterUnitId } })
    await prisma.organizationUnit.deleteMany({ where: { id: chapterUnitId } })
  }
}

run()
  .catch((e) => {
    console.error('Test failed with error:', e)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
