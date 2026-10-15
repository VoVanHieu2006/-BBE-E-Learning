import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { generateToken, hashToken } from '@/lib/tokens'
import { sendPasswordResetEmail } from '@/lib/email'

export async function POST(request: NextRequest, { params }: { params: { userId: string } }) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  if (auth.context?.role !== 'ADMIN') return NextResponse.json({ error: { code: 'AccessDenied', message: 'Chỉ Admin được gửi email đặt lại mật khẩu.' } }, { status: 403 })

  const user = await prisma.user.findUnique({ where: { id: params.userId }, select: { id: true, email: true } })
  if (!user) return NextResponse.json({ error: { code: 'UserNotFound', message: 'Không tìm thấy tài khoản.' } }, { status: 404 })

  const token = generateToken()
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000)
  await prisma.$transaction([
    prisma.passwordResetToken.updateMany({ where: { user_id: user.id, used_at: null }, data: { used_at: new Date() } }),
    prisma.passwordResetToken.create({ data: { user_id: user.id, token_hash: hashToken(token), expires_at: expiresAt } }),
  ])
  const sent = await sendPasswordResetEmail({ to: user.email, token, expiresAt })
  if (!sent.success) return NextResponse.json({ error: { code: 'EmailSendFailed', message: sent.error || 'Không gửi được email.' } }, { status: 502 })
  return NextResponse.json({ message: `Đã gửi link đặt lại mật khẩu đến ${user.email}.` })
}
