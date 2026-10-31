import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { sendMemberInvitation } from '@/lib/invitations'
import { invalidateInvitationsServerCache } from '@/lib/server-cache'
import { resolveMemberInviteScope } from '@/lib/member-invite-scope'
import { isValidInviteEmail } from '@/lib/bulk-invite'

/**
 * POST /api/v1/invitations/member
 * Send invitation to a member.
 * Scoped organization managers may invite ordinary members into their unit.
 * Admin member invitations continue to use the separate Admin invitation flow.
 */
export async function POST(request: NextRequest) {
  const auth = await authenticate(request)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: 401 })
  }

  const context = auth.context!
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: { code: 'ValidationError' } }, { status: 400 })
  const scope = await resolveMemberInviteScope(context, body)
  if (scope.ok === false) return NextResponse.json({ error: scope.error }, { status: scope.status })
  const { chapterId, organizationUnitId } = scope

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''

  if (!isValidInviteEmail(email)) {
    return NextResponse.json(
      { error: { code: 'ValidationError', message: 'Email không hợp lệ' } },
      { status: 400 }
    )
  }

  const result = await sendMemberInvitation({
    email,
    role: 'MEMBER',
    chapterId,
    organizationUnitId,
    invitedBy: (auth as any).context!.userId,
  })

  if (!result.ok) {
    const statusMap: Record<string, number> = {
      EmailAlreadyActive: 400,
      AccessDenied: 403,
      ValidationError: 400,
    }
    return NextResponse.json(
      { error: { code: (result as any).code, message: (result as any).message } },
      { status: statusMap[(result as any).code] || 400 }
    )
  }

  invalidateInvitationsServerCache()

  return NextResponse.json(
    {
      invitationId: result.invitationId,
      id: result.invitationId,
      chapterId: result.chapterId || null,
      organizationUnitId: result.organizationUnitId || null,
      status: result.status,
      expiresAt: result.expiresAt.toISOString(),
      emailSent: result.emailSent,
      emailError: result.emailError,
    },
    { status: 201 }
  )
}
