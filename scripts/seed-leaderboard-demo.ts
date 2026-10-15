import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()
const specs = [
  { slug: 'seed-small', name: 'BBE Seed Nhỏ Chapter', members: 15, completedRate: 0, kpi: 'GREEN', stars: 18 },
  { slug: 'seed-learning', name: 'BBE Seed Đang học Chapter', members: 22, completedRate: .35, kpi: 'YELLOW', stars: 8 },
  { slug: 'seed-red', name: 'BBE Seed KPI Đỏ Chapter', members: 30, completedRate: .8, kpi: 'RED', stars: 20 },
  { slug: 'seed-balanced', name: 'BBE Seed Cân bằng Chapter', members: 40, completedRate: .7, kpi: 'YELLOW', stars: 25 },
  { slug: 'seed-green', name: 'BBE Seed Xuất sắc Chapter', members: 51, completedRate: .9, kpi: 'GREEN', stars: 35 },
] as const

async function main() {
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } })
  const root = await prisma.organizationUnit.findFirst({ where: { type: 'ROOT' } })
  const course = await prisma.course.findFirst({ where: { status: 'PUBLISHED', sessions: { some: { lessons: { some: {} } } } }, include: { sessions: { include: { lessons: true }, take: 1 } } })
  if (!admin || !root || !course) throw new Error('Admin, ROOT or published course is missing')
  const lesson = course.sessions[0].lessons[0]
  const hash = await bcrypt.hash('Demo@123456', 12)
  const now = new Date()
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))

  if (process.argv.includes('--multi-reason-only')) {
    const chapter = await prisma.chapter.findUnique({ where: { name: 'BBE Seed Nhỏ Chapter' }, include: { chapter_members: true } })
    if (!chapter) throw new Error('Small demo Chapter is missing')
    const memberIds = chapter.chapter_members.map((member) => member.user_id)
    await prisma.lessonProgress.updateMany({ where: { user_id: { in: memberIds } }, data: { completed: false, completed_at: null, furthest_watched_position_seconds: 0 } })
    const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
    await prisma.chapterMonthlyKpi.upsert({ where: { chapter_id_month_start: { chapter_id: chapter.id, month_start: nextMonth } }, update: { status: 'BLACK', note: 'Seed để kiểm tra đồng thời nhiều lý do loại' }, create: { chapter_id: chapter.id, month_start: nextMonth, status: 'BLACK', note: 'Seed để kiểm tra đồng thời nhiều lý do loại', configured_by_user_id: admin.id } })
    console.log(`Prepared multi-reason Chapter with ${memberIds.length} active members.`)
    return
  }

  for (const spec of specs) {
    const unit = await prisma.organizationUnit.findFirst({ where: { name: spec.name, type: 'CHAPTER' } }) || await prisma.organizationUnit.create({ data: { name: spec.name, type: 'CHAPTER', parent_id: root.id } })
    const chapter = await prisma.chapter.upsert({ where: { name: spec.name }, update: { status: 'ACTIVE', organization_unit_id: unit.id }, create: { name: spec.name, status: 'ACTIVE', organization_unit_id: unit.id } })
    const emails = Array.from({ length: spec.members }, (_, index) => `${spec.slug}-${String(index + 1).padStart(2, '0')}@demo.bbe.vn`)
    await prisma.user.createMany({ data: emails.map((email, index) => ({ email, display_name: `${spec.name} ${index + 1}`, password_hash: hash, role: 'MEMBER' as const, status: 'ACTIVE' as const })), skipDuplicates: true })
    const users = await prisma.user.findMany({ where: { email: { in: emails } }, select: { id: true } })
    await prisma.chapterMember.createMany({ data: users.map((user) => ({ chapter_id: chapter.id, user_id: user.id })), skipDuplicates: true })
    const assigned = new Set((await prisma.userLearningAssignment.findMany({ where: { user_id: { in: users.map((user) => user.id) }, course_id: course.id, ended_at: null }, select: { user_id: true } })).map((row) => row.user_id))
    await prisma.userLearningAssignment.createMany({ data: users.filter((user) => !assigned.has(user.id)).map((user) => ({ user_id: user.id, course_id: course.id, mandatory: true, can_view: true, can_assess: false, can_earn_stars: true, status: 'ASSIGNED' as const, assigned_at: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1)) })), skipDuplicates: true })
    const completed = users.slice(0, Math.round(users.length * spec.completedRate))
    await prisma.lessonProgress.updateMany({ where: { user_id: { in: users.map((user) => user.id) }, lesson_id: lesson.id }, data: { completed: false, completed_at: null, furthest_watched_position_seconds: 0 } })
    for (let start = 0; start < completed.length; start += 15) await Promise.all(completed.slice(start, start + 15).map((user, offset) => { const index = start + offset; const completedAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 4 + index % 5, 10 + index % 15)); return prisma.lessonProgress.upsert({ where: { user_id_lesson_id: { user_id: user.id, lesson_id: lesson.id } }, update: { completed: true, completed_at: completedAt, furthest_watched_position_seconds: 9999 }, create: { user_id: user.id, lesson_id: lesson.id, completed: true, completed_at: completedAt, furthest_watched_position_seconds: 9999 } }) }))
    for (let start = 0; start < users.length; start += 15) await Promise.all(users.slice(start, start + 15).map((user, offset) => { const index = start + offset; const awardedAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2 + index % 3, 5 + index % 20)); return prisma.starLedger.upsert({ where: { reward_key: `leaderboard-seed:${spec.slug}:${user.id}` }, update: { amount: spec.stars + index % 5, awarded_at: awardedAt }, create: { user_id: user.id, amount: spec.stars + index % 5, reason: 'ADMIN_ADJUSTMENT', reward_key: `leaderboard-seed:${spec.slug}:${user.id}`, source_type: 'COURSE', source_id: course.id, metadata: { chapter: spec.name }, awarded_at: awardedAt } }) }))
    await prisma.chapterMonthlyKpi.upsert({ where: { chapter_id_month_start: { chapter_id: chapter.id, month_start: monthStart } }, update: { status: spec.kpi }, create: { chapter_id: chapter.id, month_start: monthStart, status: spec.kpi, note: 'Dữ liệu mẫu BXH', configured_by_user_id: admin.id } })
    for (let offset = 1; offset <= 5; offset++) {
      const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1))
      await prisma.chapterMonthlyKpi.upsert({ where: { chapter_id_month_start: { chapter_id: chapter.id, month_start: month } }, update: {}, create: { chapter_id: chapter.id, month_start: month, status: offset % 2 ? 'YELLOW' : 'GREEN', note: `Dữ liệu lịch sử tháng ${String(month.getUTCMonth() + 1).padStart(2, '0')}/${month.getUTCFullYear()}`, configured_by_user_id: admin.id } })
    }
    if (spec.slug === 'seed-green') {
      const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
      await prisma.chapterMonthlyKpi.upsert({ where: { chapter_id_month_start: { chapter_id: chapter.id, month_start: nextMonth } }, update: { status: 'GREEN' }, create: { chapter_id: chapter.id, month_start: nextMonth, status: 'GREEN', note: 'Chapter đã nhập KPI sớm cho tháng mới', configured_by_user_id: admin.id } })
    }
    if (spec.slug === 'seed-small') {
      const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
      await prisma.chapterMonthlyKpi.upsert({ where: { chapter_id_month_start: { chapter_id: chapter.id, month_start: nextMonth } }, update: { status: 'BLACK', note: 'Seed để kiểm tra đồng thời nhiều lý do loại' }, create: { chapter_id: chapter.id, month_start: nextMonth, status: 'BLACK', note: 'Seed để kiểm tra đồng thời nhiều lý do loại', configured_by_user_id: admin.id } })
    }
  }

  const demoTitle = 'Hành trình BBE nhiều bài học'
  let demoCourse = await prisma.course.findFirst({ where: { title: demoTitle } })
  if (!demoCourse) demoCourse = await prisma.course.create({ data: { title: demoTitle, description: 'Khóa học seed để kiểm tra bài đã học và chưa học.', status: 'PUBLISHED', visibility: 'PRIVATE', published_at: now, created_by: admin.id, cover_url: '/images/course-covers/organization-culture.png' } })
  if (!await prisma.session.findFirst({ where: { course_id: demoCourse.id } })) for (let sessionIndex = 1; sessionIndex <= 2; sessionIndex++) {
    const session = await prisma.session.create({ data: { course_id: demoCourse.id, title: `Buổi học ${sessionIndex}`, description: `Buổi học mẫu ${sessionIndex}`, sort_order: sessionIndex } })
    for (let lessonIndex = 1; lessonIndex <= 3; lessonIndex++) {
      const seededLesson = await prisma.lesson.create({ data: { session_id: session.id, title: `Bài ${sessionIndex}.${lessonIndex}: Nội dung thực hành`, description: 'Bài seed phục vụ kiểm tra tiến độ chi tiết.', sort_order: lessonIndex } })
      await prisma.video.create({ data: { lesson_id: seededLesson.id, provider: 'YOUTUBE', youtube_video_id: 'S-QqTDbsuBA', duration_seconds: 180 + lessonIndex * 60, title: seededLesson.title } })
    }
  }
  const demoUser = await prisma.user.findUnique({ where: { email: 'member01.demo@bbe.vn' } }) || await prisma.user.findFirst({ where: { role: 'MEMBER', status: 'ACTIVE' } })
  const demoLessons = await prisma.lesson.findMany({ where: { session: { course_id: demoCourse.id } }, orderBy: [{ session: { sort_order: 'asc' } }, { sort_order: 'asc' }] })
  if (demoUser) {
    if (!await prisma.userLearningAssignment.findFirst({ where: { user_id: demoUser.id, course_id: demoCourse.id, ended_at: null } })) await prisma.userLearningAssignment.create({ data: { user_id: demoUser.id, course_id: demoCourse.id, mandatory: true, can_view: true, can_assess: true, can_earn_stars: true, status: 'IN_PROGRESS' } })
    for (let index = 0; index < demoLessons.length; index++) { const seededLesson = demoLessons[index]; await prisma.lessonProgress.upsert({ where: { user_id_lesson_id: { user_id: demoUser.id, lesson_id: seededLesson.id } }, update: { completed: index < 3, completed_at: index < 3 ? now : null, furthest_watched_position_seconds: index < 3 ? 9999 : 0 }, create: { user_id: demoUser.id, lesson_id: seededLesson.id, completed: index < 3, completed_at: index < 3 ? now : null, furthest_watched_position_seconds: index < 3 ? 9999 : 0 } }) }
  }
  console.log('Seeded leaderboard history and multi-lesson course.')
}

main().finally(() => prisma.$disconnect())
