import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { sendMemberInvitation } from '@/lib/invitations'
import { invalidateInvitationsServerCache } from '@/lib/server-cache'

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * POST /api/v1/invitations/member
 * Send invitation to a member.
 * Only CHAPTER_LEADER is allowed to invite members into their chapter.
 * Admin cannot invite members (BA-01).
 */
export async function POST(request: NextRequest) {
  const auth = await authenticate(request)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: 401 })
  }

  const role = (auth as any).context!.role
  if (role !== 'CHAPTER_LEADER') {
    return NextResponse.json(
      {
        error: {
          code: 'AccessDenied',
          message: 'Chỉ Ban Định Hướng (BĐHU) mới có quyền gửi lời mời thành viên vào Chapter của mình',
        },
      },
      { status: 403 }
    )
  }

  const chapterId = (auth as any).context!.chapterId
  if (!chapterId) {
    return NextResponse.json(
      { error: { code: 'AccessDenied', message: 'Tài khoản BĐHU chưa được phân công Chapter' } },
      { status: 403 }
    )
  }

  const body = await request.json().catch(() => ({}))
  const { email } = body

  if (!email || !EMAIL_REGEX.test(email)) {
    return NextResponse.json(
      { error: { code: 'ValidationError', message: 'Email không hợp lệ' } },
      { status: 400 }
    )
  }

  const result = await sendMemberInvitation({
    email: email.toLowerCase().trim(),
    role: 'MEMBER',
    chapterId,
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
      chapterId: result.chapterId,
      status: result.status,
      expiresAt: result.expiresAt.toISOString(),
      emailSent: result.emailSent,
      emailError: result.emailError,
    },
    { status: 201 }
  )
}
