import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getPublishedSystemData, calculateBatchUsersProgress } from '@/lib/progress/calculator'
import {
  getUserQueryCache,
  setUserQueryCache,
  getServerMetadataCache,
  setServerMetadataCache,
} from '@/lib/server-cache'

const USER_QUERY_CACHE_TTL = 15000 // 15 seconds
const META_CACHE_TTL = 60000 // 60 seconds

async function getGlobalMetadata() {
  const cached = getServerMetadataCache(META_CACHE_TTL)
  if (cached) {
    return cached
  }

  const [
    totalMembers,
    totalLeaders,
    totalActive,
    totalInactive,
    publishedCourses,
  ] = await Promise.all([
    prisma.user.count({ where: { role: 'MEMBER' } }),
    prisma.user.count({ where: { role: 'CHAPTER_LEADER' } }),
    prisma.user.count({ where: { role: { not: 'ADMIN' }, status: 'ACTIVE' } }),
    prisma.user.count({ where: { role: { not: 'ADMIN' }, status: 'INACTIVE' } }),
    prisma.course.findMany({
      where: { status: 'PUBLISHED' },
      select: {
        id: true,
        sessions: {
          select: {
            lessons: { select: { id: true } },
          },
        },
      },
    }),
  ])

  const stats = {
    total: totalMembers + totalLeaders,
    active: totalActive,
    inactive: totalInactive,
    leaders: totalLeaders,
    members: totalMembers,
  }

  const metadata = { stats, publishedCourses }
  setServerMetadataCache(metadata)
  return metadata
}

/**
 * GET /api/v1/users
 * High-performance Admin account management endpoint
 */
export async function GET(request: NextRequest) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  if ((auth as any).context!.role !== 'ADMIN') {
    return NextResponse.json({ error: { code: 'AccessDenied', message: 'Chỉ Admin mới có quyền quản lý tài khoản' } }, { status: 403 })
  }

  const url = new URL(request.url)
  const search = url.searchParams.get('search') || ''
  const role = url.searchParams.get('role') || ''
  const status = url.searchParams.get('status') || ''
  const chapterId = url.searchParams.get('chapterId') || ''
  const page = Math.max(parseInt(url.searchParams.get('page') || '1', 10), 1)
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '20', 10), 1), 100)
  const skip = (page - 1) * limit

  // Check query cache
  const cacheKey = `${search}:${role}:${status}:${chapterId}:${page}:${limit}`
  const cached = getUserQueryCache(cacheKey, USER_QUERY_CACHE_TTL)
  if (cached) {
    return NextResponse.json(cached, {
      status: 200,
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    })
  }

  // Exclude ADMIN users from the management table (only manage BĐHU & Members)
  const where: any = {
    role: { not: 'ADMIN' },
  }

  if (search) {
    where.email = { contains: search, mode: 'insensitive' }
  }

  if (role && ['CHAPTER_LEADER', 'MEMBER'].includes(role)) {
    where.role = role
  }

  if (status && ['ACTIVE', 'INACTIVE', 'LOCKED'].includes(status)) {
    where.status = status
  }

  if (chapterId) {
    where.chapter_members = {
      some: { chapter_id: chapterId },
    }
  }

  const [
    [users, totalFiltered],
    { stats, publishedCourses },
  ] = await Promise.all([
    Promise.all([
      prisma.user.findMany({
        where,
        include: {
          chapter_members: {
            take: 1,
            include: {
              chapter: {
                select: { id: true, name: true },
              },
            },
          },
        },
        orderBy: { created_at: 'desc' },
        skip,
        take: limit,
      }),
      prisma.user.count({ where }),
    ]),
    getGlobalMetadata(),
  ])

  const sys = await getPublishedSystemData()
  const memberUserIds = users.filter((u) => u.role !== 'CHAPTER_LEADER').map((u) => u.id)
  const progressMap = await calculateBatchUsersProgress(memberUserIds, sys)

  const items = users.map((u) => {
    const isLeader = u.role === 'CHAPTER_LEADER'
    const p = progressMap.get(u.id)

    const completedCoursesCount = isLeader ? sys.totalCourses : (p?.completedCourses || 0)
    const completedLessonsCount = isLeader ? sys.totalLessons : (p?.completedLessons || 0)
    const avgProgress = isLeader ? 100 : (p?.overallProgressPercent || 0)
    const avgCourseProgress = isLeader ? 100 : (p?.avgCourseProgressPercent || 0)
    const avgScore = isLeader ? 100 : (p?.avgQuizScore || 0)
    const leaderboardPoint = isLeader ? 100 : (p?.leaderboardPoint || 0)

    const primaryChapter = u.chapter_members?.[0]?.chapter

    return {
      userId: u.id,
      id: u.id,
      email: u.email,
      role: u.role,
      status: u.status,
      createdAt: u.created_at,
      chapter: primaryChapter
        ? { chapterId: primaryChapter.id, id: primaryChapter.id, name: primaryChapter.name }
        : null,
      completedCourses: completedCoursesCount,
      totalCourses: sys.totalCourses,
      completedLessons: completedLessonsCount,
      totalLessons: sys.totalLessons,
      avgProgress,
      avgCourseProgress,
      avgQuizScore: avgScore,
      leaderboardPoint,
    }
  })

  const responsePayload = {
    items,
    totalItems: totalFiltered,
    totalPages: Math.ceil(totalFiltered / limit),
    page,
    limit,
    stats,
    totalLessonsSystem: sys.totalLessons,
    totalCoursesSystem: sys.totalCourses,
  }

  setUserQueryCache(cacheKey, responsePayload)

  return NextResponse.json(
    responsePayload,
    {
      status: 200,
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    }
  )
}
