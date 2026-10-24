import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getLearningManagerKind } from '@/lib/manager-learning-access'
import { listAccessibleChapterIds, listManagedOrganizationUnits } from '@/lib/authorization'

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
    if (!chapterFilter.length && context.chapterId) chapterFilter = [context.chapterId]
  } else if (managerKind === 'LEAD_DNA') {
    allowedGroups = ['DNA']
    isGlobal = false
    const units = await listManagedOrganizationUnits(context)
    dnaUnitFilter = units.filter((unit) => unit.type === 'DNA' || unit.type === 'DNA_GROUP').map((unit) => unit.id)
  } else if (context?.role === 'MEMBER') {
    // Normal member: identify whether they belong to Chapter or DNA
    const now = new Date()
    const [chapterRow, dnaRow] = await Promise.all([
      prisma.chapterMember.findUnique({ where: { user_id: context.userId }, select: { chapter_id: true } }),
      prisma.organizationMembership.findFirst({
        where: {
          user_id: context.userId,
          status: 'ACTIVE',
          unit: { type: { in: ['DNA', 'DNA_GROUP'] } },
          starts_at: { lte: now },
          OR: [{ ends_at: null }, { ends_at: { gt: now } }],
        },
        select: { unit_id: true },
      }),
    ])

    if (dnaRow && !chapterRow) {
      allowedGroups = ['DNA']
      isGlobal = false
      dnaUnitFilter = [dnaRow.unit_id]
    } else {
      allowedGroups = ['MEMBER', 'LT']
      isGlobal = false
      const cid = chapterRow?.chapter_id || context.chapterId
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

  return NextResponse.json({
    months: monthsWithStatus,
    terms: terms.map((term) => ({ ...term, chapterName: chapters.find((chapter) => chapter.id === term.chapter_id)?.name || 'Chapter' })),
    seasons,
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
