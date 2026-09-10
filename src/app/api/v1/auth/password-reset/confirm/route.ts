import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'

/**
 * POST /api/v1/auth/password-reset/confirm
 * Confirm password reset with token.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const { token, newPassword, confirmPassword } = body

    if (!token || !newPassword || !confirmPassword) {
      return NextResponse.json({ error: { code: 'ValidationError', message: 'token, newPassword, confirmPassword bắt buộc' } }, { status: 400 })
    }

    if (newPassword !== confirmPassword) {
      return NextResponse.json({ error: { code: 'PasswordMismatch', message: 'Mật khẩu xác nhận không khớp' } }, { status: 400 })
    }

    if (newPassword.length < 8) {
      return NextResponse.json({ error: { code: 'WeakPassword', message: 'Mật khẩu phải từ 8 ký tự' } }, { status: 400 })
    }

    // Verify token
    const tokenHash = crypto.createHash('sha256').update(token + (process.env.TOKEN_HASH_PEPPER || '')).digest('hex')

    const resetRecord = await prisma.passwordResetToken.findUnique({
      where: { token_hash: tokenHash },
      include: { user: true },
    })

    if (!resetRecord) {
      return NextResponse.json({ error: { code: 'TokenExpired', message: 'Link đặt lại mật khẩu không hợp lệ hoặc đã hết hạn' } }, { status: 410 })
    }

    if (resetRecord.used_at) {
      return NextResponse.json({ error: { code: 'TokenAlreadyUsed', message: 'Link đã được sử dụng' } }, { status: 410 })
    }

    if (new Date() > resetRecord.expires_at) {
      return NextResponse.json({ error: { code: 'TokenExpired', message: 'Link đã hết hạn (15 phút)' } }, { status: 410 })
    }

    // Success — update password
    const passwordHash = await bcrypt.hash(newPassword, 12)

    // Use transaction: update password, set token used, reset failed_login, unlock if LOCKED
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: resetRecord.user_id },
        data: {
          password_hash: passwordHash,
          status: 'ACTIVE',
          failed_login_count: 0,
          locked_until: null,
        },
      })

      await tx.passwordResetToken.update({
        where: { id: resetRecord.id },
        data: { used_at: new Date() },
      })
    })

    console.log(`[AUTH] Password reset successful for user: ${resetRecord.user.email}`)

    return NextResponse.json({ success: true }, { status: 200 })
  } catch (err: any) {
    console.error('Error in /api/v1/auth/password-reset/confirm:', err)
    return NextResponse.json(
      { error: { code: 'ServerError', message: err?.message || 'Lỗi đặt lại mật khẩu tại máy chủ' } },
      { status: 500 }
    )
  }
}
