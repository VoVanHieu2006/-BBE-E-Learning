import { NextRequest } from 'next/server'
import { jwtVerify } from 'jose'
import { prisma } from './prisma'

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

/**
 * Extract and verify Bearer token from request.
 * Returns { ok, context } or { ok: false, error }.
 */
export async function authenticate(request: NextRequest): Promise<AuthResult> {
  const authHeader = request.headers.get('Authorization')

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Missing or malformed Authorization header' } }
  }

  const accessToken = authHeader.slice(7)

  try {
    const { payload } = await jwtVerify(accessToken, secret)

    const userId = payload.sub as string
    const role = payload.role as UserRole
    const chapterId = payload.chapterId as string | undefined

    // Check in-memory cache first
    const now = Date.now()
    const cached = userStatusCache.get(userId)
    if (cached && now - cached.timestamp < USER_CACHE_TTL) {
      if (cached.status !== 'ACTIVE') {
        return { ok: false, error: { code: 'AccountInactive', message: 'Tài khoản không hoạt động' } }
      }
      return { ok: true, context: { userId: cached.id, role: cached.role, chapterId } }
    }

    // Verify user exists and is ACTIVE
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, status: true, role: true },
    })

    if (!user || user.status !== 'ACTIVE') {
      if (user) {
        userStatusCache.set(userId, { id: user.id, status: user.status, role: user.role, timestamp: now })
      }
      return { ok: false, error: { code: 'AccountInactive', message: 'Tài khoản không hoạt động' } }
    }

    userStatusCache.set(userId, { id: user.id, status: user.status, role: user.role, timestamp: now })

    return { ok: true, context: { userId: user.id, role: user.role, chapterId } }
  } catch {
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
