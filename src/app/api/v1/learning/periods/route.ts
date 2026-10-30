import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getLearningManagerKind } from '@/lib/manager-learning-access'
import { listAccessibleChapterIds, listManagedOrganizationUnits } from '@/lib/authorization'
import { currentLearningAffiliation } from '@/lib/affiliation-access'
import { readLearningReadiness } from '@/lib/learning-readiness'
import { readinessForReason } from '@/lib/learning-readiness-rules'

export async function GET(request: NextRequest) {
  const auth = await authenticate(request).catch(() => ({ ok: false as const }))
  const context = auth.ok ? (auth as any).context : null
  const isGuest = !context
  const isAdmin = context?.role === 'ADMIN'
  const managerKind = isAdmin || isGuest ? null : await getLearningManagerKind(context.userId, context.role)

  let chapterFilter: string[] | null = null
  let dnaUnitFilter: string[] | null = null
  let allowedGroups: Array<'MEMBER' | 'LT' | 'DNA' | 'CHAPTER'> = ['MEMBER', 'LT', 'DNA', 'CHAPTER']
  let isGlobal = true

  if (isGuest || isAdmin) {
    allowedGroups = ['MEMBER', 'LT', 'DNA', 'CHAPTER']
    isGlobal = true
  } else if (managerKind === 'LEAD_CHAPTER') {
    allowedGroups = ['MEMBER', 'LT']
    isGlobal = false
    chapterFilter = await listAccessibleChapterIds(context, 'VIEW_MEMBER_PROGRESS')
  } else if (managerKind === 'LEAD_DNA') {
    allowedGroups = ['DNA']
    isGlobal = false
    const units = await listManagedOrganizationUnits(context)
    dnaUnitFilter = units.filter((unit) => unit.type === 'DNA' || unit.type === 'DNA_GROUP').map((unit) => unit.id)
  } else if (context?.role === 'MEMBER') {
    // Normal member: identify whether they belong to Chapter or DNA
    const affiliation = await currentLearningAffiliation(context.userId)

    if (affiliation.dnaUnitIds.length) {
      allowedGroups = ['DNA']
      isGlobal = false
      dnaUnitFilter = affiliation.dnaUnitIds
    } else {
      allowedGroups = ['MEMBER', 'LT']
      isGlobal = false
      const cid = affiliation.chapterId
      chapterFilter = cid ? [cid] : []
    }
  }

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

  const terms = !allowedGroups.some((g) => ['CHAPTER', 'MEMBER', 'LT'].includes(g))
    ? []
    : await prisma.chapterCompetitionTerm.findMany({
        where: chapterFilter ? { chapter_id: { in: chapterFilter } } : undefined,
        orderBy: { starts_at: 'desc' },
        take: 200,
      })

  const seasons = !allowedGroups.includes('DNA') && !allowedGroups.includes('CHAPTER')
    ? []
    : await prisma.transferSeason.findMany({ orderBy: { starts_at: 'desc' }, take: 30 })

  const now = new Date()
  const base = await readLearningReadiness(prisma, now)
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
    actualTerms: allowedGroups.includes('CHAPTER') ? terms.map(term => ({ ...term, chapterName: chapters.find(chapter => chapter.id === term.chapter_id)?.name || 'Chapter' })) : [],
    periodTypes: allowedGroups.includes('CHAPTER') ? ['MONTH', 'TERM', 'ACTUAL_TERM'] : ['MONTH', 'TERM'],
    scope: {
      role: isGuest ? 'GUEST' : context.role,
      managerKind,
      chapterIds: chapterFilter,
      dnaUnitIds: dnaUnitFilter,
      allowedGroups,
      isGlobal,
    },
  })
}
