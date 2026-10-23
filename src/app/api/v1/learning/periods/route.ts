import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getLearningManagerKind } from '@/lib/manager-learning-access'
import { listAccessibleChapterIds, listManagedOrganizationUnits } from '@/lib/authorization'

export async function GET(request: NextRequest) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  const context = auth.context!
  const isAdmin = context.role === 'ADMIN'
  const managerKind = isAdmin ? null : await getLearningManagerKind(context.userId, context.role)

  let chapterFilter: string[] | null = null
  if (managerKind === 'LEAD_CHAPTER') {
    chapterFilter = await listAccessibleChapterIds(context, 'VIEW_MEMBER_PROGRESS')
    if (!chapterFilter.length && context.chapterId) chapterFilter = [context.chapterId]
  }
  let dnaUnitFilter: string[] | null = null
  if (managerKind === 'LEAD_DNA') {
    const units = await listManagedOrganizationUnits(context)
    dnaUnitFilter = units.filter((unit) => unit.type === 'DNA' || unit.type === 'DNA_GROUP').map((unit) => unit.id)
  }

  const [months, chapters] = await Promise.all([
    prisma.competitionMonth.findMany({ orderBy: { starts_at: 'desc' }, take: 60 }),
    prisma.chapter.findMany({ select: { id: true, name: true } }),
  ])
  const terms = managerKind === 'LEAD_DNA'
    ? []
    : await prisma.chapterCompetitionTerm.findMany({
        where: chapterFilter ? { chapter_id: { in: chapterFilter } } : undefined,
        orderBy: { starts_at: 'desc' },
        take: 200,
      })
  const seasons = managerKind === 'LEAD_CHAPTER'
    ? []
    : await prisma.transferSeason.findMany({ orderBy: { starts_at: 'desc' }, take: 30 })

  return NextResponse.json({
    months,
    terms: terms.map((term) => ({ ...term, chapterName: chapters.find((chapter) => chapter.id === term.chapter_id)?.name || 'Chapter' })),
    seasons,
    scope: {
      managerKind,
      chapterIds: chapterFilter,
      dnaUnitIds: dnaUnitFilter,
    },
  })
}
