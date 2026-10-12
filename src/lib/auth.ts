import { NextRequest } from 'next/server'
import { jwtVerify } from 'jose'
import { prisma } from './prisma'
import { resolveLegacyChapterMembershipScope } from './authorization-rules'

type UserRole = 'ADMIN' | 'CHAPTER_LEADER' | 'MEMBER';

export interface AuthContext {
  userId: string
  role: UserRole
  chapterId?: string
}

export interface AuthResult {
  ok: boolean
  context?: AuthContext
  error?: { code: string; message: string }
}

const secret = new TextEncoder().encode(process.env.JWT_ACCESS_SECRET || '')

interface CachedUser {
  id: string
  status: string
  role: UserRole
  chapterId?: string
  timestamp: number
}

// In-memory user active status cache (30s TTL) to avoid redundant remote DB round-trips
const userStatusCache = new Map<string, CachedUser>()
const USER_CACHE_TTL = 30000

export function invalidateUserAuthCache(userId?: string) {
  if (!userId) {
    userStatusCache.clear()
  } else {
    userStatusCache.delete(userId)
  }
}

async function getCurrentChapterScope(cached: CachedUser): Promise<string | undefined> {
  if (cached.role !== 'CHAPTER_LEADER') return cached.chapterId
  const membership = await prisma.chapterMember.findFirst({
    where: { user_id: cached.id },
    orderBy: { joined_at: 'asc' },
    select: { chapter_id: true },
  })
  return resolveLegacyChapterMembershipScope(membership ? [membership.chapter_id] : [])
}

/**
 * Extract and verify Bearer token from request.
 * Returns { ok, context } or { ok: false, error }.
 */
export async function authenticate(request: NextRequest): Promise<AuthResult> {
  const authHeader = request.headers.get('Authorization')
  let accessToken: string | undefined

  if (authHeader && authHeader.startsWith('Bearer ')) {
    accessToken = authHeader.slice(7)
  } else {
    accessToken = request.cookies.get('accessToken')?.value
  }

  // Fallback: If no accessToken, try refreshToken from cookies
  if (!accessToken) {
    const refreshToken = request.cookies.get('refreshToken')?.value
    if (refreshToken && process.env.JWT_REFRESH_SECRET) {
      try {
        const refreshSecret = new TextEncoder().encode(process.env.JWT_REFRESH_SECRET)
        const { payload } = await jwtVerify(refreshToken, refreshSecret)
        const userId = payload.sub as string
        if (userId) {
          const now = Date.now()
          const cached = userStatusCache.get(userId)
          if (cached && now - cached.timestamp < USER_CACHE_TTL && cached.status === 'ACTIVE') {
            return { ok: true, context: { userId: cached.id, role: cached.role, chapterId: await getCurrentChapterScope(cached) } }
          }
          const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, status: true, role: true, chapter_members: { take: 1, orderBy: { joined_at: 'asc' }, select: { chapter_id: true } } },
          })
          if (user && user.status === 'ACTIVE') {
            const chapterId = resolveLegacyChapterMembershipScope(user.chapter_members.map((member) => member.chapter_id))
            userStatusCache.set(userId, { id: user.id, status: user.status, role: user.role, chapterId, timestamp: now })
            return { ok: true, context: { userId: user.id, role: user.role, chapterId } }
          }
        }
      } catch {}
    }
    return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Missing or malformed Authorization header' } }
  }

  try {
    const { payload } = await jwtVerify(accessToken, secret)

    const userId = payload.sub as string

    // Check in-memory cache first
    const now = Date.now()
    const cached = userStatusCache.get(userId)
    if (cached && now - cached.timestamp < USER_CACHE_TTL) {
      if (cached.status !== 'ACTIVE') {
        return { ok: false, error: { code: 'AccountInactive', message: 'Tài khoản không hoạt động' } }
      }
      return { ok: true, context: { userId: cached.id, role: cached.role, chapterId: await getCurrentChapterScope(cached) } }
    }

    // Verify user exists and is ACTIVE
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, status: true, role: true, chapter_members: { take: 1, orderBy: { joined_at: 'asc' }, select: { chapter_id: true } } },
    })

    if (!user || user.status !== 'ACTIVE') {
      if (user) {
        userStatusCache.set(userId, { id: user.id, status: user.status, role: user.role, timestamp: now })
      }
      return { ok: false, error: { code: 'AccountInactive', message: 'Tài khoản không hoạt động' } }
    }

    const chapterId = resolveLegacyChapterMembershipScope(user.chapter_members.map((member) => member.chapter_id))
    userStatusCache.set(userId, { id: user.id, status: user.status, role: user.role, chapterId, timestamp: now })

    return { ok: true, context: { userId: user.id, role: user.role, chapterId } }
  } catch {
    // If accessToken verification failed, attempt silent fallback via refreshToken cookie
    const refreshToken = request.cookies.get('refreshToken')?.value
    if (refreshToken && process.env.JWT_REFRESH_SECRET) {
      try {
        const refreshSecret = new TextEncoder().encode(process.env.JWT_REFRESH_SECRET)
        const { payload } = await jwtVerify(refreshToken, refreshSecret)
        const userId = payload.sub as string
        if (userId) {
          const now = Date.now()
          const cached = userStatusCache.get(userId)
          if (cached && now - cached.timestamp < USER_CACHE_TTL && cached.status === 'ACTIVE') {
            return { ok: true, context: { userId: cached.id, role: cached.role, chapterId: await getCurrentChapterScope(cached) } }
          }
          const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, status: true, role: true, chapter_members: { take: 1, orderBy: { joined_at: 'asc' }, select: { chapter_id: true } } },
          })
          if (user && user.status === 'ACTIVE') {
            const chapterId = resolveLegacyChapterMembershipScope(user.chapter_members.map((member) => member.chapter_id))
            userStatusCache.set(userId, { id: user.id, status: user.status, role: user.role, chapterId, timestamp: now })
            return { ok: true, context: { userId: user.id, role: user.role, chapterId } }
          }
        }
      } catch {}
    }
    return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Token không hợp lệ hoặc đã hết hạn' } }
  }
}

/** Helper: assert that actor has permission for a chapter. */
export function assertChapterAccess(actor: AuthContext, chapterId: string, isAdmin: boolean): AuthResult {
  if (isAdmin) return { ok: true, context: actor }
  if (actor.chapterId === chapterId) return { ok: true, context: actor }
  return {
    ok: false,
    error: { code: 'AccessDenied', message: 'Không có quyền truy cập chapter này' },
  }
}

/** Helper: get chapterId from actor (throws if BĐHU accessing other chapter) */
export function resolveChapterScope(
  actor: AuthContext,
  requestedChapterId?: string
): { ok: true; chapterId: string } | { ok: false; error: { code: string; message: string } } {
  if (actor.role === 'ADMIN') {
    return { ok: true, chapterId: requestedChapterId || '' }
  }

  if (!actor.chapterId) {
    return { ok: false, error: { code: 'AccessDenied', message: 'Không có chapter được phân công' } }
  }
  if (requestedChapterId && requestedChapterId !== actor.chapterId) {
    return { ok: false, error: { code: 'AccessDenied', message: 'Không có quyền truy cập chapter khác' } }
  }
  return { ok: true, chapterId: actor.chapterId }
}
