import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
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

  const userIds = users.map((u) => u.id)
  const totalPublishedCourses = publishedCourses.length

  // Parallel fetch progress and quiz scores only for the current page of users
  const [progressRecords, attempts] = await Promise.all([
    userIds.length > 0
      ? prisma.lessonProgress.findMany({
          where: {
            user_id: { in: userIds },
            completed: true,
          },
          select: {
            user_id: true,
            lesson_id: true,
          },
        })
      : [],
    userIds.length > 0
      ? prisma.attempt.findMany({
          where: {
            user_id: { in: userIds },
            status: { in: ['SUBMITTED', 'AUTO_SUBMITTED'] },
          },
          select: {
            user_id: true,
            score: true,
          },
        })
      : [],
  ])

  const completedSet = new Set(progressRecords.map((p) => `${p.user_id}:${p.lesson_id}`))

  const userScoresMap = new Map<string, { total: number; count: number }>()
  for (const a of attempts) {
    const cur = userScoresMap.get(a.user_id) || { total: 0, count: 0 }
    cur.total += Number(a.score || 0) * 100
    cur.count += 1
    userScoresMap.set(a.user_id, cur)
  }

  const items = users.map((u) => {
    const isLeader = u.role === 'CHAPTER_LEADER'
    let completedCoursesCount = 0
    let totalProgressSum = 0
    let completedLessonsCount = 0

    if (isLeader) {
      // BĐHU has full progress (100%) to view all content and guide members
      completedCoursesCount = totalPublishedCourses
      totalProgressSum = totalPublishedCourses * 100
      completedLessonsCount = publishedCourses.reduce(
        (acc, c) => acc + c.sessions.reduce((sAcc: number, s: any) => sAcc + s.lessons.length, 0),
        0
      )
    } else {
      for (const course of publishedCourses) {
        const lessonIds = course.sessions.flatMap((s: any) => s.lessons.map((l: any) => l.id))
        if (lessonIds.length === 0) continue

        let courseDoneLessons = 0
        for (const lId of lessonIds) {
          if (completedSet.has(`${u.id}:${lId}`)) {
            courseDoneLessons++
            completedLessonsCount++
          }
        }

        const courseProgress = (courseDoneLessons / lessonIds.length) * 100
        totalProgressSum += courseProgress

        if (courseDoneLessons === lessonIds.length) {
          completedCoursesCount++
        }
      }
    }

    const avgProgress = isLeader
      ? 100
      : totalPublishedCourses > 0
      ? Math.round(totalProgressSum / totalPublishedCourses)
      : 0

    const scoreInfo = userScoresMap.get(u.id)
    const avgScore = isLeader
      ? 100
      : scoreInfo && scoreInfo.count > 0
      ? Math.round(scoreInfo.total / scoreInfo.count)
      : 0

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
      totalCourses: totalPublishedCourses,
      completedLessons: completedLessonsCount,
      avgProgress,
      avgQuizScore: avgScore,
    }
  })

  const responsePayload = {
    items,
    totalItems: totalFiltered,
    totalPages: Math.ceil(totalFiltered / limit),
    page,
    limit,
    stats,
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
