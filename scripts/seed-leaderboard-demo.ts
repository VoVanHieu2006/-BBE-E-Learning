import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()
const specs = [
  { slug: 'seed-small', name: 'BBE Seed Nhỏ Chapter', members: 15, completedRate: .8, kpi: 'GREEN', stars: 18 },
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
  const now = new Date(); const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  for (const spec of specs) {
    const unit = await prisma.organizationUnit.findFirst({ where: { name: spec.name, type: 'CHAPTER' } }) || await prisma.organizationUnit.create({ data: { name: spec.name, type: 'CHAPTER', parent_id: root.id } })
    const chapter = await prisma.chapter.upsert({ where: { name: spec.name }, update: { status: 'ACTIVE', organization_unit_id: unit.id }, create: { name: spec.name, status: 'ACTIVE', organization_unit_id: unit.id } })
    const emails = Array.from({ length: spec.members }, (_, index) => `${spec.slug}-${String(index + 1).padStart(2, '0')}@demo.bbe.vn`)
    await prisma.user.createMany({ data: emails.map((email, index) => ({ email, display_name: `${spec.name} ${index + 1}`, password_hash: hash, role: 'MEMBER' as const, status: 'ACTIVE' as const })), skipDuplicates: true })
    const users = await prisma.user.findMany({ where: { email: { in: emails } }, select: { id: true, email: true } })
    await prisma.chapterMember.createMany({ data: users.map((user) => ({ chapter_id: chapter.id, user_id: user.id })), skipDuplicates: true })
    const existingAssignments = new Set((await prisma.userLearningAssignment.findMany({ where: { user_id: { in: users.map((u) => u.id) }, course_id: course.id, ended_at: null }, select: { user_id: true } })).map((row) => row.user_id))
    await prisma.userLearningAssignment.createMany({ data: users.filter((u) => !existingAssignments.has(u.id)).map((user) => ({ user_id: user.id, course_id: course.id, mandatory: true, can_view: true, can_assess: false, can_earn_stars: true, status: 'ASSIGNED' as const })), skipDuplicates: true })
    const completed = users.slice(0, Math.round(users.length * spec.completedRate))
    await prisma.lessonProgress.createMany({ data: completed.map((user) => ({ user_id: user.id, lesson_id: lesson.id, completed: true, completed_at: now, furthest_watched_position_seconds: 9999 })), skipDuplicates: true })
    await prisma.lessonProgress.updateMany({ where: { user_id: { in: completed.map((user) => user.id) }, lesson_id: lesson.id }, data: { completed: true, completed_at: now, furthest_watched_position_seconds: 9999 } })
    await prisma.starLedger.createMany({ data: users.map((user, index) => ({ user_id: user.id, amount: spec.stars + index % 5, reason: 'ADMIN_ADJUSTMENT' as const, reward_key: `leaderboard-seed:${spec.slug}:${user.id}`, source_type: 'COURSE', source_id: course.id, metadata: { chapter: spec.name } })), skipDuplicates: true })
    await prisma.chapterMonthlyKpi.upsert({ where: { chapter_id_month_start: { chapter_id: chapter.id, month_start: monthStart } }, update: { status: spec.kpi, configured_by_user_id: admin.id }, create: { chapter_id: chapter.id, month_start: monthStart, status: spec.kpi, note: 'Dữ liệu mẫu BXH', configured_by_user_id: admin.id } })
    for (let offset = 1; offset <= 2; offset++) { const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1)); await prisma.chapterMonthlyKpi.upsert({ where: { chapter_id_month_start: { chapter_id: chapter.id, month_start: month } }, update: {}, create: { chapter_id: chapter.id, month_start: month, status: offset === 1 ? 'YELLOW' : 'GREEN', note: `Lịch sử mẫu tháng -${offset}`, configured_by_user_id: admin.id } }) }
  }
  console.log('Seeded leaderboard demo chapters:', specs.map((spec) => spec.name))
}
main().finally(() => prisma.$disconnect())
