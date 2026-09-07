import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { getInvitations } from '@/lib/invitations'
import { getInvitationsServerCache, setInvitationsServerCache } from '@/lib/server-cache'

const INVITATIONS_CACHE_TTL = 10000

export async function GET(request: NextRequest) {
  const auth = await authenticate(request)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: 401 })
  }

  const url = new URL(request.url)
  const status = url.searchParams.get('status') as any
  const chapterId = url.searchParams.get('chapterId') || undefined
  const page = parseInt(url.searchParams.get('page') || '1', 10)
  const limit = parseInt(url.searchParams.get('limit') || '20', 10)

  if (page < 1) {
    return NextResponse.json({ error: { code: 'ValidationError', message: 'page >= 1' } }, { status: 400 })
  }
  const safeLimit = Math.min(Math.max(limit, 1), 100)

  let effectiveChapterId = chapterId
  if ((auth as any).context!.role === 'CHAPTER_LEADER') {
    effectiveChapterId = (auth as any).context!.chapterId
  } else if ((auth as any).context!.role === 'MEMBER') {
    return NextResponse.json({ error: { code: 'AccessDenied', message: 'Member không thể xem danh sách invitation' } }, { status: 403 })
  }

  const cacheKey = `${(auth as any).context!.userId}:${status || ''}:${effectiveChapterId || ''}:${page}:${safeLimit}`
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
    page,
    limit: safeLimit,
  })

  setInvitationsServerCache(cacheKey, result)

  return NextResponse.json(result, {
    status: 200,
    headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
  })
}
