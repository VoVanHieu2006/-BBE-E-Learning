import assert from 'node:assert/strict'
import { prisma } from '../lib/prisma'
import { ensureChapterStandardDepartments } from '../lib/chapter-departments'
import { updateChapterDepartment } from '../lib/chapter-department-update'

async function run() {
  console.log('=== TEST: ADMIN COURSE PROGRAM CLASSIFICATION & LEAD DEPT TRANSFER ===')

  // -------------------------------------------------------------
  // Test 1: Course Program Classification
  // -------------------------------------------------------------
  console.log('\n--- 1. Testing Course Program Auto-Classification ---')
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN', status: 'ACTIVE' } })
  assert.ok(admin, 'Admin must exist')

  const testCourse = await prisma.course.create({
    data: {
      title: '__Test Classification Course__',
      visibility: 'PRIVATE',
      status: 'DRAFT',
      created_by: admin.id,
    },
  })

  // Test PATCH course logic
  const { LEARNING_PROGRAMS } = await import('../lib/learning-catalog')
  for (const progDef of LEARNING_PROGRAMS) {
    let prog = await prisma.learningProgram.findUnique({ where: { code: progDef.code } })
    if (!prog) {
      prog = await prisma.learningProgram.upsert({
        where: { code: progDef.code },
        update: {},
        create: {
          code: progDef.code,
          name: progDef.name,
          is_core: progDef.is_core,
          sort_order: progDef.sort_order,
        },
      })
    }
    assert.ok(prog, `Program ${progDef.code} must exist`)

    const updated = await prisma.course.update({
      where: { id: testCourse.id },
      data: { program_id: prog.id },
      include: { program: true },
    })
    assert.equal(updated.program?.code, progDef.code, `Course must be categorized under ${progDef.code}`)
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
  const chapter = await prisma.chapter.findFirst({
    where: { name: 'BBE Chapter 1' },
  })
  assert.ok(chapter, 'BBE Chapter 1 must exist')
  assert.ok(chapter.organization_unit_id, 'Chapter must have organization_unit_id')

  // Ensure 7 departments
  const departments = await ensureChapterStandardDepartments(chapter.organization_unit_id!)
  assert.equal(departments.length, 7, 'Chapter must have exactly 7 standard departments')

  // Create test member in chapter
  const testMemberEmail = `test.member.dept.${Date.now()}@bbe.vn`
  const testMember = await prisma.user.create({
    data: {
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

  try {
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
  } finally {
    // Cleanup test member
    await prisma.organizationMembership.deleteMany({ where: { user_id: testMember.id } })
    await prisma.positionAssignment.deleteMany({ where: { user_id: testMember.id } })
    await prisma.chapterMember.deleteMany({ where: { user_id: testMember.id } })
    await prisma.user.delete({ where: { id: testMember.id } })
  }

  console.log('\n=== ALL TESTS PASSED SUCCESSFULLY! ===')
}

run()
  .catch((e) => {
    console.error('Test failed with error:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
    process.exit(0)
  })
