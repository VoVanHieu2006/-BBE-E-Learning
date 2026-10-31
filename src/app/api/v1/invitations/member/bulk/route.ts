import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { sendMemberInvitation } from '@/lib/invitations'
import { invalidateInvitationsServerCache } from '@/lib/server-cache'
import { resolveMemberInviteScope } from '@/lib/member-invite-scope'
import { BULK_INVITE_MAX_EMAILS, BulkInviteResultItem, parseBulkInviteEmails } from '@/lib/bulk-invite'

/**
 * POST /api/v1/invitations/member/bulk
 * Body: { emails: string | string[], chapterId?, organizationUnitId? }
 * Invites many members at once with the same scope and permission rules as
 * /api/v1/invitations/member. Unlike a single re-invite, an email that already
 * has a live pending invitation is reported as ALREADY_INVITED and left untouched.
 */
export async function POST(request: NextRequest) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  const context = auth.context!

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: { code: 'ValidationError' } }, { status: 400 })
  const raw = Array.isArray(body.emails)
    ? body.emails.filter((value: unknown): value is string => typeof value === 'string').join('\n')
    : typeof body.emails === 'string' ? body.emails : ''

  const scope = await resolveMemberInviteScope(context, body)
  if (scope.ok === false) return NextResponse.json({ error: scope.error }, { status: scope.status })

  const { valid, invalid, duplicates } = parseBulkInviteEmails(raw)
  if (!valid.length && !invalid.length) {
    return NextResponse.json({ error: { code: 'ValidationError', message: 'Chưa có email nào trong danh sách.' } }, { status: 400 })
  }
  if (valid.length + invalid.length > BULK_INVITE_MAX_EMAILS) {
    return NextResponse.json({ error: { code: 'TooManyEmails', message: `Mỗi lần chỉ mời tối đa ${BULK_INVITE_MAX_EMAILS} email.` } }, { status: 400 })
  }

  const now = new Date()
  const [existingUsers, pendingInvitations] = await Promise.all([
    prisma.user.findMany({ where: { email: { in: valid } }, select: { email: true } }),
    prisma.invitation.findMany({ where: { email: { in: valid }, status: 'PENDING', expires_at: { gt: now } }, select: { email: true } }),
  ])
  const hasAccount = new Set(existingUsers.map((row) => row.email.toLowerCase()))
  const hasPending = new Set(pendingInvitations.map((row) => row.email.toLowerCase()))

  const results: BulkInviteResultItem[] = [
    ...invalid.map((email) => ({ email, status: 'INVALID' as const })),
    ...duplicates.map((email) => ({ email, status: 'DUPLICATE' as const })),
  ]
  let sentAny = false
  // Sequential on purpose: keeps email provider rate limits and DB load predictable.
  for (const email of valid) {
    if (hasAccount.has(email)) { results.push({ email, status: 'ALREADY_MEMBER' }); continue }
    if (hasPending.has(email)) { results.push({ email, status: 'ALREADY_INVITED' }); continue }
    try {
      const result = await sendMemberInvitation({
        email, role: 'MEMBER', chapterId: scope.chapterId, organizationUnitId: scope.organizationUnitId, invitedBy: context.userId,
      })
      if (result.ok === false) {
        const status = result.code === 'EmailAlreadyActive' || result.code === 'EmailAlreadyExists' ? 'ALREADY_MEMBER' : 'FAILED'
        results.push({ email, status, message: result.message })
        continue
      }
      sentAny = true
      results.push(result.emailSent
        ? { email, status: 'SENT' }
        : { email, status: 'SENT_EMAIL_FAILED', message: result.emailError || 'không rõ lý do' })
    } catch {
      results.push({ email, status: 'FAILED', message: 'Lỗi hệ thống khi tạo lời mời.' })
    }
  }

  if (sentAny) invalidateInvitationsServerCache()

  const count = (status: BulkInviteResultItem['status']) => results.filter((row) => row.status === status).length
  return NextResponse.json({
    results,
    summary: {
      total: results.length,
      sent: count('SENT') + count('SENT_EMAIL_FAILED'),
      emailFailed: count('SENT_EMAIL_FAILED'),
      invalid: count('INVALID'),
      duplicate: count('DUPLICATE'),
      alreadyMember: count('ALREADY_MEMBER'),
      alreadyInvited: count('ALREADY_INVITED'),
      failed: count('FAILED'),
    },
  })
}
