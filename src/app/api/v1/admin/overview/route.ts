import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getAdminOverviewCache, setAdminOverviewCache } from '@/lib/server-cache'

const SERVER_CACHE_TTL = 15000 // 15 seconds

/**
 * GET /api/v1/admin/overview
 * High-performance system overview statistics with fast grouped aggregations and cache
 */
export async function GET(request: NextRequest) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  if ((auth as any).context!.role !== 'ADMIN') {
    return NextResponse.json({ error: { code: 'AccessDenied', message: 'Chỉ Admin mới có quyền xem tổng quan hệ thống' } }, { status: 403 })
  }

  const cached = getAdminOverviewCache(SERVER_CACHE_TTL)
  if (cached) {
    return NextResponse.json(cached, {
      status: 200,
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    })
  }

  const [
    chapterCount,
    userGroups,
    courseGroups,
    totalLessons,
    completedProgressCount,
    totalProgressCount,
  ] = await Promise.all([
    prisma.chapter.count({ where: { status: 'ACTIVE' } }),
    prisma.user.groupBy({
      by: ['status'],
      _count: true,
    }),
    prisma.course.groupBy({
      by: ['status'],
      _count: true,
    }),
    prisma.lesson.count({ where: { session: { course: { status: 'PUBLISHED' } } } }),
    prisma.lessonProgress.count({ where: { completed: true } }),
    prisma.lessonProgress.count(),
  ])

  let activeUsers = 0
  let inactiveUsers = 0
  let lockedUsers = 0
  for (const ug of userGroups) {
    if (ug.status === 'ACTIVE') activeUsers = ug._count
    else if (ug.status === 'INACTIVE') inactiveUsers = ug._count
    else if (ug.status === 'LOCKED') lockedUsers = ug._count
  }

  let draftCourses = 0
  let publishedCourses = 0
  for (const cg of courseGroups) {
    if (cg.status === 'DRAFT') draftCourses = cg._count
    else if (cg.status === 'PUBLISHED') publishedCourses = cg._count
  }

  let avgCompletionRate = 0
  if (totalProgressCount > 0) {
    avgCompletionRate = Math.round((completedProgressCount / totalProgressCount) * 100) / 100
  }

  const resultData = {
    chapterCount,
    accountStats: {
      active: activeUsers,
      inactive: inactiveUsers,
      locked: lockedUsers,
      total: activeUsers + inactiveUsers + lockedUsers,
    },
    courseStats: {
      draft: draftCourses,
      published: publishedCourses,
      total: draftCourses + publishedCourses,
    },
    avgCompletionRate,
    totalLessons,
  }

  setAdminOverviewCache(resultData)

  return NextResponse.json(resultData, {
    status: 200,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  })
}
