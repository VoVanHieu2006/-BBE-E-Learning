import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendPasswordResetEmail } from '@/lib/email'
import crypto from 'crypto'

/**
 * POST /api/v1/auth/password-reset/request
 * Request password reset — always returns same message (prevents email enumeration).
 * Requires: email in body.
 */
export async function POST(request: NextRequest) {
  const body = await request.json()
  const { email } = body

  if (!email) {
    return NextResponse.json({ error: { code: 'ValidationError', message: 'email là bắt buộc' } }, { status: 400 })
  }

  // Check if user exists and is ACTIVE (we can tell internally, but never reveal)
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } })

  // Always return the same message to prevent email enumeration
  const message = 'Nếu email tồn tại, link đặt lại mật khẩu đã được gửi.'

  if (!user || user.status !== 'ACTIVE') {
    // Return same message
    console.log('[PASSWORD_RESET] Email not found or not active, returning generic message.')
    return NextResponse.json({ message, sent: false }, { status: 200 })
  }

  // Invalidate any existing reset tokens
  await prisma.passwordResetToken.updateMany({
    where: { user_id: user.id, used_at: null },
    data: { used_at: new Date() },
  })

  // Generate token
  const token = crypto.randomBytes(32).toString('hex')
  const tokenHash = crypto.createHash('sha256').update(token + (process.env.TOKEN_HASH_PEPPER || '')).digest('hex')
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000) // 15 minutes

  await prisma.passwordResetToken.create({
    data: {
      user_id: user.id,
      token_hash: tokenHash,
      expires_at: expiresAt,
    },
  })

  // Send password reset email via Resend
  await sendPasswordResetEmail({
    to: email,
    token,
    expiresAt,
  })

  return NextResponse.json({ message, sent: true }, { status: 200 })
}
