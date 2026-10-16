import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { sendMemberInvitation } from '@/lib/invitations'
import { invalidateInvitationsServerCache } from '@/lib/server-cache'
import { canAccessChapterPermission } from '@/lib/authorization'
import { canAccessOrganizationUnitPermission, memberManagementPermission } from '@/lib/authorization'
import { prisma } from '@/lib/prisma'
import { isOrganizationId } from '@/lib/organization-admin-rules'

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

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
  const role = context.role
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: { code: 'ValidationError' } }, { status: 400 })
  const requestedChapterId = typeof body.chapterId === 'string' ? body.chapterId : undefined
  let chapterId = role === 'CHAPTER_LEADER' ? undefined : requestedChapterId
  let organizationUnitId: string | undefined
  if (body.organizationUnitId !== undefined) {
    if (role === 'ADMIN' || chapterId || (typeof body.chapterId === 'string' && body.chapterId.trim()) || !isOrganizationId(body.organizationUnitId)) {
      return NextResponse.json({ error: { code: 'ValidationError', message: 'Choose one valid organization unit scope.' } }, { status: 400 })
    }
    const unit = await prisma.organizationUnit.findUnique({ where: { id: body.organizationUnitId }, select: { id: true, type: true, status: true } })
    if (!unit || unit.status !== 'ACTIVE' || !['DNA', 'DNA_GROUP', 'CHAPTER', 'DEPARTMENT'].includes(unit.type)) {
      return NextResponse.json({ error: { code: 'OrganizationUnitNotFound' } }, { status: 404 })
    }
    if (!await canAccessOrganizationUnitPermission(context, unit.id, memberManagementPermission(unit.type))) {
      return NextResponse.json({ error: { code: 'AccessDenied' } }, { status: 403 })
    }
    organizationUnitId = unit.id
    chapterId = undefined
  }
  if (!organizationUnitId && role === 'CHAPTER_LEADER') chapterId = context.chapterId
  if (!chapterId && !organizationUnitId) {
    return NextResponse.json(
      { error: { code: 'AccessDenied', message: 'Tài khoản Lead Chapter chưa được phân công Chapter' } },
      { status: 403 }
    )
  }

  if (organizationUnitId && role === 'ADMIN') {
    return NextResponse.json({ error: { code: 'AccessDenied' } }, { status: 403 })
  }
  if (!organizationUnitId && role !== 'CHAPTER_LEADER' && (role === 'ADMIN' || !await canAccessChapterPermission(context, chapterId!, 'MANAGE_CHAPTER_MEMBERS'))) {
    return NextResponse.json({ error: { code: 'AccessDenied', message: 'Bạn không có quyền mời thành viên vào Chapter này.' } }, { status: 403 })
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''

  if (!email || email.length > 255 || !EMAIL_REGEX.test(email)) {
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
