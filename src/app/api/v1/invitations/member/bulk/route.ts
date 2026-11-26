import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { sendMemberInvitation } from '@/lib/invitations'
import { invalidateInvitationsServerCache } from '@/lib/server-cache'
import { resolveMemberInviteScope } from '@/lib/member-invite-scope'
import { canManageInvitation } from '@/lib/invitation-management'
import { checkSingleHolderInvite } from '@/lib/president-invite'
import { departmentLeadEmailCountError, presidentEmailCountError, replaceConfirmed } from '@/lib/member-invite-position'
import { releaseEmailSlots, reserveEmailSlots } from '@/lib/email-quota'
import { splitBatchByQuota, unusedSlots } from '@/lib/email-quota-core'
import {
  BULK_INVITE_MAX_EMAILS, BULK_INVITE_TIME_BUDGET_MS, LEAD_EMAIL_NOT_IN_LIST_MESSAGE, LEAD_EMAIL_WITH_POSITION_MESSAGE,
  parseBulkInviteEmails, parseBulkLeadEmail, runBulkInvites, summarizeBulkResults, tagBulkLeadResult,
} from '@/lib/bulk-invite'

// Up to 50 emails are sent per call; allow the platform to keep the function alive long enough.
export const maxDuration = 60

/**
 * POST /api/v1/invitations/member/bulk
 * Body: { emails: string | string[], chapterId?, organizationUnitId?, position?, leadEmail?, confirmReplace? }
 * Mời Chủ tịch: danh sách phải có đúng 1 email (2 email trở lên → 400 PresidentSingleEmail, không gửi gì),
 * và cần xác nhận thay thế giống mời đơn khi Chapter đã có Chủ tịch. Mỗi ban chỉ 1 Trưởng ban nên
 * `position: DEPARTMENT_LEAD` cũng chỉ nhận đúng 1 email (400 DepartmentLeadSingleEmail) và cần xác nhận khi ban đã có Trưởng ban.
 * `leadEmail` (chỉ với thành viên ban, cần quyền cấp Chapter như mời Trưởng ban): email đó trong danh sách được mời làm
 * Trưởng ban, các email còn lại là thành viên ban. Phải là một email hợp lệ có trong danh sách (không phân biệt hoa-thường);
 * ban đã có Trưởng ban hoặc lời mời Trưởng ban khác → 409 DepartmentLeadReplaceConfirmRequired trước khi gửi bất kỳ email nào.
 * Invites many members at once with the same scope and permission rules as
 * /api/v1/invitations/member. Unlike a single re-invite, an email that already
 * has a live pending invitation is reported as ALREADY_INVITED and left untouched
 * (except `leadEmail`, whose pending invitation is replaced by the Trưởng ban invitation, like a single invite).
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

  const lead = parseBulkLeadEmail(body.leadEmail)
  if (lead.ok === false) return NextResponse.json({ error: { code: lead.code, message: lead.message } }, { status: 400 })
  const leadEmail = lead.email

  const scope = await resolveMemberInviteScope(context, body)
  if (scope.ok === false) return NextResponse.json({ error: scope.error }, { status: scope.status })
  if (leadEmail) {
    if (scope.positionCode) return NextResponse.json({ error: { code: 'LeadEmailWithPosition', message: LEAD_EMAIL_WITH_POSITION_MESSAGE } }, { status: 400 })
    // Cùng luật với mời Trưởng ban một email: đích phải là một ban (không phải nhóm DNA) và người mời có quyền cấp Chapter.
    const leadScope = await resolveMemberInviteScope(context, { ...body, position: 'DEPARTMENT_LEAD' })
    if (leadScope.ok === false) return NextResponse.json({ error: leadScope.error }, { status: leadScope.status })
  }

  const { valid, invalid, duplicates } = parseBulkInviteEmails(raw)
  if (!valid.length && !invalid.length) {
    return NextResponse.json({ error: { code: 'ValidationError', message: 'Chưa có email nào trong danh sách.' } }, { status: 400 })
  }
  if (valid.length + invalid.length > BULK_INVITE_MAX_EMAILS) {
    return NextResponse.json({ error: { code: 'TooManyEmails', message: `Mỗi lần chỉ mời tối đa ${BULK_INVITE_MAX_EMAILS} email.` } }, { status: 400 })
  }
  if (leadEmail && !valid.includes(leadEmail)) {
    return NextResponse.json({ error: { code: 'LeadEmailNotInList', message: LEAD_EMAIL_NOT_IN_LIST_MESSAGE } }, { status: 400 })
  }
  if (scope.positionCode) {
    // Kiểm tra trên toàn bộ danh sách (kể cả email sai định dạng) trước khi gửi bất kỳ lời mời nào.
    const count = valid.length + invalid.length
    const tooMany = scope.positionCode === 'PRESIDENT' ? presidentEmailCountError('PRESIDENT', count) : departmentLeadEmailCountError(count)
    if (tooMany) return NextResponse.json({ error: { code: scope.positionCode === 'PRESIDENT' ? 'PresidentSingleEmail' : 'DepartmentLeadSingleEmail', message: tooMany } }, { status: 400 })
    if (valid.length === 1) {
      const check = await checkSingleHolderInvite(scope.organizationUnitId!, scope.positionCode, valid[0], replaceConfirmed(body, scope.positionCode))
      if (check.ok === false) return NextResponse.json({ error: check.error }, { status: check.status })
    }
  }

  const now = new Date()
  const [existingUsers, pendingInvitations] = await Promise.all([
    prisma.user.findMany({ where: { email: { in: valid } }, select: { email: true } }),
    prisma.invitation.findMany({ where: { email: { in: valid }, status: 'PENDING', expires_at: { gt: now } }, select: { email: true } }),
  ])
  const hasAccount = new Set(existingUsers.map((row) => row.email.toLowerCase()))
  const hasPending = new Set(pendingInvitations.map((row) => row.email.toLowerCase()))
  if (leadEmail) {
    // Email LT đã có tài khoản thì không lời mời LT nào được tạo (báo ALREADY_MEMBER), nên không cần cảnh báo.
    if (!hasAccount.has(leadEmail)) {
      const check = await checkSingleHolderInvite(scope.organizationUnitId!, 'DEPARTMENT_LEAD', leadEmail, replaceConfirmed(body, 'DEPARTMENT_LEAD'))
      if (check.ok === false) return NextResponse.json({ error: check.error }, { status: check.status })
    }
    // Chọn LT là chủ ý đổi vai: lời mời đang chờ của email đó được thay như mời một email (không báo ALREADY_INVITED).
    hasPending.delete(leadEmail)
  }

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
          positionCode: email === leadEmail ? 'DEPARTMENT_LEAD' : scope.positionCode,
          canManagePending: (pending) => canManageInvitation(context, pending),
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
  results = tagBulkLeadResult(results, leadEmail)
  const sentAny = results.some((row) => row.status === 'SENT' || row.status === 'LINK_NEEDED')

  if (sentAny) invalidateInvitationsServerCache()

  return NextResponse.json({ results, summary: summarizeBulkResults(results) })
}
