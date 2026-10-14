import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
try {
  const [courses, users, chapterMemberships] = await Promise.all([
    prisma.course.count(),
    prisma.user.findMany({
      where: { email: { endsWith: '.demo@bbe.vn' } },
      select: {
        email: true, display_name: true, role: true, status: true,
        position_assignments: {
          where: { ends_at: null },
          select: { position: { select: { code: true, permissions: { select: { permission: { select: { code: true } } } } } }, unit: { select: { name: true, type: true } } },
        },
        organization_memberships: {
          where: { status: 'ACTIVE', ends_at: null },
          select: { unit: { select: { name: true, type: true, parent: { select: { name: true, type: true } } } } },
        },
      },
      orderBy: { email: 'asc' },
    }),
    prisma.chapterMember.groupBy({ by: ['user_id'], _count: { user_id: true } }),
  ])
  console.log(JSON.stringify({ courses, users, duplicateChapterUsers: chapterMemberships.filter((item) => item._count.user_id > 1) }, null, 2))
} finally {
  await prisma.$disconnect()
}
