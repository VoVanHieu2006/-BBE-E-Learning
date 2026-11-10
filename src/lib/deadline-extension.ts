import type { Prisma } from '@prisma/client'
import { accountAfterExtension, isOverdueLocked, manualExtensionDueAt } from './account-restriction-rules'

/** Lỗi nghiệp vụ biết trước: route trả 4xx thay vì 500. */
export class ExtendDeadlineError extends Error {
  constructor(readonly status: 404 | 409, readonly code: string, message: string) {
    super(message)
    // Keeps `instanceof` working when the file is compiled to an ES5 target (e.g. the test config).
    Object.setPrototypeOf(this, ExtendDeadlineError.prototype)
  }
}

/**
 * Lõi transaction của "Mở khóa & Gia hạn" (KHBB 5.5, 7.1). Gọi trong `prisma.$transaction`.
 * Khóa dòng `users` để hai request gần nhau chỉ cộng một lần: request thứ hai thấy tài khoản không còn
 * bị khóa quá hạn và nhận 409 `NotOverdueLocked`.
 */
export async function extendOverdueLock(
  tx: Prisma.TransactionClient,
  input: { userId: string; adminId: string; extensionDays: number; reason: string; now?: () => Date },
) {
  const { userId, adminId, extensionDays, reason } = input
  // 1. Row-lock User: serialize concurrent extensions for the same account.
  const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`
  if (!locked.length) throw new ExtendDeadlineError(404, 'UserNotFound', 'Không tìm thấy tài khoản.')
  const user = await tx.user.findUniqueOrThrow({ where: { id: userId } })
  if (user.anonymized_at) throw new ExtendDeadlineError(409, 'AccountRetired', 'Tài khoản đã ẩn danh, không thể gia hạn.')

  // 2. Chỉ tài khoản đang bị khóa quá hạn mới được gia hạn.
  const openRestrictions = await tx.accessRestriction.findMany({
    where: { user_id: userId, lifted_at: null },
    select: { type: true },
  })
  if (!isOverdueLocked(user, openRestrictions.map((row) => row.type))) {
    throw new ExtendDeadlineError(409, 'NotOverdueLocked', 'Chỉ có thể gia hạn cho tài khoản đang bị khóa do quá hạn học.')
  }

  // 3. Tìm LearningCycle & LearningPath
  const activeCycle = await tx.learningCycle.findFirst({
    where: { user_id: userId, ends_at: null },
    select: { id: true },
  })
  if (!activeCycle) throw new ExtendDeadlineError(409, 'NoActiveLearningCycle', 'Tài khoản chưa có chu kỳ học đang hoạt động.')
  const path = await tx.learningPath.findUnique({ where: { learning_cycle_id: activeCycle.id } })
  if (!path) throw new ExtendDeadlineError(409, 'NoActiveLearningPath', 'Tài khoản chưa có lộ trình học đang hoạt động.')

  // 4. Hạn cũ của tài khoản bị khóa đã qua nên luôn tính từ hôm nay.
  const now = (input.now ?? (() => new Date()))()
  const newDueAt = manualExtensionDueAt(now, extensionDays)

  await tx.learningPath.update({ where: { id: path.id }, data: { due_at: newDueAt } })
  await tx.learningPathChange.create({
    data: {
      path_id: path.id,
      changed_at: now,
      previous_budget: path.budget,
      next_budget: path.budget,
      due_at: newDueAt,
      reason: 'ADMIN_MANUAL_EXTENSION',
    },
  })

  // 5. Đưa nghĩa vụ chưa xong về trạng thái đang thực hiện
  await tx.userLearningAssignment.updateMany({
    where: {
      user_id: userId,
      learning_cycle_id: activeCycle.id,
      mandatory: true,
      ended_at: null,
      completed_at: null,
    },
    data: { due_at: newDueAt, status: 'IN_PROGRESS' },
  })

  // 6. Gỡ restriction loại DEADLINE
  await tx.accessRestriction.updateMany({
    where: { user_id: userId, type: 'DEADLINE', lifted_at: null },
    data: { lifted_at: now, lifted_by_user_id: adminId },
  })

  // 7. Giữ các nguyên nhân khóa độc lập khác (khóa mật khẩu, khóa Admin/Chapter, INACTIVE):
  //    mở lần lượt, gia hạn trước rồi mới gửi mail đặt lại mật khẩu (KHBB 7.3).
  const otherRestrictionsCount = openRestrictions.filter((row) => row.type !== 'DEADLINE').length
  const after = accountAfterExtension(user, otherRestrictionsCount)
  if (after.status !== user.status || after.lockReason !== (user.lock_reason ?? null)) {
    await tx.user.update({
      where: { id: userId },
      data: { status: after.status, lock_reason: after.lockReason, auth_version: { increment: 1 } },
    })
  }

  // 8. Ghi Audit Log
  await tx.auditLog.create({
    data: {
      actor_user_id: adminId,
      action: 'EXTEND_DEADLINE',
      entity_id: userId,
      entity_type: 'USER',
      metadata: {
        reason,
        extensionDays,
        oldDueAt: path.due_at?.toISOString() || null,
        newDueAt: newDueAt.toISOString(),
        statusBefore: user.status,
        statusAfter: after.status,
      },
    },
  })

  return { newDueAt, accountStatus: after.status, accountLockReason: after.lockReason }
}
