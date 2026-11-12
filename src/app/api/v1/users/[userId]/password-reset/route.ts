import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { sendPasswordResetEmail } from '@/lib/email'
import { canIssuePasswordResetLink, createPasswordResetToken } from '@/lib/password-reset-link'

/**
 * POST /api/v1/users/[userId]/password-reset (chỉ ADMIN): gửi email đặt lại mật khẩu.
 * Gửi mail không được (hết hạn mức, thiếu cấu hình, lỗi gửi) thì với tài khoản lấy được link trả 200 với
 * `emailSent: false, delivery: 'LINK'` để giao diện hiện nút lấy link (`.../password-reset/link`). Không bao giờ trả token/link ở đây.
 */
export async function POST(request: NextRequest, { params }: { params: { userId: string } }) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  if (auth.context?.role !== 'ADMIN') return NextResponse.json({ error: { code: 'AccessDenied', message: 'Chỉ Admin được gửi email đặt lại mật khẩu.' } }, { status: 403 })

  const user = await prisma.user.findUnique({ where: { id: params.userId }, select: { id: true, email: true, status: true, lock_reason: true } })
  if (!user) return NextResponse.json({ error: { code: 'UserNotFound', message: 'Không tìm thấy tài khoản.' } }, { status: 404 })

  const { token, expiresAt } = await createPasswordResetToken(user.id)
  let sent: { success: boolean; error?: string; quotaExhausted?: boolean }
  try {
    sent = await sendPasswordResetEmail({ to: user.email, token, expiresAt })
  } catch {
    sent = { success: false, error: 'Không gửi được email.' }
  }
  if (sent.success) {
    return NextResponse.json({ message: `Đã gửi link đặt lại mật khẩu đến ${user.email}.`, emailSent: true, delivery: 'EMAIL' })
  }

  const emailError = sent.error || 'Không gửi được email.'
  // Tài khoản không lấy được link (không hoạt động, không bị khóa mật khẩu): giữ lỗi cứng như trước.
  if (!canIssuePasswordResetLink(user)) {
    return NextResponse.json({ error: { code: 'EmailSendFailed', message: emailError } }, { status: 502 })
  }
  const reason = sent.quotaExhausted ? 'đã hết hạn mức email hôm nay.' : `${emailError.replace(/[.\s]+$/, '')}.`
  return NextResponse.json(
    {
      message: `Chưa gửi được email đến ${user.email}: ${reason} Hãy bấm "Link đặt lại mật khẩu" để lấy link và gửi trực tiếp cho người dùng.`,
      emailSent: false,
      emailError,
      quotaExhausted: Boolean(sent.quotaExhausted),
      delivery: 'LINK',
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
