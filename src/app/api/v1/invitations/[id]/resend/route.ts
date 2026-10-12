import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { resendInvitation } from '@/lib/invitations'
import { invalidateInvitationsServerCache } from '@/lib/server-cache'
import { prisma } from '@/lib/prisma'
import { canAccessOrganizationUnitPermission } from '@/lib/authorization'
import { isOrganizationId } from '@/lib/organization-admin-rules'

export async function POST(request: NextRequest) {
  const auth = await authenticate(request)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: 401 })
  }

  const segment = request.nextUrl.pathname.split('/')
  const invitationId = segment[4] // /api/v1/invitations/[id]/resend

  if (!invitationId) {
    return NextResponse.json({ error: { code: 'ValidationError', message: 'Thiếu invitationId' } }, { status: 400 })
  }

  if (!isOrganizationId(invitationId)) return NextResponse.json({ error: { code: 'ValidationError' } }, { status: 400 })
  const context = auth.context!
  if (context.role !== 'ADMIN') {
    const invitation = await prisma.invitation.findUnique({ where: { id: invitationId }, include: { chapter: { select: { organization_unit_id: true } } } })
    if (!invitation) return NextResponse.json({ error: { code: 'InvitationNotFound' } }, { status: 404 })
    const scopeUnitId = invitation.organization_unit_id || invitation.chapter?.organization_unit_id
    if (!scopeUnitId || !await canAccessOrganizationUnitPermission(context, scopeUnitId, 'MANAGE_CHAPTER_MEMBERS')) {
      return NextResponse.json({ error: { code: 'AccessDenied' } }, { status: 403 })
    }
  }
  const result = await resendInvitation(invitationId, context.userId, context.role, context.role !== 'ADMIN')

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
    expiresAt: result.expiresAt.toISOString(),
    emailSent: result.emailSent,
    emailError: result.emailError,
  }, { status: 200 })
}
