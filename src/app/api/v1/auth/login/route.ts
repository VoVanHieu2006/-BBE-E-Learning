import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'
import { SignJWT } from 'jose'
import crypto from 'crypto'

const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || ''
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || ''

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

    if (user.status === 'LOCKED') {
      return NextResponse.json({ error: { code: 'AccountLocked', message: 'Tài khoản đã bị khóa do nhập sai quá nhiều lần' } }, { status: 403 })
    }

    // Verify password
    const valid = await bcrypt.compare(password, user.password_hash)

    if (!valid) {
      // Increment failed_login_count
      const newCount = user.failed_login_count + 1
      const isLocked = newCount >= 10
      
      await prisma.user.update({
        where: { id: user.id },
        data: { 
          failed_login_count: newCount, 
          status: isLocked ? 'LOCKED' : user.status,
          locked_until: isLocked ? new Date(Date.now() + 30 * 60 * 1000) : null,
        },
      })

      return NextResponse.json({ error: { code: 'InvalidCredentials', message: 'Tài khoản hoặc mật khẩu không đúng' } }, { status: 401 })
    }

    // Login successful — reset counter
    await prisma.user.update({
      where: { id: user.id },
      data: { failed_login_count: 0, status: 'ACTIVE' },
    })

    // Generate JWT tokens
    const chapterId = user.chapter_members?.[0]?.chapter?.id || undefined

    const accessSecret = new TextEncoder().encode(JWT_ACCESS_SECRET)
    const refreshSecret = new TextEncoder().encode(JWT_REFRESH_SECRET)

    const accessToken = await new SignJWT({ sub: user.id, role: user.role, chapterId })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('15m')
      .setIssuedAt()
      .sign(accessSecret)

    const refreshToken = await new SignJWT({ sub: user.id, role: user.role, chapterId })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('7d')
      .setIssuedAt()
      .sign(refreshSecret)

    // Store refresh token hash in DB
    const refreshHash = crypto.createHash('sha256').update(refreshToken + (process.env.TOKEN_HASH_PEPPER || '')).digest('hex')
    const refreshExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    await prisma.refreshToken.create({
      data: {
        user_id: user.id,
        token_hash: refreshHash,
        expires_at: refreshExpires,
      },
    })

    const response = NextResponse.json({
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        status: user.status,
        chapterId: chapterId || null,
        chapterName: user.chapter_members?.[0]?.chapter?.name || null,
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
