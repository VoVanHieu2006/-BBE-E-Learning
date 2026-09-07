import { NextRequest, NextResponse } from 'next/server'
import { acceptInvitation } from '@/lib/invitations'

/**
 * POST /api/v1/invitations/accept
 * Public endpoint — no authentication required.
 * Accepts invitation by token and creates user account.
 */
export async function POST(request: NextRequest) {
  const body = await request.json()
  const { token, password, confirmPassword } = body

  // Validation
  if (!token || !password) {
    return NextResponse.json(
      { error: { code: 'ValidationError', message: 'token và password là bắt buộc' } },
      { status: 400 }
    )
  }

  if (password !== confirmPassword) {
    return NextResponse.json(
      { error: { code: 'PasswordMismatch', message: 'Mật khẩu không trùng' } },
      { status: 400 }
    )
  }

  // Weak password check
  if (password.length < 8) {
    return NextResponse.json(
      { error: { code: 'WeakPassword', message: 'Mật khẩu phải từ 8 ký tự trở lên' } },
      { status: 400 }
    )
  }

  const result = await acceptInvitation(token, password)

  if (!result.ok) {
    const statusMap: Record<string, number> = {
      InvitationNotFound: 404,
      TokenExpired: 410,
      TokenAlreadyUsed: 409,
      PasswordMismatch: 400,
      WeakPassword: 400,
    }
    return NextResponse.json(
      { error: { code: (result as any).code, message: (result as any).message } },
      { status: statusMap[(result as any).code] || 400 }
    )
  }

  return NextResponse.json({
    userId: result.userId,
    email: result.email,
    role: result.role,
    status: result.status,
  }, { status: 200 })
}