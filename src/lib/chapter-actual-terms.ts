import { Prisma } from '@prisma/client'
import { actualTransferAt } from './transfer-windows'

/** Statistics only. No score or rank is assigned across competition intervals. */
export async function chapterActualTermRows(tx: Prisma.TransactionClient, at: Date, chapterId?: string | null, termId?: string | null) {
  const chapters = await tx.chapter.findMany({ where: chapterId ? { id: chapterId } : { status: 'ACTIVE' }, select: { id: true, name: true, created_at: true } })
  const terms = await tx.chapterCompetitionTerm.findMany({ where: { chapter_id: { in: chapters.map(c => c.id) }, ...(termId ? { id: termId } : { starts_at: { lte: at }, OR: [{ ends_at: null }, { ends_at: { gt: at } }] }) }, orderBy: { starts_at: 'desc' } })
  const transferRows = await tx.chapterReorganization.findMany({ where: { chapter_id: { in: chapters.map(c => c.id) }, status: 'APPLIED', applied_at: { lte: at } }, select: { chapter_id: true, effective_at: true, applied_at: true }, orderBy: { applied_at: 'desc' } })
  const transfers = transferRows
    .map((row) => ({ chapter_id: row.chapter_id, actualAt: actualTransferAt(row.effective_at, row.applied_at) }))
    .filter((row): row is { chapter_id: string; actualAt: Date } => Boolean(row.actualAt))
    .sort((a, b) => b.actualAt.getTime() - a.actualAt.getTime())
  const items = []
  for (const chapter of chapters) {
    const term = terms.find(t => t.chapter_id === chapter.id)
    if (termId && !term) continue
    // Founding is authoritative for the first actual term, including before cutover.
    const prior = transfers.find(t => t.chapter_id === chapter.id && (!term || t.actualAt <= term.starts_at))
    const startsAt = term?.season_id ? term.starts_at : prior?.actualAt || chapter.created_at
    const endsAt = term?.ends_at || null
    if (term && endsAt && endsAt <= at) {
      const saved = await tx.learningSnapshot.findUnique({ where: { key: `statistics:CHAPTER:${term.id}` } })
      const payload = saved?.payload as any
      items.push(payload && typeof payload.totalStars === 'number'
        ? { ...payload, rank: null, eligible: false, statisticsOnly: true, state: 'FINALIZED' }
        : { id: chapter.id, chapterId: chapter.id, name: chapter.name, termId: term.id, startsAt, endsAt, totalStars: null, rank: null, eligible: false, statisticsOnly: true, state: 'AWAITING_SNAPSHOT', exclusionReasons: ['SNAPSHOT_MISSING'] })
      continue
    }
    const where = { chapter_at_award_id: chapter.id, awarded_at: { gte: startsAt, lt: new Date(Math.min(endsAt?.getTime() ?? at.getTime(), at.getTime())) } }
    const [allocated, unallocated] = await Promise.all([
      tx.starLedger.aggregate({ where: { ...where, competition_month_id: { not: null } }, _sum: { amount: true }, _count: true }),
      tx.starLedger.aggregate({ where: { ...where, competition_month_id: null }, _sum: { amount: true }, _count: true }),
    ])
    items.push({ id: chapter.id, chapterId: chapter.id, name: chapter.name, chapterName: chapter.name, termId: term?.id || null, startsAt, endsAt, totalStars: allocated._sum.amount || 0, unallocatedLegacyStars: unallocated._sum.amount || 0, unallocatedEntryCount: unallocated._count, ledgerEntryCount: allocated._count, rank: null, eligible: false, statisticsOnly: true })
  }
  return items
}

/** Capture at successful application, inside the same transaction as the reset. */
export async function captureChapterActualTerm(tx: Prisma.TransactionClient, chapterId: string, appliedAt: Date) {
  const [item] = await chapterActualTermRows(tx, appliedAt, chapterId)
  if (!item?.termId) return
  const key = `statistics:CHAPTER:${item.termId}`
  if (await tx.learningSnapshot.findUnique({ where: { key } })) return
  await tx.learningSnapshot.create({ data: { key, kind: 'CHAPTER_ACTUAL_TERM', captured_at: appliedAt, payload: JSON.parse(JSON.stringify({ ...item, endsAt: appliedAt, asOf: appliedAt })) } })
}
