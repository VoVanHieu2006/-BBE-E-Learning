import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { sendChapterLeaderInvitation } from '@/lib/invitations'
import { invalidateInvitationsServerCache } from '@/lib/server-cache'

/**
 * POST /api/v1/invitations/chapter-leader
 * Send invitation to a new Chapter Leader + create their chapter.
 * Requires: ADMIN role
 */
export async function POST(request: NextRequest) {
  // Authenticate
  const auth = await authenticate(request)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: 401 })
  }
  if ((auth as any).context!.role !== 'ADMIN') {
    return NextResponse.json({ error: { code: 'AccessDenied', message: 'Chỉ Admin được phép thực hiện' } }, { status: 403 })
  }

  // Parse body
  const body = await request.json().catch(() => ({}))
  const { email, chapterName, chapterDescription } = body

  // Validation
  if (!email || !chapterName) {
    return NextResponse.json(
      { error: { code: 'ValidationError', message: 'email và chapterName là bắt buộc' } },
      { status: 400 }
    )
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(email)) {
    return NextResponse.json(
      { error: { code: 'ValidationError', message: 'Email không hợp lệ' } },
      { status: 400 }
    )
  }

  if (chapterName.trim().length < 2 || chapterName.trim().length > 255) {
    return NextResponse.json(
      { error: { code: 'ValidationError', message: 'Tên chapter phải từ 2-255 ký tự' } },
      { status: 400 }
    )
  }

  const result = await sendChapterLeaderInvitation(
    email.toLowerCase().trim(),
    chapterName.trim(),
    chapterDescription?.trim(),
    (auth as any).context!.userId
  )

  if (!result.ok) {
    const statusMap: Record<string, number> = {
      EmailAlreadyActive: 400,
      ChapterNameConflict: 409,
      ValidationError: 400,
    }
    return NextResponse.json(
      { error: { code: (result as any).code, message: (result as any).message } },
      { status: statusMap[(result as any).code] || 400 }
    )
  }

  invalidateInvitationsServerCache()

  return NextResponse.json({
    invitationId: result.invitationId,
    chapterId: result.chapterId,
    status: result.status,
    expiresAt: result.expiresAt.toISOString(),
    emailSent: result.emailSent,
    emailError: result.emailError,
  }, { status: 201 })
}
