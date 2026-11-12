import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { sendMemberInvitation } from '@/lib/invitations'
import { invalidateInvitationsServerCache } from '@/lib/server-cache'
import { resolveMemberInviteScope } from '@/lib/member-invite-scope'
import { releaseEmailSlots, reserveEmailSlots } from '@/lib/email-quota'
import { splitBatchByQuota, unusedSlots } from '@/lib/email-quota-core'
import { BULK_INVITE_MAX_EMAILS, BULK_INVITE_TIME_BUDGET_MS, parseBulkInviteEmails, runBulkInvites, summarizeBulkResults } from '@/lib/bulk-invite'

// Up to 50 emails are sent per call; allow the platform to keep the function alive long enough.
export const maxDuration = 60

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

  // Hạn mức email: đặt chỗ nguyên tử TRƯỚC khi gửi (xem reserveEmailSlots), tối đa số slot còn lại.
  // Các email còn lại vẫn được mời nhưng bỏ qua mail và giao bằng link (trạng thái LINK_NEEDED).
  const candidates = valid.filter((email) => !hasAccount.has(email) && !hasPending.has(email))
  const reservation = await reserveEmailSlots(candidates.length)
  const mailSet = new Set(splitBatchByQuota(candidates, reservation.granted).email)
  const consumed = new Set<string>()

  // Limited parallelism + a time budget (see runBulkInvites): one slow or failing
  // email never blocks or breaks the rest, and the request answers before timing out.
  let results
  try {
    results = await runBulkInvites({ valid, invalid, duplicates }, {
      hasAccount,
      hasPending,
      deadline: Date.now() + BULK_INVITE_TIME_BUDGET_MS,
      send: async (email) => {
        const result = await sendMemberInvitation({
          email, role: 'MEMBER', chapterId: scope.chapterId, organizationUnitId: scope.organizationUnitId, invitedBy: context.userId,
          mail: mailSet.has(email) ? { kind: 'reserved', day: reservation.day } : { kind: 'link' },
        })
        // Slot đã giao cho một lời mời được tạo thì email.ts lo giữ/hoàn; các slot còn lại hoàn ở dưới.
        if (result.ok && mailSet.has(email)) consumed.add(email)
        return result
      },
    })
  } finally {
    await releaseEmailSlots(reservation.day, unusedSlots(reservation.granted, consumed.size))
  }
  const sentAny = results.some((row) => row.status === 'SENT' || row.status === 'LINK_NEEDED')

  if (sentAny) invalidateInvitationsServerCache()

  return NextResponse.json({ results, summary: summarizeBulkResults(results) })
}
