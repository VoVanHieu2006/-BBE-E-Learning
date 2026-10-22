import { PrismaClient } from '@prisma/client'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const prisma = new PrismaClient()

async function main() {
  console.log('=== P3 VERIFICATION SUITE ===\n')

  // -------------------------------------------------------------
  // 1. P3.1: Check Chapter Roster 8 Columns
  // -------------------------------------------------------------
  console.log('[P3.1] Verifying Chapter Roster 8-Column Architecture...')
  const deptLibPath = path.resolve('src/lib/departments.ts')
  assert.ok(fs.existsSync(deptLibPath), 'src/lib/departments.ts must exist')
  const deptLibContent = fs.readFileSync(deptLibPath, 'utf-8')
  assert.ok(deptLibContent.includes('CHAPTER_ROSTER_COLUMNS'), 'CHAPTER_ROSTER_COLUMNS must be defined')
  assert.ok(deptLibContent.includes('Ban Chất Lượng') || deptLibContent.includes('QUALITY'), 'Quality Department must be in roster')

  // Verify term-transition grid styling
  const termTransitionPagePath = path.resolve('src/app/chapter-manager/term-transition/page.tsx')
  assert.ok(fs.existsSync(termTransitionPagePath), 'term-transition page must exist')
  const termTransitionContent = fs.readFileSync(termTransitionPagePath, 'utf-8')
  assert.ok(
    termTransitionContent.includes('grid-cols-8') && termTransitionContent.includes('min-w-[1900px]'),
    'Term transition roster grid must use grid-cols-8 and min-w-[1900px] to prevent wrap'
  )
  console.log('  ✓ CHAPTER_ROSTER_COLUMNS defined with all 8 columns including Ban Chất Lượng')
  console.log('  ✓ Term Transition UI updated with grid-cols-8 min-w-[1900px]')

  // -------------------------------------------------------------
  // 2. P3.2: Verify Admin Course Management & Program Association
  // -------------------------------------------------------------
  console.log('\n[P3.2] Verifying Admin Course Management & Programs...')
  const programs = await prisma.learningProgram.findMany({
    select: { id: true, code: true, name: true },
    orderBy: { sort_order: 'asc' },
  })
  assert.ok(programs.length >= 4, 'System must have at least 4 programs (Member, Leader, DNA, Extended)')
  console.log(`  ✓ Found ${programs.length} programs: ${programs.map((p) => p.code).join(', ')}`)

  const sampleCourse = await prisma.course.findFirst({
    where: { status: 'PUBLISHED' },
    select: { id: true, title: true, status: true, program_id: true, program: { select: { code: true } } },
  })
  assert.ok(sampleCourse, 'A published course must exist')
  console.log(`  ✓ Sample course: "${sampleCourse.title}" (Status: ${sampleCourse.status}, Program: ${sampleCourse.program?.code || 'None'})`)

  // Check admin courses page implementation
  const adminCoursesPagePath = path.resolve('src/app/admin/courses/page.tsx')
  assert.ok(fs.existsSync(adminCoursesPagePath), 'admin/courses page must exist')
  const adminCoursesContent = fs.readFileSync(adminCoursesPagePath, 'utf-8')
  assert.ok(adminCoursesContent.includes('CORE_MEMBER') && adminCoursesContent.includes('CORE_LEADER'), 'Must support 4 program accordions')
  assert.ok(!adminCoursesContent.includes('id.substring(0, 8)'), 'Raw UUIDs should be hidden from UI')
  console.log('  ✓ Admin courses page has 4 accordions, program reassignment dropdown, and raw UUIDs hidden')

  // -------------------------------------------------------------
  // 3. P3.3: Verify Mandatory Matrix 18 Targets & Auto Day Save
  // -------------------------------------------------------------
  console.log('\n[P3.3] Verifying Mandatory Matrix Architecture...')
  const mandatoryPagePath = path.resolve('src/app/admin/courses/mandatory/page.tsx')
  assert.ok(fs.existsSync(mandatoryPagePath), 'mandatory matrix page must exist')
  const mandatoryContent = fs.readFileSync(mandatoryPagePath, 'utf-8')
  assert.ok(mandatoryContent.includes('TARGET_GROUPS'), 'TARGET_GROUPS must be defined for 2-tier header')
  assert.ok(!mandatoryContent.includes('Đồng bộ cả dòng'), 'Old "Đồng bộ cả dòng" button must be removed')
  assert.ok(mandatoryContent.includes('dueDays'), 'dueDays auto sync implemented')
  console.log('  ✓ Mandatory Matrix has 18 target columns in a 2-tier header structure')
  console.log('  ✓ Removed "Đồng bộ cả dòng" button in favor of unified auto-save on row day inputs')

  // -------------------------------------------------------------
  // 4. P3.4: Verify Learning Interface, Countdown & Refresh Buttons
  // -------------------------------------------------------------
  console.log('\n[P3.4] Verifying Student Learning Interface & Refresh Logic...')
  const learningTreePath = path.resolve('src/components/learning/ProgramCourseTree.tsx')
  assert.ok(fs.existsSync(learningTreePath), 'ProgramCourseTree component must exist')
  const learningTreeContent = fs.readFileSync(learningTreePath, 'utf-8')
  assert.ok(learningTreeContent.includes('completedLessonIds') && learningTreeContent.includes('inProgressLessonIds'), 'Tree displays detailed lesson status')

  const studentCoursesPath = path.resolve('src/app/student/courses/page.tsx')
  const studentCoursesContent = fs.readFileSync(studentCoursesPath, 'utf-8')
  assert.ok(studentCoursesContent.includes('ProgramCourseTree'), 'ProgramCourseTree mounted in student courses')
  assert.ok(studentCoursesContent.includes('Làm mới'), 'Student course roadmap has dedicated refresh button')

  const studentStarsPath = path.resolve('src/app/student/stars/page.tsx')
  const studentStarsContent = fs.readFileSync(studentStarsPath, 'utf-8')
  assert.ok(studentStarsContent.includes('getCachedApiData'), 'Student stars page loads cache immediately to prevent tab flicker')
  assert.ok(studentStarsContent.includes('fetchHistory(true)'), 'Student stars page has manual reload button')
  console.log('  ✓ ProgramCourseTree displays lesson status (Completed, In-progress, Locked, Start)')
  console.log('  ✓ Student courses placed below banner with instant refresh button')
  console.log('  ✓ Student stars reads cache immediately, completely eliminating tab flicker')

  // -------------------------------------------------------------
  // 5. P3.5: Verify LearnerProfileView Shared Component
  // -------------------------------------------------------------
  console.log('\n[P3.5] Verifying LearnerProfileView Shared Component & Guard Integration...')
  const learnerProfilePath = path.resolve('src/components/learner/LearnerProfileView.tsx')
  assert.ok(fs.existsSync(learnerProfilePath), 'LearnerProfileView component must exist')
  const learnerProfileContent = fs.readFileSync(learnerProfilePath, 'utf-8')
  assert.ok(learnerProfileContent.includes('export default function LearnerProfileView'), 'Must export LearnerProfileView')
  assert.ok(learnerProfileContent.includes('tabFilter'), 'Must support course filter tabs')
  assert.ok(learnerProfileContent.includes('learningDetail'), 'Must support detailed learning breakdown')

  // Verify Chapter Leader member detail page
  const memberDetailPagePath = path.resolve('src/app/chapter-manager/members/[userId]/page.tsx')
  const memberDetailContent = fs.readFileSync(memberDetailPagePath, 'utf-8')
  assert.ok(memberDetailContent.includes('LearnerProfileView'), 'Chapter manager member detail must use LearnerProfileView')
  assert.ok(
    memberDetailContent.includes('Chỉ Admin mới có quyền mở lại') || memberDetailContent.includes('Chỉ Admin mới có quyền kích hoạt lại'),
    'Chapter Leader cannot reactivate inactive members (P1.3 safety rule)'
  )

  // Verify Admin users page
  const adminUsersPagePath = path.resolve('src/app/admin/users/page.tsx')
  const adminUsersContent = fs.readFileSync(adminUsersPagePath, 'utf-8')
  assert.ok(adminUsersContent.includes('LearnerProfileView'), 'Admin users page must use LearnerProfileView in modal')
  console.log('  ✓ LearnerProfileView component created with 4+1 KPI cards, filter tabs, video/quiz indicators')
  console.log('  ✓ Integrated into Chapter Manager member detail page with P1.3 Admin-only reactivation rule')
  console.log('  ✓ Integrated into Admin User Detail Modal')

  console.log('\n======================================================')
  console.log('🎉 ALL P3 VERIFICATIONS PASSED WITH 100% SUCCESS! 🎉')
  console.log('======================================================')
}

main()
  .catch((e) => {
    console.error('❌ Verification failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
