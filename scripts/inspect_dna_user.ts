import { prisma } from '../src/lib/prisma'

async function main() {
  const u = await prisma.user.findUnique({
    where: { email: 'dna.member.demo@bbe.vn' },
    select: {
      id: true,
      email: true,
      role: true,
      status: true,
      chapter_members: true,
      organization_memberships: {
        include: { unit: true }
      }
    }
  })
  const intervals = await prisma.chapterAffiliationInterval.findMany({
    where: { user_id: u?.id }
  })
  console.log('User:', JSON.stringify(u, null, 2))
  console.log('Intervals:', JSON.stringify(intervals, null, 2))
}

main().finally(() => prisma.$disconnect())
