import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { cancelInvitation } from '@/lib/invitations'
import { invalidateInvitationsServerCache } from '@/lib/server-cache'

export async function DELETE(request: NextRequest) {
  const auth = await authenticate(request)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: 401 })
  }

  const segment = request.nextUrl.pathname.split('/')
  const invitationId = segment[4] // /api/v1/invitations/[id]

  if (!invitationId) {
    return NextResponse.json({ error: { code: 'ValidationError', message: 'Thiếu invitationId' } }, { status: 400 })
  }

  const result = await cancelInvitation(invitationId, (auth as any).context!.userId, (auth as any).context!.role)

  if (!result.ok) {
    return NextResponse.json(
      { error: { code: (result as any).code, message: (result as any).message } },
      { status: (result as any).code === 'AccessDenied' ? 403 : 400 }
    )
  }

  invalidateInvitationsServerCache()

  return NextResponse.json({
    invitationId: result.invitationId,
    status: result.status,
  }, { status: 200 })
}