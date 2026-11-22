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

export type LoginAttempt = {
  /** Số giây phải chờ nếu nguồn đã vượt ngưỡng trong cửa sổ hiện tại, ngược lại `null`. */
  retryAfter: number | null
  /** Trả lại lượt đã giữ khi đăng nhập thành công: chỉ lần sai mới bị tính. */
  release: () => Promise<void>
}

const UNLIMITED: LoginAttempt = { retryAfter: null, release: async () => {} }

/**
 * Giữ trước một lượt cho nguồn rồi mới kiểm tra mật khẩu. Tăng bộ đếm trong cùng một câu lệnh với việc
 * đọc nó để các request đồng thời không cùng lọt qua ngưỡng trước khi lần sai nào kịp được ghi.
 */
export async function reserveLoginAttempt(source: string | null, now = Date.now()): Promise<LoginAttempt> {
  if (!source) return UNLIMITED
  const { key, expiresAt } = windowFor(source, now)
  const { count } = await prisma.authRateLimit.upsert({
    where: { key },
    create: { key, count: 1, expires_at: expiresAt },
    update: { count: { increment: 1 } },
    select: { count: true },
  })
  // Dọn cửa sổ đã hết hạn mỗi khi một cửa sổ mới được mở, để bảng không lớn dần.
  if (count === 1) await prisma.authRateLimit.deleteMany({ where: { expires_at: { lte: new Date(now) } } })
  if (count > LOGIN_FAILURE_LIMIT) {
    return { retryAfter: Math.max(1, Math.ceil((expiresAt.getTime() - now) / 1000)), release: UNLIMITED.release }
  }
  return {
    retryAfter: null,
    release: async () => {
      await prisma.authRateLimit.updateMany({ where: { key, count: { gt: 0 } }, data: { count: { decrement: 1 } } })
    },
  }
}
