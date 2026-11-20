import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendPasswordResetEmail } from '@/lib/email'
import crypto from 'crypto'
import { isPasswordLocked } from '@/lib/account-restriction-rules'

const RESET_COOLDOWN_MS = 60 * 1000 // at most one email per minute per account
const RESET_WINDOW_MS = 60 * 60 * 1000
const RESET_MAX_PER_WINDOW = 3 // and at most 3 per hour per account

/**
 * POST /api/v1/auth/password-reset/request
 * Request password reset — always returns same message (prevents email enumeration).
 * Requires: email in body.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const email = typeof body?.email === 'string' ? body.email : ''

  if (!email || email.length > 254) {
    return NextResponse.json({ error: { code: 'ValidationError', message: 'email là bắt buộc' } }, { status: 400 })
  }

  // Check if user exists and is ACTIVE or password-locked (we can tell internally, but never reveal)
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } })

  // Always return the same message to prevent email enumeration
  const message = 'Nếu email tồn tại, link đặt lại mật khẩu đã được gửi.'

  // Tài khoản bị khóa mật khẩu phải tự yêu cầu được mail đặt lại (đây là cách duy nhất để mở khóa này).
  if (!user || (user.status !== 'ACTIVE' && !isPasswordLocked(user))) {
    // Return same message
    console.log('[PASSWORD_RESET] Email not found or not active, returning generic message.')
    return NextResponse.json({ message }, { status: 200 })
  }

  // Throttle per account (counter lives in the DB so it holds across serverless instances):
  // anonymous spam must not burn the shared daily email quota or flood the inbox.
  // While throttled, the latest link already sent stays valid, so reply as if sent.
  const now = Date.now()
  const recentTokens = await prisma.passwordResetToken.findMany({
    where: { user_id: user.id, created_at: { gt: new Date(now - RESET_WINDOW_MS) } },
    select: { created_at: true },
    orderBy: { created_at: 'desc' },
    take: RESET_MAX_PER_WINDOW,
  })
  if (
    recentTokens.length >= RESET_MAX_PER_WINDOW ||
    (recentTokens[0] && now - recentTokens[0].created_at.getTime() < RESET_COOLDOWN_MS)
  ) {
    console.warn('[PASSWORD_RESET] Throttled reset request for an account.')
    return NextResponse.json({ message }, { status: 200 })
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

  return NextResponse.json({ message }, { status: 200 })
}
