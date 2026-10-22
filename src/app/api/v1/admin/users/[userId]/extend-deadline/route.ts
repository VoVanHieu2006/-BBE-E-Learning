import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { invalidateUserAuthCache } from '@/lib/auth'

export async function POST(request: NextRequest, { params }: { params: { userId: string } }) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  if ((auth as any).context!.role !== 'ADMIN') {
    return NextResponse.json({ error: { code: 'AccessDenied', message: 'Chỉ Admin mới có quyền gia hạn deadline và mở khóa.' } }, { status: 403 })
  }

  const adminId = auth.context!.userId
  const userId = params.userId
  const body = await request.json().catch(() => ({}))
  const { extensionDays, reason } = body

  if (!Number.isInteger(extensionDays) || extensionDays < 1) {
    return NextResponse.json({
      error: { code: 'ValidationError', message: 'extensionDays phải là số nguyên dương (>= 1).' },
    }, { status: 400 })
  }

  const now = new Date()

  const outcome = await prisma.$transaction(async (tx) => {
    // 1. Row-lock User
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } })

    // 2. Tìm LearningCycle & LearningPath
    const activeCycle = await tx.learningCycle.findFirst({
      where: { user_id: userId, ends_at: null },
      select: { id: true },
    })
    if (!activeCycle) {
      throw new Error('NoActiveLearningCycle')
    }

    const path = await tx.learningPath.findUnique({
      where: { learning_cycle_id: activeCycle.id },
    })
    if (!path) {
      throw new Error('NoActiveLearningPath')
    }

    // 3. Tính deadline mới (Phương án 1: Tính từ now nếu đã quá hạn, hoặc cộng dồn nếu chưa quá hạn)
    const baseTime = path.due_at && path.due_at.getTime() > now.getTime()
      ? path.due_at.getTime()
      : now.getTime()
    const newDueAt = new Date(baseTime + extensionDays * 86_400_000)

    // 4. Cập nhật LearningPath và ghi nhận LearningPathChange
    await tx.learningPath.update({
      where: { id: path.id },
      data: { due_at: newDueAt },
    })

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

    // 5. Cập nhật các assignment bị quá hạn về trạng thái đang làm
    await tx.userLearningAssignment.updateMany({
      where: {
        user_id: userId,
        learning_cycle_id: activeCycle.id,
        mandatory: true,
        ended_at: null,
        completed_at: null,
      },
      data: {
        due_at: newDueAt,
        status: 'IN_PROGRESS',
      },
    })

    // 6. Lift CÓ ĐIỀU KIỆN các restriction loại DEADLINE
    await tx.accessRestriction.updateMany({
      where: {
        user_id: userId,
        type: 'DEADLINE',
        lifted_at: null,
      },
      data: {
        lifted_at: now,
        lifted_by_user_id: adminId,
      },
    })

    // 7. Bảo toàn các nguyên nhân hạn chế độc lập khác:
    let accountStatus = user.status
    let accountLockReason = user.lock_reason

    const otherRestrictionsCount = await tx.accessRestriction.count({
      where: {
        user_id: userId,
        lifted_at: null,
      },
    })

    const isPasswordLocked = user.lock_reason === 'PASSWORD_LOCK' && user.locked_until && user.locked_until > now

    if (user.status === 'INACTIVE') {
      // Bị Lead hoặc Admin vô hiệu hóa thủ công -> GIỮ NGUYÊN INACTIVE
      accountStatus = 'INACTIVE'
    } else if (otherRestrictionsCount > 0 || isPasswordLocked) {
      // Vẫn còn lý do hạn chế khác -> GIỮ NGUYÊN LOCKED
      accountStatus = 'LOCKED'
    } else if (user.lock_reason === 'OVERDUE_LOCK' || user.lock_reason === 'DEADLINE') {
      // Lý do khóa duy nhất là quá hạn -> MỞ KHÓA THÀNH CÔNG
      accountStatus = 'ACTIVE'
      accountLockReason = null

      await tx.user.update({
        where: { id: userId },
        data: {
          status: 'ACTIVE',
          lock_reason: null,
          auth_version: { increment: 1 },
        },
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
          reason: reason || 'Admin gia hạn hạn hoàn thành học tập',
          extensionDays,
          oldDueAt: path.due_at?.toISOString() || null,
          newDueAt: newDueAt.toISOString(),
          statusBefore: user.status,
          statusAfter: accountStatus,
        },
      },
    })

    return {
      newDueAt,
      accountStatus,
      accountLockReason,
      unlocked: accountStatus === 'ACTIVE',
    }
  })

  invalidateUserAuthCache(userId)

  return NextResponse.json({
    ok: true,
    userId,
    extensionDays,
    newDueAt: outcome.newDueAt.toISOString(),
    accountStatus: outcome.accountStatus,
    accountLockReason: outcome.accountLockReason,
    unlocked: outcome.unlocked,
  })
}
