import type { Prisma } from '@prisma/client'
import { prisma } from './prisma'
import { generateToken, hashToken } from './tokens'
import { isPasswordLocked } from './account-restriction-rules'
import { LINK_RATE_WINDOW_MS, isResetLinkRequestRateLimited } from './email-quota-core'

/** Link đặt lại mật khẩu sống 15 phút và chỉ dùng một lần. */
export const PASSWORD_RESET_TTL_MS = 15 * 60 * 1000
export const PASSWORD_RESET_LINK_AUDIT_ACTION = 'PASSWORD_RESET_LINK_ISSUED'

/** Cùng điều kiện với đường công khai: tài khoản đang hoạt động hoặc bị khóa mật khẩu (cách duy nhất để mở khóa đó). */
export function canIssuePasswordResetLink(user: { status: string; lock_reason?: string | null }): boolean {
  return user.status === 'ACTIVE' || isPasswordLocked(user)
}

/** Link đặt lại mật khẩu chứa token thật: không được in ra màn hình hay log. */
export function buildPasswordResetUrl(token: string): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  return `${appUrl}/reset-password?token=${token}`
}

/**
 * Vô hiệu mọi token chưa dùng của user rồi tạo token mới (chỉ lưu băm). `extraOps` chạy cùng giao dịch
 * (ví dụ ghi audit log). Dùng chung cho mail Admin gửi và link Admin lấy trực tiếp.
 */
export async function createPasswordResetToken(
  userId: string,
  extraOps: Prisma.PrismaPromise<unknown>[] = [],
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateToken()
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS)
  await prisma.$transaction([
    prisma.passwordResetToken.updateMany({ where: { user_id: userId, used_at: null }, data: { used_at: new Date() } }),
    prisma.passwordResetToken.create({ data: { user_id: userId, token_hash: hashToken(token), expires_at: expiresAt } }),
    ...extraOps,
  ])
  return { token, expiresAt }
}

export type PasswordResetLinkError = {
  ok: false
  code: 'UserNotFound' | 'InvalidState' | 'RateLimited'
  message: string
}

/**
 * Admin lấy link đặt lại mật khẩu mới cho một tài khoản (khi mail không gửi được). Mỗi lần gọi đổi token,
 * link cũ hết hiệu lực. Token chỉ nằm trong giá trị trả về; audit log không chứa token.
 * Route phải kiểm tra role ADMIN trước khi gọi.
 */
export async function issuePasswordResetLink(
  userId: string,
  actorId: string,
): Promise<{ ok: true; userId: string; token: string; expiresAt: Date } | PasswordResetLinkError> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, status: true, lock_reason: true } })
  if (!user) return { ok: false, code: 'UserNotFound', message: 'Không tìm thấy tài khoản.' }
  if (!canIssuePasswordResetLink(user)) {
    return { ok: false, code: 'InvalidState', message: 'Chỉ lấy được link cho tài khoản đang hoạt động hoặc bị khóa mật khẩu.' }
  }

  const since = new Date(Date.now() - LINK_RATE_WINDOW_MS)
  const [byActor, byUser] = await Promise.all([
    prisma.auditLog.count({ where: { actor_user_id: actorId, action: PASSWORD_RESET_LINK_AUDIT_ACTION, created_at: { gte: since } } }),
    prisma.auditLog.count({ where: { entity_type: 'USER', entity_id: user.id, action: PASSWORD_RESET_LINK_AUDIT_ACTION, created_at: { gte: since } } }),
  ])
  if (isResetLinkRequestRateLimited({ byActor, byUser })) {
    return { ok: false, code: 'RateLimited', message: 'Bạn đã lấy link quá nhiều lần trong ít phút. Vui lòng thử lại sau.' }
  }

  const { token, expiresAt } = await createPasswordResetToken(user.id, [
    prisma.auditLog.create({
      data: { actor_user_id: actorId, action: PASSWORD_RESET_LINK_AUDIT_ACTION, entity_type: 'USER', entity_id: user.id, metadata: { email: user.email } },
    }),
  ])
  return { ok: true, userId: user.id, token, expiresAt }
}
