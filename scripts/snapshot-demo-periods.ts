/**
 * Builds immutable demo snapshots for the closed September month and the
 * previous term using the same ranking services as production. No aggregate
 * score is typed by hand; scores are derived from lesson progress and StarLedger.
 *
 * Run after `seed-rich-demo.ts`:
 *   npx ts-node -P scripts/tsconfig.json --transpile-only scripts/snapshot-demo-periods.ts --apply
 */
import { PrismaClient } from '@prisma/client'
import { historicalChapterMonthRows, individualPeriodRows, chapterSeasonRows } from '../src/lib/competition-snapshots'
import 'dotenv/config'

const prisma = new PrismaClient()
const APPLY = process.argv.includes('--apply')

async function save(key: string, payload: unknown) {
  if (!APPLY) return
  await prisma.learningSnapshot.upsert({
    where: { key },
    update: { payload: JSON.parse(JSON.stringify(payload)), captured_at: new Date() },
    create: { key, kind: 'COMPETITION_RANKING', payload: JSON.parse(JSON.stringify(payload)), captured_at: new Date() },
  })
}

async function main() {
  const september = await prisma.competitionMonth.findUnique({ where: { key: '2026-09' } })
  if (!september) throw new Error('September competition month is missing')
  const asOf = september.ends_at

  const [member, lt, dna, chapters] = await Promise.all([
    individualPeriodRows(prisma, september.starts_at, asOf, 'MEMBER'),
    individualPeriodRows(prisma, september.starts_at, asOf, 'LT'),
    individualPeriodRows(prisma, september.starts_at, asOf, 'DNA'),
    historicalChapterMonthRows(prisma, september, asOf),
  ])
  const chapterState = chapters.some((row) => !row.kpiStatus) ? 'WAITING_KPI' : 'FINALIZED'
  const monthPayload = (group: string, items: unknown[]) => ({
    group, periodType: 'MONTH', period: september, state: 'FINALIZED', items,
  })
  await save(`ranking:MEMBER:${september.id}`, monthPayload('MEMBER', member))
  await save(`ranking:LT:${september.id}`, monthPayload('LT', lt))
  await save(`ranking:DNA:${september.id}`, monthPayload('DNA', dna))
  await save(`ranking:CHAPTER:${september.id}`, { group: 'CHAPTER', periodType: 'MONTH', period: september, state: chapterState, items: chapters })
  if (APPLY) await prisma.competitionMonth.update({ where: { id: september.id }, data: { state: 'CLOSED', closed_at: new Date() } })

  // Previous term snapshots (April–September 2026).
  const terms = await prisma.chapterCompetitionTerm.findMany({ where: { ends_at: { lte: new Date() } } })
  for (const term of terms) {
    const end = term.ends_at!
    for (const group of ['MEMBER', 'LT']) {
      const items = await individualPeriodRows(prisma, term.starts_at, end, group, term.chapter_id)
      await save(`ranking:${group}:${term.id}`, { group, periodType: 'TERM', period: term, state: 'FINALIZED', items })
    }
  }
  const seasons = await prisma.transferSeason.findMany({ where: { ends_at: { lte: new Date() } } })
  for (const season of seasons) {
    const memberItems = await individualPeriodRows(prisma, season.starts_at, season.ends_at, 'MEMBER', undefined, undefined, season.id)
    await save(`ranking:MEMBER:${season.id}`, { group: 'MEMBER', periodType: 'TERM', period: season, state: 'FINALIZED', items: memberItems })
    const ltItems = await individualPeriodRows(prisma, season.starts_at, season.ends_at, 'LT', undefined, undefined, season.id)
    await save(`ranking:LT:${season.id}`, { group: 'LT', periodType: 'TERM', period: season, state: 'FINALIZED', items: ltItems })
    const dnaItems = await individualPeriodRows(prisma, season.starts_at, season.ends_at, 'DNA')
    await save(`ranking:DNA:${season.id}`, { group: 'DNA', periodType: 'TERM', period: season, state: 'FINALIZED', items: dnaItems })
    const chapterResult = await chapterSeasonRows(prisma, season.id, new Date())
    await save(`ranking:CHAPTER:${season.id}`, { ...chapterResult, group: 'CHAPTER', periodType: 'TERM', period: season })
  }

  console.log(JSON.stringify({
    apply: APPLY,
    september: {
      member: member.length,
      lt: lt.length,
      dna: dna.length,
      chapterState,
      chapters: chapters.map((row) => ({ name: row.chapterName, score: row.score, eligible: row.eligible, qualified: row.at70Rate, kpi: row.kpiStatus, reasons: row.exclusionReasons })),
    },
    closedTerms: terms.length,
    closedSeasons: seasons.length,
  }, null, 2))
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1 })
  .finally(async () => {
    await prisma.$disconnect()
    process.exit(process.exitCode || 0)
  })
