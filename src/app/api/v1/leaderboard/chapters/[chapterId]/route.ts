import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { canAccessChapterPermission } from '@/lib/authorization'
import { getOrganizationUnitTreeIds } from '@/lib/learning-assignments'
import { prisma } from '@/lib/prisma'
import { calculateBatchUsersProgress, getPublishedSystemData } from '@/lib/progress/calculator'

/** Individual member standings are ordered by Star balance, with learning progress as tie-break. */
export async function GET(request: NextRequest, { params }: { params: { chapterId: string } }) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const chapter = await prisma.chapter.findUnique({ where: { id: params.chapterId }, select: { id: true, organization_unit_id: true } })
  if (!chapter) return NextResponse.json({ error: { code: 'ChapterNotFound', message: 'Không tìm thấy chapter' } }, { status: 404 })

  const context = auth.context!
  if (context.role !== 'ADMIN') {
    const unitIds = chapter.organization_unit_id ? await getOrganizationUnitTreeIds(chapter.organization_unit_id) : []
    const [hasProgressPermission, legacyMembership, organizationMembership] = await Promise.all([
      canAccessChapterPermission(context, chapter.id, 'VIEW_MEMBER_PROGRESS'),
      prisma.chapterMember.findFirst({ where: { chapter_id: chapter.id, user_id: context.userId }, select: { id: true } }),
      unitIds.length
        ? prisma.organizationMembership.findFirst({
            where: {
              user_id: context.userId,
              unit_id: { in: unitIds },
              status: 'ACTIVE',
              starts_at: { lte: new Date() },
              OR: [{ ends_at: null }, { ends_at: { gt: new Date() } }],
            },
            select: { id: true },
          })
        : Promise.resolve(null),
    ])
    if (!hasProgressPermission && !legacyMembership && !organizationMembership) {
      return NextResponse.json({ error: { code: 'AccessDenied', message: 'Không có quyền truy cập chapter này' } }, { status: 403 })
    }
  }

  const now = new Date()
  const unitIds = chapter.organization_unit_id ? await getOrganizationUnitTreeIds(chapter.organization_unit_id) : []
  const memberScope: any[] = [{ chapter_members: { some: { chapter_id: chapter.id } } }]
  if (unitIds.length) {
    memberScope.push({
      organization_memberships: {
        some: {
          unit_id: { in: unitIds },
          status: 'ACTIVE',
          starts_at: { lte: now },
          OR: [{ ends_at: null }, { ends_at: { gt: now } }],
        },
      },
    })
  }

  const members = await prisma.user.findMany({
    where: { status: 'ACTIVE', role: 'MEMBER', OR: memberScope, position_assignments: { none: { position: { code: 'DNA_LEAD' }, starts_at: { lte: now }, OR: [{ ends_at: null }, { ends_at: { gt: now } }] } } },
    select: { id: true, email: true, display_name: true },
    take: 500,
  })

  const memberIds = members.map((member) => member.id)
  if (!memberIds.length) return NextResponse.json({ chapterId: chapter.id, items: [] })

  const [system, starRows] = await Promise.all([
    getPublishedSystemData(),
    prisma.starLedger.findMany({ where: { user_id: { in: memberIds } }, select: { user_id: true, amount: true, awarded_at: true } }),
  ])
  const progressMap = await calculateBatchUsersProgress(memberIds, system)
  const starsByUser = new Map<string, number>()
  const achievedAtByUser = new Map<string, Date>()
  for (const row of starRows) {
    starsByUser.set(row.user_id, (starsByUser.get(row.user_id) || 0) + row.amount)
    if (row.amount > 0 && (!achievedAtByUser.has(row.user_id) || row.awarded_at > achievedAtByUser.get(row.user_id)!)) achievedAtByUser.set(row.user_id, row.awarded_at)
  }

  const items = members.map((member) => {
    const progress = progressMap.get(member.id)
    return {
      userId: member.id,
      email: member.email,
      displayName: member.display_name,
      stars: starsByUser.get(member.id) || 0,
      starsAchievedAt: achievedAtByUser.get(member.id)?.toISOString() || null,
      completedLessons: progress?.completedLessons || 0,
      totalLessons: system.totalLessons,
      completedCourses: progress?.completedCourses || 0,
      totalCourses: system.totalCourses,
      courseProgress: progress?.overallProgressPercent || 0,
      avgScore: progress?.avgQuizScore || 0,
      avgQuizScore: progress?.avgQuizScore || 0,
    }
  }).sort((a, b) => b.stars - a.stars || new Date(a.starsAchievedAt || 8640000000000000).getTime() - new Date(b.starsAchievedAt || 8640000000000000).getTime() || a.email.localeCompare(b.email))

  return NextResponse.json({ chapterId: chapter.id, items })
}
