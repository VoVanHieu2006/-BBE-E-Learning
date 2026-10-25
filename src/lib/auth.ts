import { NextRequest } from 'next/server'
import { jwtVerify } from 'jose'
import { prisma } from './prisma'
import { chapterLeadScope } from './chapter-lead'
import { hasActiveAffiliation } from './affiliation-access'

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

// Kept for mutation callers. Security state is now read from the database on every
// request, so revocation is immediate across server processes, not a local 30s TTL.
export function invalidateUserAuthCache(_userId?: string) {}

export async function authenticate(request: NextRequest): Promise<AuthResult> {
  const header = request.headers.get('Authorization')
  const accessToken = header?.startsWith('Bearer ') ? header.slice(7) : request.cookies.get('accessToken')?.value
  const refreshToken = request.cookies.get('refreshToken')?.value
  let userId: string | undefined
  if (accessToken) {
    try { userId = (await jwtVerify(accessToken, secret)).payload.sub } catch {}
  }
  if (!userId && refreshToken && process.env.JWT_REFRESH_SECRET) {
    try { userId = (await jwtVerify(refreshToken, new TextEncoder().encode(process.env.JWT_REFRESH_SECRET))).payload.sub } catch {}
  }
  if (!userId) return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Missing or invalid credentials' } }
  const user = await prisma.user.findUnique({ where: { id: userId }, select: {
    id: true, role: true, status: true, chapter_members: { select: { chapter_id: true } },
  } })
  if (!user || user.status !== 'ACTIVE' || !await hasActiveAffiliation(user.id, user.role)) {
    return { ok: false, error: { code: 'AccountInactive', message: 'Account is inactive or has no active affiliation' } }
  }
  const lead = await chapterLeadScope(user.id)
  const chapterId = lead.isLead ? lead.chapterId || undefined : user.chapter_members[0]?.chapter_id
  return { ok: true, context: { userId: user.id, role: user.role, chapterId } }
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
