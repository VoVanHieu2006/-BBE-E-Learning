import crypto from 'crypto'
import { prisma } from '@/lib/prisma'

// Giới hạn dò mật khẩu theo nguồn: khóa theo tài khoản (5 lần sai) không chặn được việc thử trên nhiều email.
// Bộ đếm nằm trong DB vì bộ nhớ tiến trình không dùng chung giữa các instance serverless.
export const LOGIN_FAILURE_LIMIT = 20
export const LOGIN_FAILURE_WINDOW_MS = 10 * 60 * 1000

/**
 * IP của client do proxy tin cậy ghi (Vercel ghi đè `x-forwarded-for`). Không có header thì không xác định
 * được nguồn và không giới hạn: gộp mọi client vào một bộ đếm sẽ cho một kẻ tấn công khóa tất cả người dùng.
 */
export function loginSource(headers: Headers): string | null {
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return forwarded || headers.get('x-real-ip')?.trim() || null
}

function windowFor(source: string, now: number) {
  const index = Math.floor(now / LOGIN_FAILURE_WINDOW_MS)
  const key = crypto.createHash('sha256')
    .update(`login:${source}:${index}:${process.env.TOKEN_HASH_PEPPER || ''}`)
    .digest('hex')
  return { key, expiresAt: new Date((index + 1) * LOGIN_FAILURE_WINDOW_MS) }
}

/** Số giây phải chờ nếu nguồn đã vượt ngưỡng trong cửa sổ hiện tại, ngược lại `null`. */
export async function loginRetryAfterSeconds(source: string | null, now = Date.now()): Promise<number | null> {
  if (!source) return null
  const { key, expiresAt } = windowFor(source, now)
  const row = await prisma.authRateLimit.findUnique({ where: { key }, select: { count: true } })
  if (!row || row.count < LOGIN_FAILURE_LIMIT) return null
  return Math.max(1, Math.ceil((expiresAt.getTime() - now) / 1000))
}

export async function recordLoginFailure(source: string | null, now = Date.now()): Promise<void> {
  if (!source) return
  const { key, expiresAt } = windowFor(source, now)
  const { count } = await prisma.authRateLimit.upsert({
    where: { key },
    create: { key, count: 1, expires_at: expiresAt },
    update: { count: { increment: 1 } },
    select: { count: true },
  })
  // Dọn cửa sổ đã hết hạn mỗi khi một cửa sổ mới được mở, để bảng không lớn dần.
  if (count === 1) await prisma.authRateLimit.deleteMany({ where: { expires_at: { lt: new Date(now) } } })
}
