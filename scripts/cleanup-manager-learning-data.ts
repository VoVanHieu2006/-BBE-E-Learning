import { PrismaClient } from '@prisma/client'
import 'dotenv/config'

const prisma = new PrismaClient()

async function main() {
  const users = await prisma.user.findMany({
    where: { OR: [{ role: 'CHAPTER_LEADER' }, { position_assignments: { some: { position: { code: 'DNA_LEAD' }, ends_at: null } } }] },
    select: { id: true, email: true, position_assignments: { where: { position: { code: 'DNA_LEAD' }, ends_at: null }, select: { id: true } } },
  })
  for (const user of users) {
    await prisma.$transaction([
      prisma.attempt.deleteMany({ where: { user_id: user.id } }),
      prisma.lessonProgress.deleteMany({ where: { user_id: user.id } }),
      prisma.starLedger.deleteMany({ where: { user_id: user.id } }),
      prisma.userLearningAssignment.deleteMany({ where: { user_id: user.id } }),
    ])
    if (user.position_assignments.length) {
      await prisma.$transaction([
        prisma.chapterMember.deleteMany({ where: { user_id: user.id } }),
        prisma.organizationMembership.deleteMany({ where: { user_id: user.id, unit: { type: { in: ['CHAPTER', 'DEPARTMENT'] } } } }),
        prisma.positionAssignment.deleteMany({ where: { user_id: user.id, position: { scope: { in: ['CHAPTER', 'DEPARTMENT'] } } } }),
      ])
    }
    console.log(`Cleaned management-only account: ${user.email}`)
  }
}

main().finally(() => prisma.$disconnect())
