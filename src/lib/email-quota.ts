import { prisma } from './prisma'
import { computeGrant, emailDailyLimit, nextQuotaResetAt, remainingSlots, utcDayString } from './email-quota-core'

export interface EmailQuotaInfo {
  limit: number
  used: number
  remaining: number
  resetsAt: Date
}

export interface EmailSlotReservation {
  /** Ngày UTC (YYYY-MM-DD) của bộ đếm đã đặt chỗ; dùng để hoàn slot đúng ngày. */
  day: string
  granted: number
}

function dayToDate(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`)
}

/** Hạn mức còn lại của ngày UTC hiện tại (chỉ đọc). */
export async function getEmailQuota(now: Date = new Date()): Promise<EmailQuotaInfo> {
  const limit = emailDailyLimit()
  const row = await prisma.emailDailyUsage.findUnique({ where: { day: dayToDate(utcDayString(now)) }, select: { count: true } })
  const used = row?.count ?? 0
  return { limit, used, remaining: remainingSlots(used, limit), resetsAt: nextQuotaResetAt(now) }
}

/**
 * Đặt chỗ trước khi gửi, nguyên tử ở DB: khóa hàng của ngày (SELECT ... FOR UPDATE) rồi tăng đếm
 * trong cùng transaction, nên hai request song song luôn xếp hàng và tổng không bao giờ vượt `cap`.
 * Đặt được tối đa số slot còn lại (đặt một phần cho lô lớn); trả granted = 0 khi hết.
 * Lỗi DB: `onError: 'deny'` (mặc định) coi như hết slot; 'allow' cho mail hệ thống không nên bị chặn.
 */
export async function reserveEmailSlots(
  requested: number,
  opts: { cap?: number; now?: Date; onError?: 'deny' | 'allow' } = {},
): Promise<EmailSlotReservation> {
  const day = utcDayString(opts.now ?? new Date())
  const cap = opts.cap ?? emailDailyLimit()
  if (!(requested > 0)) return { day, granted: 0 }
  try {
    const granted = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`INSERT INTO email_daily_usage (day, count, updated_at) VALUES (${day}::date, 0, timezone('UTC', now())) ON CONFLICT (day) DO NOTHING`
      const rows = await tx.$queryRaw<{ count: number }[]>`SELECT count FROM email_daily_usage WHERE day = ${day}::date FOR UPDATE`
      const take = computeGrant(requested, rows[0]?.count ?? 0, cap)
      if (take > 0) {
        await tx.$executeRaw`UPDATE email_daily_usage SET count = count + ${take}, updated_at = timezone('UTC', now()) WHERE day = ${day}::date`
      }
      return take
    })
    return { day, granted }
  } catch (error) {
    console.error('[EMAIL QUOTA] reserve failed:', (error as Error)?.message)
    return { day, granted: opts.onError === 'allow' ? Math.floor(requested) : 0 }
  }
}

/** Hoàn lại slot đã đặt nhưng không dùng (mail chưa tới Resend). Không bao giờ làm đếm âm. */
export async function releaseEmailSlots(day: string, count: number): Promise<void> {
  if (!(count > 0)) return
  try {
    await prisma.$executeRaw`UPDATE email_daily_usage SET count = GREATEST(count - ${Math.floor(count)}, 0), updated_at = timezone('UTC', now()) WHERE day = ${day}::date`
  } catch (error) {
    console.error('[EMAIL QUOTA] release failed:', (error as Error)?.message)
  }
}
