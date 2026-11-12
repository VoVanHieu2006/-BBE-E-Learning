import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { issueInvitationLink } from '@/lib/invitations'
import { invalidateInvitationsServerCache } from '@/lib/server-cache'
import { prisma } from '@/lib/prisma'
import { canManageInvitationUnit } from '@/lib/invitation-management'
import { isOrganizationId } from '@/lib/organization-admin-rules'
import { buildInvitationUrl } from '@/lib/invitation-link'

const STATUS_BY_CODE: Record<string, number> = {
  AccessDenied: 403,
  InvitationNotFound: 404,
  InvalidState: 409,
  NotLinkDelivery: 409,
  RateLimited: 429,
}

/**
 * POST /api/v1/invitations/[id]/link
 * Tạo link mời mới (đổi token, link cũ hết hiệu lực) cho lời mời đang chờ và chưa hết hạn
 * mà chưa gửi được qua email. Cùng quyền với gửi lại / hủy lời mời. Link chỉ nằm trong phản hồi
 * này (không lưu, không log); client sao chép vào clipboard mà không hiển thị.
 */
export async function POST(request: NextRequest) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const invitationId = request.nextUrl.pathname.split('/')[4] // /api/v1/invitations/[id]/link
  if (!invitationId || !isOrganizationId(invitationId)) {
    return NextResponse.json({ error: { code: 'ValidationError', message: 'Thiếu hoặc sai invitationId' } }, { status: 400 })
  }

  const context = auth.context!
  if (context.role !== 'ADMIN') {
    const invitation = await prisma.invitation.findUnique({ where: { id: invitationId }, include: { chapter: { select: { organization_unit_id: true } } } })
    if (!invitation) return NextResponse.json({ error: { code: 'InvitationNotFound' } }, { status: 404 })
    const scopeUnitId = invitation.organization_unit_id || invitation.chapter?.organization_unit_id
    if (!scopeUnitId || !await canManageInvitationUnit(context, scopeUnitId)) {
      return NextResponse.json({ error: { code: 'AccessDenied' } }, { status: 403 })
    }
  }

  const result = await issueInvitationLink(invitationId, context.userId, context.role, context.role !== 'ADMIN')
  if (result.ok === false) {
    return NextResponse.json(
      { error: { code: result.code, message: result.message } },
      { status: STATUS_BY_CODE[result.code] || 400, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  invalidateInvitationsServerCache()
  return NextResponse.json(
    { invitationId: result.invitationId, expiresAt: result.expiresAt.toISOString(), link: buildInvitationUrl(result.token) },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  )
}
