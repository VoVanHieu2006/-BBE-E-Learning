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
    where: { status: 'ACTIVE', role: 'MEMBER', OR: memberScope },
    select: { id: true, email: true },
    take: 500,
  })

  const memberIds = members.map((member) => member.id)
  if (!memberIds.length) return NextResponse.json({ chapterId: chapter.id, items: [] })

  const [system, starRows] = await Promise.all([
    getPublishedSystemData(),
    prisma.starLedger.groupBy({ where: { user_id: { in: memberIds } }, by: ['user_id'], _sum: { amount: true } }),
  ])
  const progressMap = await calculateBatchUsersProgress(memberIds, system)
  const starsByUser = new Map(starRows.map((row) => [row.user_id, row._sum.amount || 0]))

  const items = members.map((member) => {
    const progress = progressMap.get(member.id)
    return {
      userId: member.id,
      email: member.email,
      stars: starsByUser.get(member.id) || 0,
      completedLessons: progress?.completedLessons || 0,
      totalLessons: system.totalLessons,
      completedCourses: progress?.completedCourses || 0,
      totalCourses: system.totalCourses,
      courseProgress: progress?.overallProgressPercent || 0,
      avgScore: progress?.avgQuizScore || 0,
      avgQuizScore: progress?.avgQuizScore || 0,
    }
  }).sort((a, b) => b.stars - a.stars || b.courseProgress - a.courseProgress || b.avgQuizScore - a.avgQuizScore)

  return NextResponse.json({ chapterId: chapter.id, items })
}
