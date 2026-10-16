import { prisma } from '../src/lib/prisma'

async function main() {
  const chapter = await prisma.chapter.findFirst({
    where: { name: { contains: 'Demo' } },
    include: {
      chapter_members: {
        include: { user: true },
      },
    },
  })
  if (!chapter || !chapter.organization_unit_id) return

  const existing = await prisma.chapterReorganization.findFirst({
    where: { chapter_id: chapter.id },
  })
  if (existing) {
    console.log('Chapter Demo đã có lịch sử chuyển giao:', existing.id)
    return
  }

  // Lấy danh sách phân ban hiện tại để tạo snapshot lịch sử nhiệm kỳ trước
  const memberships = await prisma.organizationMembership.findMany({
    where: { unit: { parent_id: chapter.organization_unit_id }, status: 'ACTIVE' },
    include: { user: true, unit: true },
  })
  const positions = await prisma.positionAssignment.findMany({
    where: { unit: { parent_id: chapter.organization_unit_id }, ends_at: null },
    include: { position: true },
  })

  const leadUserIds = new Set(
    positions
      .filter((p) => p.position.code === 'DEPARTMENT_LEAD' || p.position.code === 'CHAPTER_MANAGER')
      .map((p) => p.user_id)
  )

  const leadUser = chapter.chapter_members.find((m) => m.user.role === 'CHAPTER_LEADER')?.user || chapter.chapter_members[0].user

  const pastDate = new Date()
  pastDate.setMonth(pastDate.getMonth() - 6)

  const historyBatch = await prisma.chapterReorganization.create({
    data: {
      chapter_id: chapter.id,
      effective_at: pastDate,
      status: 'APPLIED',
      source_url: 'https://docs.google.com/spreadsheets/d/1MA9pJ1E8oHEZe8d1g6j0Ns6JqLoOCdhSVSgOflO0JBI/edit?gid=0#gid=0',
      created_by_user_id: leadUser.id,
      confirmed_at: pastDate,
      applied_at: pastDate,
      items: {
        create: memberships.map((m) => ({
          user_id: m.user_id,
          display_name: m.user.display_name,
          department_unit_id: m.unit_id,
          position_id: null,
          is_primary: leadUserIds.has(m.user_id),
        })),
      },
    },
  })

  console.log(`Đã tạo snapshot lịch sử nhiệm kỳ trước thành công: ${historyBatch.id} (${memberships.length} nhân sự).`)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
