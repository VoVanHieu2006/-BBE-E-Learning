import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { getInvitations } from '@/lib/invitations'
import { getInvitationsServerCache, setInvitationsServerCache } from '@/lib/server-cache'
import { canAccessChapterPermission, canAccessOrganizationUnitPermission } from '@/lib/authorization'
import { isOrganizationId } from '@/lib/organization-admin-rules'

const INVITATIONS_CACHE_TTL = 10000

export async function GET(request: NextRequest) {
  const auth = await authenticate(request)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: 401 })
  }

  const url = new URL(request.url)
  const status = url.searchParams.get('status') as any
  const chapterId = url.searchParams.get('chapterId') || undefined
  const requestedOrganizationUnitId = url.searchParams.get('organizationUnitId') || undefined
  const page = parseInt(url.searchParams.get('page') || '1', 10)
  const limit = parseInt(url.searchParams.get('limit') || '20', 10)

  if (page < 1) {
    return NextResponse.json({ error: { code: 'ValidationError', message: 'page >= 1' } }, { status: 400 })
  }
  const safeLimit = Math.min(Math.max(limit, 1), 100)

  let effectiveChapterId = chapterId
  let effectiveOrganizationUnitId = requestedOrganizationUnitId
  if (effectiveOrganizationUnitId) {
    if (!isOrganizationId(effectiveOrganizationUnitId)) return NextResponse.json({ error: { code: 'ValidationError' } }, { status: 400 })
    if ((auth as any).context!.role !== 'ADMIN' && !await canAccessOrganizationUnitPermission(auth.context!, effectiveOrganizationUnitId, 'MANAGE_CHAPTER_MEMBERS')) {
      return NextResponse.json({ error: { code: 'AccessDenied' } }, { status: 403 })
    }
  }
  if ((auth as any).context!.role === 'CHAPTER_LEADER') {
    if (requestedOrganizationUnitId) {
      effectiveChapterId = undefined
      effectiveOrganizationUnitId = requestedOrganizationUnitId
    } else {
      effectiveChapterId = (auth as any).context!.chapterId
      effectiveOrganizationUnitId = undefined
    }
  } else if ((auth as any).context!.role === 'MEMBER' && !effectiveOrganizationUnitId) {
    if (!effectiveChapterId || !await canAccessChapterPermission(auth.context!, effectiveChapterId, 'MANAGE_CHAPTER_MEMBERS')) {
      return NextResponse.json({ error: { code: 'AccessDenied', message: 'Bạn không có quyền quản lý lời mời trong Chapter này.' } }, { status: 403 })
    }
  } else if ((auth as any).context!.role !== 'ADMIN' && (auth as any).context!.role !== 'MEMBER') {
    return NextResponse.json({ error: { code: 'AccessDenied' } }, { status: 403 })
  }

  const cacheKey = `${(auth as any).context!.userId}:${status || ''}:${effectiveChapterId || ''}:${effectiveOrganizationUnitId || ''}:${page}:${safeLimit}`
  const cached = getInvitationsServerCache(cacheKey, INVITATIONS_CACHE_TTL)
  if (cached) {
    return NextResponse.json(cached, {
      status: 200,
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
    })
  }

  const result = await getInvitations({
    actorId: (auth as any).context!.userId,
    actorRole: (auth as any).context!.role,
    status: status || undefined,
    chapterId: effectiveChapterId,
    organizationUnitId: effectiveOrganizationUnitId,
    page,
    limit: safeLimit,
  })

  setInvitationsServerCache(cacheKey, result)

  return NextResponse.json(result, {
    status: 200,
    headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
  })
}
