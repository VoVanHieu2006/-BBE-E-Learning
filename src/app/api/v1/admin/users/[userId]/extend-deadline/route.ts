import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { invalidateUserAuthCache } from '@/lib/auth'
import { validateExtendDeadlineInput } from '@/lib/account-restriction-rules'
import { ExtendDeadlineError, extendOverdueLock } from '@/lib/deadline-extension'

/**
 * "Mở khóa & Gia hạn" (KHBB 5.5, 7.1): chỉ dành cho tài khoản đang bị khóa quá hạn.
 * Hạn mới = hôm nay + N ngày. Hai request gần nhau chỉ cộng một lần: request thứ hai chờ khóa dòng
 * `users`, thấy tài khoản không còn bị khóa quá hạn và nhận 409.
 */
export async function POST(request: NextRequest, { params }: { params: { userId: string } }) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  if ((auth as any).context!.role !== 'ADMIN') {
    return NextResponse.json({ error: { code: 'AccessDenied', message: 'Chỉ Admin mới có quyền gia hạn deadline và mở khóa.' } }, { status: 403 })
  }

  const adminId = auth.context!.userId
  const userId = params.userId
  const body = await request.json().catch(() => null)
  const input = validateExtendDeadlineInput(userId, body)
  if ('error' in input) {
    return NextResponse.json({ error: { code: input.error.code, message: input.error.message } }, { status: input.error.status })
  }
  const { extensionDays, reason } = input

  let outcome
  try {
    outcome = await prisma.$transaction((tx) => extendOverdueLock(tx, { userId, adminId, extensionDays, reason }))
  } catch (error) {
    if (error instanceof ExtendDeadlineError) {
      return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status })
    }
    throw error
  }

  invalidateUserAuthCache(userId)

  return NextResponse.json({
    ok: true,
    userId,
    extensionDays,
    newDueAt: outcome.newDueAt.toISOString(),
    accountStatus: outcome.accountStatus,
    accountLockReason: outcome.accountLockReason,
    unlocked: outcome.accountStatus === 'ACTIVE',
  })
}
