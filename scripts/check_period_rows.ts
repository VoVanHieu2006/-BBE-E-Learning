import { prisma } from '../src/lib/prisma'
import { individualPeriodRows, historicalChapterMonthRows } from '../src/lib/competition-snapshots'

async function main() {
  const now = new Date()
  const month = await prisma.competitionMonth.findFirst({
    where: { starts_at: { lte: now }, ends_at: { gt: now } }
  })
  console.log('Current month:', month?.key)

  if (month) {
    const memberRows = await individualPeriodRows(prisma, month.starts_at, now, 'MEMBER')
    console.log('Member rows count:', memberRows.length)
    if (memberRows.length) {
      console.log('Sample member row:', memberRows[0])
    }

    const chapterRows = await historicalChapterMonthRows(prisma, month, now)
    console.log('Chapter rows count:', chapterRows.length)
    if (chapterRows.length) {
      console.log('Sample chapter row:', chapterRows[0])
    }
  }
}

main().finally(() => prisma.$disconnect())
