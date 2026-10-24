import { prisma } from '../src/lib/prisma'

async function main() {
  console.log('--- Checking all existing assessments with pools for Q > Q_max ---')
  const assessments = await prisma.assessment.findMany({
    where: { type: 'LESSON' },
    include: {
      question_pools: {
        include: {
          questions: { select: { id: true } },
        },
      },
    },
  })

  let fixedCount = 0
  for (const a of assessments) {
    if (a.question_pools && a.question_pools.length > 0) {
      const counts = a.question_pools.map((p) => p.questions.length)
      const minCount = Math.min(...counts)
      const qMax = a.question_pools.length * minCount
      console.log(`Assessment "${a.title}" (ID: ${a.id}): ${a.question_pools.length} pools, counts: [${counts.join(', ')}], min: ${minCount}, Q_max: ${qMax}, current Q: ${a.question_count}`)
      if (a.question_count > qMax) {
        console.log(` -> Exceeds Q_max! Adjusting question_count from ${a.question_count} to ${qMax}`)
        await prisma.assessment.update({
          where: { id: a.id },
          data: { question_count: Math.max(a.question_pools.length, qMax) },
        })
        fixedCount++
      }
    }
  }

  console.log(`Finished checking. Fixed ${fixedCount} assessments.`)
  await prisma.$disconnect()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
