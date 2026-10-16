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
  const compact = url.searchParams.get('compact') === '1'
  const page = Math.max(parseInt(url.searchParams.get('page') || '1', 10), 1)
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '20', 10), 1), 100)
  const skip = (page - 1) * limit
  const now = new Date()

  // Check query cache
  const cacheKey = `${search}:${role}:${status}:${chapterId}:${compact}:${page}:${limit}`
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
    where.OR = [
      { email: { contains: search, mode: 'insensitive' } },
      { display_name: { contains: search, mode: 'insensitive' } },
    ]
  }

  if (role && ['CHAPTER_LEADER', 'MEMBER'].includes(role)) {
    where.role = role
  } else if (role === 'DNA_LEAD' || role === 'LT') {
    where.position_assignments = {
      some: {
        position: { code: role === 'DNA_LEAD' ? 'DNA_LEAD' : { in: ['DEPARTMENT_LEAD', 'LT'] } },
        starts_at: { lte: now },
        OR: [{ ends_at: null }, { ends_at: { gt: now } }],
      },
    }
  } else if (role === 'DNA') {
    where.organization_memberships = {
      some: {
        status: 'ACTIVE',
        starts_at: { lte: now },
        OR: [{ ends_at: null }, { ends_at: { gt: now } }],
        unit: { type: { in: ['DNA', 'DNA_GROUP'] } },
      },
    }
  }

  if (status && ['ACTIVE', 'INACTIVE', 'LOCKED'].includes(status)) {
    where.status = status
  }

  if (chapterId) {
    where.chapter_members = {
      some: { chapter_id: chapterId },
    }
  }

  // Picker mode avoids progress, assessment and global-stat queries. It is
  // used by organization forms that only need identity fields.
  if (compact) {
    const [items, totalItems] = await Promise.all([
      prisma.user.findMany({
        where,
        select: { id: true, email: true, display_name: true, role: true, status: true },
        orderBy: [{ display_name: 'asc' }, { email: 'asc' }],
        skip,
        take: limit,
      }),
      prisma.user.count({ where }),
    ])
    return NextResponse.json({
      items: items.map((user) => ({ userId: user.id, id: user.id, email: user.email, displayName: user.display_name, role: user.role, status: user.status })),
      totalItems,
      totalPages: Math.ceil(totalItems / limit),
      page,
      limit,
    }, { headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=120' } })
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
          position_assignments: {
            where: { starts_at: { lte: now }, OR: [{ ends_at: null }, { ends_at: { gt: now } }] },
            select: {
              is_primary: true,
              position: { select: { code: true, name: true, scope: true } },
              unit: { select: { id: true, name: true, type: true } },
            },
            orderBy: { is_primary: 'desc' },
          },
          organization_memberships: {
            where: { status: 'ACTIVE', starts_at: { lte: now }, OR: [{ ends_at: null }, { ends_at: { gt: now } }] },
            select: { unit: { select: { id: true, name: true, type: true, parent: { select: { id: true, name: true, type: true } } } } },
          },
          restrictions: {
            where: { lifted_at: null },
            select: { type: true },
            orderBy: { created_at: 'desc' },
            take: 1,
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

    const primaryChapter = u.chapter_members?.[0]?.chapter
    const department = u.organization_memberships.find(({ unit }) => unit.type === 'DEPARTMENT')?.unit
    const dnaMembership = u.organization_memberships.find(({ unit }) => unit.type === 'DNA' || unit.type === 'DNA_GROUP')?.unit

    return {
      userId: u.id,
      id: u.id,
      email: u.email,
      displayName: u.display_name,
      role: u.role,
      status: u.status,
      accountState: u.status === 'INACTIVE'
        ? 'INACTIVE'
        : u.restrictions[0]?.type === 'DEADLINE' || u.lock_reason === 'OVERDUE_LOCK'
          ? 'OVERDUE_LOCK'
          : u.status === 'LOCKED' || u.failed_login_count >= 10 || u.lock_reason === 'PASSWORD_LOCK'
            ? 'PASSWORD_LOCK'
            : 'ACTIVE',
      deactivatedByUserId: u.deactivated_by_user_id,
      deactivatedByRole: u.deactivated_by_role,
      deactivatedAt: u.deactivated_at,
      cascadeLeadId: u.cascade_lead_id,
      lockReason: u.lock_reason,
      effectivePositions: u.position_assignments.map((assignment) => ({
        code: assignment.position.code,
        name: assignment.position.name,
        scope: assignment.position.scope,
        unitId: assignment.unit.id,
        unitName: assignment.unit.name,
        unitType: assignment.unit.type,
        isPrimary: assignment.is_primary,
      })),
      createdAt: u.created_at,
      chapter: primaryChapter
        ? { chapterId: primaryChapter.id, id: primaryChapter.id, name: primaryChapter.name }
        : null,
      department: department ? { id: department.id, name: department.name } : null,
      dna: dnaMembership ? {
        active: true,
        name: dnaMembership.type === 'DNA' ? dnaMembership.name : dnaMembership.parent?.name,
        group: dnaMembership.type === 'DNA_GROUP' ? dnaMembership.name : null,
        role: u.position_assignments.some((assignment) => assignment.position.code === 'DNA_LEAD') ? 'Lead DNA' : 'Thành viên DNA',
      } : { active: false, name: null, group: null, role: null },
      completedCourses: completedCoursesCount,
      totalCourses: sys.totalCourses,
      completedLessons: completedLessonsCount,
      totalLessons: sys.totalLessons,
      avgProgress,
      avgCourseProgress,
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
