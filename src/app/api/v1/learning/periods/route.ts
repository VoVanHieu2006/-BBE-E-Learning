import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getLearningManagerKind } from '@/lib/manager-learning-access'
import { readLearningReadiness } from '@/lib/learning-readiness'
import { readinessForReason } from '@/lib/learning-readiness-rules'

export async function GET(request: NextRequest) {
  const auth = await authenticate(request).catch(() => ({ ok: false as const }))
  const context = auth.ok ? (auth as any).context : null
  const isGuest = !context
  const isAdmin = context?.role === 'ADMIN'
  const managerKind = isAdmin || isGuest ? null : await getLearningManagerKind(context.userId, context.role)

  // One shared leaderboard: guests and every signed-in role get the same boards and periods.
  const allowedGroups: Array<'MEMBER' | 'LT' | 'DNA' | 'CHAPTER'> = ['MEMBER', 'LT', 'DNA', 'CHAPTER']

  const [months, chapters, snapshots] = await Promise.all([
    prisma.competitionMonth.findMany({ orderBy: { starts_at: 'desc' }, take: 60 }),
    prisma.chapter.findMany({ select: { id: true, name: true } }),
    prisma.learningSnapshot.findMany({
      where: { key: { startsWith: 'ranking:' } },
      select: { key: true },
    }),
  ])
  const snapshotMonthIds = new Set(
    snapshots
      .map((s) => s.key.split(':')[2])
      .filter(Boolean),
  )
  const monthsWithStatus = months.map((m) => ({
    ...m,
    hasData: m.state === 'OPEN' || snapshotMonthIds.has(m.id),
  }))

  const terms = await prisma.chapterCompetitionTerm.findMany({ orderBy: { starts_at: 'desc' }, take: 200 })
  const seasons = await prisma.transferSeason.findMany({ orderBy: { starts_at: 'desc' }, take: 30 })

  const now = new Date()
  const base = await readLearningReadiness(now)
  const periodReadiness = {
    month: readinessForReason(months.some(month => month.starts_at <= now && month.ends_at > now) ? 'READY' : 'MONTH_NOT_CONFIGURED'),
    term: readinessForReason(terms.some(term => term.starts_at <= now && (!term.ends_at || term.ends_at > now)) ? 'READY' : 'TERM_NOT_CONFIGURED'),
    season: readinessForReason(seasons.some(season => season.starts_at <= now && season.ends_at > now) ? 'READY' : 'SEASON_NOT_CONFIGURED'),
  }
  const readiness = periodReadiness.month.ready ? base : { ...base, ...periodReadiness.month }

  return NextResponse.json({
    readiness: { ...readiness, periods: periodReadiness },
    months: monthsWithStatus,
    terms: terms.map((term) => ({ ...term, chapterName: chapters.find((chapter) => chapter.id === term.chapter_id)?.name || 'Chapter' })),
    seasons,
    actualTerms: terms.map(term => ({ ...term, chapterName: chapters.find(chapter => chapter.id === term.chapter_id)?.name || 'Chapter' })),
    periodTypes: ['MONTH', 'TERM', 'ACTUAL_TERM'],
    scope: {
      role: isGuest ? 'GUEST' : context.role,
      managerKind,
      chapterIds: null,
      dnaUnitIds: null,
      allowedGroups,
      isGlobal: true,
    },
  })
}
