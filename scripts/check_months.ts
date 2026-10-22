import { prisma } from '../src/lib/prisma'

async function main() {
  const months = await prisma.competitionMonth.findMany({
    orderBy: { starts_at: 'desc' },
    take: 10
  })
  console.log('Months in DB:', months)
  console.log('Current system date:', new Date().toISOString())
}

main().finally(() => prisma.$disconnect())
