import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'
import { SignJWT } from 'jose'
import crypto from 'crypto'
import { hasActiveAffiliation } from '@/lib/affiliation-access'
import { getLearningManagerKind } from '@/lib/manager-learning-access'
import { invalidateUserAuthCache } from '@/lib/auth'
import { MAX_LOGIN_ATTEMPTS, failedLoginState, isOverdueLocked, isPasswordLocked } from '@/lib/account-restriction-rules'

const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || ''
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || ''

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const { email, password } = body

    if (!email || !password) {
      return NextResponse.json({ error: { code: 'ValidationError', message: 'email và password bắt buộc' } }, { status: 400 })
    }

    if (!JWT_ACCESS_SECRET || !JWT_REFRESH_SECRET) {
      console.error('Missing JWT_ACCESS_SECRET or JWT_REFRESH_SECRET in environment variables')
      return NextResponse.json(
        { error: { code: 'ConfigError', message: 'Thiếu cấu hình biến môi trường JWT_ACCESS_SECRET hoặc JWT_REFRESH_SECRET trên Vercel.' } },
        { status: 500 }
      )
    }

    // Find user
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
      include: { chapter_members: { take: 1, include: { chapter: { select: { id: true, name: true } } } } },
    })

    // Check if account exists
    if (!user) {
      return NextResponse.json({ error: { code: 'InvalidCredentials', message: 'Tài khoản hoặc mật khẩu không đúng' } }, { status: 401 })
    }

    // Check account status
    if (user.status === 'INACTIVE') {
      return NextResponse.json({ error: { code: 'AccountInactive', message: 'Tài khoản đã bị vô hiệu hóa' } }, { status: 403 })
    }

    // Tài khoản LOCKED không đăng nhập được kể cả khi nhập đúng mật khẩu, và không tự mở theo thời gian.
    // Khóa mật khẩu chỉ mở bằng mail đặt lại mật khẩu; khóa quá hạn chỉ mở bằng "Mở khóa & Gia hạn" của Admin.
    if (user.status === 'LOCKED') {
      const lockReason = isPasswordLocked(user) ? 'PASSWORD_LOCK' : isOverdueLocked(user, []) ? 'OVERDUE_LOCK' : null
      const message = lockReason === 'PASSWORD_LOCK'
        ? `Tài khoản đã bị khóa do nhập sai mật khẩu ${MAX_LOGIN_ATTEMPTS} lần. Hãy dùng "Quên mật khẩu" để đặt lại mật khẩu.`
        : lockReason === 'OVERDUE_LOCK'
          ? 'Tài khoản đã bị khóa do quá hạn học. Vui lòng liên hệ Admin để được mở khóa và gia hạn.'
          : 'Tài khoản đang bị khóa. Vui lòng liên hệ Admin.'
      return NextResponse.json({ error: { code: 'AccountLocked', message, lockReason } }, { status: 403 })
    }

    if (!await hasActiveAffiliation(user.id, user.role)) {
      return NextResponse.json({ error: { code: 'NoActiveAffiliation', message: 'Tài khoản không còn tư cách Chapter hoặc DNA đang hoạt động.' } }, { status: 403 })
    }

    // Verify password
    const valid = await bcrypt.compare(password, user.password_hash)

    if (!valid) {
      // Cộng nguyên tử để hai lần thử đồng thời không bị tính thành một.
      const { failed_login_count: newCount } = await prisma.user.update({
        where: { id: user.id },
        data: { failed_login_count: { increment: 1 } },
        select: { failed_login_count: true },
      })
      const attempt = failedLoginState(newCount)

      if (attempt.locked) {
        // Khóa mật khẩu không tự mở theo thời gian (không đặt locked_until).
        await prisma.user.updateMany({
          where: { id: user.id, status: 'ACTIVE' },
          data: { status: 'LOCKED', lock_reason: 'PASSWORD_LOCK', auth_version: { increment: 1 } },
        })
        invalidateUserAuthCache(user.id)
        return NextResponse.json({
          error: {
            code: 'AccountLocked',
            lockReason: 'PASSWORD_LOCK',
            remainingAttempts: 0,
            message: `Bạn đã nhập sai mật khẩu ${MAX_LOGIN_ATTEMPTS} lần nên tài khoản bị khóa. Hãy dùng "Quên mật khẩu" để đặt lại mật khẩu.`,
          },
        }, { status: 403 })
      }

      return NextResponse.json({
        error: {
          code: 'InvalidCredentials',
          message: 'Tài khoản hoặc mật khẩu không đúng',
          remainingAttempts: attempt.remainingAttempts,
        },
      }, { status: 401 })
    }

    // Generate JWT tokens concurrently
    const managerKind = await getLearningManagerKind(user.id, user.role)
    const chapterId = managerKind === 'LEAD_DNA' ? undefined : user.chapter_members?.[0]?.chapter?.id || undefined

    const accessSecret = new TextEncoder().encode(JWT_ACCESS_SECRET)
    const refreshSecret = new TextEncoder().encode(JWT_REFRESH_SECRET)

    const [accessToken, refreshToken] = await Promise.all([
      new SignJWT({ sub: user.id, role: user.role, chapterId })
        .setProtectedHeader({ alg: 'HS256' })
        .setExpirationTime('15m')
        .setIssuedAt()
        .sign(accessSecret),
      new SignJWT({ sub: user.id, role: user.role, chapterId })
        .setProtectedHeader({ alg: 'HS256' })
        .setExpirationTime('7d')
        .setIssuedAt()
        .setJti(crypto.randomUUID())
        .sign(refreshSecret),
    ])

    // Store refresh token hash in DB and conditionally reset counter concurrently
    const refreshHash = crypto.createHash('sha256').update(refreshToken + (process.env.TOKEN_HASH_PEPPER || '')).digest('hex')
    const refreshExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

    const dbOps: Promise<any>[] = [
      prisma.refreshToken.create({
        data: {
          user_id: user.id,
          token_hash: refreshHash,
          expires_at: refreshExpires,
        },
      }),
    ]

    // Đăng nhập đúng chỉ đếm lại số lần sai; không bao giờ đổi `status` (không mở nhầm khóa nào).
    if (user.failed_login_count > 0) {
      dbOps.push(
        prisma.user.update({
          where: { id: user.id },
          data: { failed_login_count: 0 },
        })
      )
    }

    await Promise.all(dbOps)

    const response = NextResponse.json({
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        status: user.status,
        chapterId: chapterId || null,
        chapterName: managerKind === 'LEAD_DNA' ? null : user.chapter_members?.[0]?.chapter?.name || null,
        managerKind,
        isLearningManager: Boolean(managerKind),
        isOrganizationManager: managerKind === 'LEAD_DNA',
      },
    }, { status: 200 })

    // Set cookies for server middleware access
    response.cookies.set('accessToken', accessToken, {
      path: '/',
      sameSite: 'lax',
      maxAge: 15 * 60, // 15 minutes
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
    })
    response.cookies.set('userRole', user.role, {
      path: '/',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
    })
    response.cookies.set('refreshToken', refreshToken, {
      path: '/',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
    })

    return response
  } catch (err: any) {
    console.error('Error in /api/v1/auth/login:', err)
    return NextResponse.json(
      {
        error: {
          code: 'ServerError',
          message: err?.message || 'Lỗi xử lý đăng nhập tại máy chủ',
          detail: String(err),
        },
      },
      { status: 500 }
    )
  }
}
