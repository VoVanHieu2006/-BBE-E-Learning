import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('=== BẮT ĐẦU MIGRATION DỌN DẸP ACCESS RESTRICTION SUPPLEMENT CŨ ===')
  const now = new Date()

  // 1. Tìm tất cả các restriction loại DEADLINE được sinh ra từ supplement cũ chưa được gỡ
  const legacyRestrictions = await prisma.accessRestriction.findMany({
    where: {
      type: 'DEADLINE',
      source_reference: { startsWith: 'supplement:' },
      lifted_at: null,
    },
    select: {
      id: true,
      user_id: true,
      reason: true,
      source_reference: true,
    },
  })

  console.log(`Tìm thấy ${legacyRestrictions.length} bản ghi restriction supplement cũ đang hoạt động.`)

  if (legacyRestrictions.length === 0) {
    console.log('✓ Không có bản ghi restriction supplement cũ nào cần dọn dẹp.')
    return
  }

  const affectedUserIds = Array.from(new Set(legacyRestrictions.map((r) => r.user_id).filter(Boolean))) as string[]

  await prisma.$transaction(async (tx) => {
    // 2. Lift các restriction này có lý do migration rõ ràng
    const updateResult = await tx.accessRestriction.updateMany({
      where: {
        id: { in: legacyRestrictions.map((r) => r.id) },
      },
      data: {
        lifted_at: now,
      },
    })
    console.log(`✓ Đã đánh dấu lifted_at cho ${updateResult.count} bản ghi restriction cũ.`)

    // 3. Đánh giá trạng thái từng tài khoản
    let unlockedUsersCount = 0
    for (const userId of affectedUserIds) {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true, status: true, lock_reason: true, locked_until: true, auth_version: true },
      })
      if (!user) continue

      // Nếu tài khoản bị INACTIVE do Lead/Admin vô hiệu hóa thủ công -> KHÔNG MỞ
      if (user.status === 'INACTIVE') {
        console.log(`  - User ${userId}: status=INACTIVE (giữ nguyên không mở)`)
        continue
      }

      // Nếu tài khoản đang bị PASSWORD_LOCK và chưa hết hạn -> KHÔNG MỞ
      if (user.lock_reason === 'PASSWORD_LOCK' && user.locked_until && user.locked_until > now) {
        console.log(`  - User ${userId}: lock_reason=PASSWORD_LOCK (giữ nguyên không mở)`)
        continue
      }

      // Kiểm tra xem còn restriction nào khác đang active không
      const otherActiveRestrictions = await tx.accessRestriction.count({
        where: {
          user_id: userId,
          lifted_at: null,
        },
      })
      if (otherActiveRestrictions > 0) {
        console.log(`  - User ${userId}: vẫn còn ${otherActiveRestrictions} restriction khác (giữ nguyên khóa)`)
        continue
      }

      // Kiểm tra xem lộ trình chung của user có đang bị quá hạn thực sự không
      const activeCycle = await tx.learningCycle.findFirst({
        where: { user_id: userId, ends_at: null },
        select: { id: true },
      })
      if (activeCycle) {
        const path = await tx.learningPath.findUnique({
          where: { learning_cycle_id: activeCycle.id },
          select: { due_at: true },
        })
        if (path && path.due_at && path.due_at < now) {
          // Lộ trình chung đang quá hạn thực sự -> Tạo restriction chuẩn cho learning-path
          await tx.accessRestriction.create({
            data: {
              user_id: userId,
              type: 'DEADLINE',
              reason: 'Quá hạn hoàn thành lộ trình đào tạo chung',
              source_reference: `learning-path:${activeCycle.id}`,
            },
          })
          console.log(`  - User ${userId}: Lộ trình chung quá hạn (${path.due_at.toISOString()}) -> Chuyển sang restriction learning-path`)
          continue
        }
      }

      // Nếu user đang LOCKED do OVERDUE_LOCK và không còn lý do nào khác -> Mở khóa an toàn
      if (user.status === 'LOCKED' && (user.lock_reason === 'OVERDUE_LOCK' || user.lock_reason === 'DEADLINE')) {
        await tx.user.update({
          where: { id: userId },
          data: {
            status: 'ACTIVE',
            lock_reason: null,
            auth_version: user.auth_version + 1,
          },
        })
        unlockedUsersCount++
        console.log(`  ✓ Mở khóa thành công cho User ${userId}`)
      }
    }

    console.log(`✓ Đã phục hồi an toàn ${unlockedUsersCount} tài khoản học viên.`)
  })

  console.log('=== HOÀN TẤT MIGRATION DỌN DẸP DEADLINE RESTRICTION ===')
}

main()
  .catch((err) => {
    console.error('Lỗi migration:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
