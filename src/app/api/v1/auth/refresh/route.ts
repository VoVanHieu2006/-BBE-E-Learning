import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { jwtVerify, SignJWT } from 'jose'
import crypto from 'crypto'

const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || ''
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || ''

/**
 * POST /api/v1/auth/refresh
 * Exchange a valid refresh token for a fresh access token.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const refreshToken = body?.refreshToken || request.cookies.get('refreshToken')?.value

    if (!refreshToken) {
      return NextResponse.json(
        { error: { code: 'ValidationError', message: 'refreshToken là bắt buộc' } },
        { status: 400 }
      )
    }

    const refreshSecret = new TextEncoder().encode(JWT_REFRESH_SECRET)
    let payload: any
    try {
      const verified = await jwtVerify(refreshToken, refreshSecret)
      payload = verified.payload
    } catch {
      return NextResponse.json(
        { error: { code: 'InvalidToken', message: 'Refresh token không hợp lệ hoặc đã hết hạn' } },
        { status: 401 }
      )
    }

    const userId = payload.sub as string
    if (!userId) {
      return NextResponse.json(
        { error: { code: 'InvalidToken', message: 'Refresh token không hợp lệ' } },
        { status: 401 }
      )
    }

    // Check DB for active, non-revoked refresh token
    const refreshHash = crypto
      .createHash('sha256')
      .update(refreshToken + (process.env.TOKEN_HASH_PEPPER || ''))
      .digest('hex')

    const tokenRecord = await prisma.refreshToken.findFirst({
      where: {
        token_hash: refreshHash,
        user_id: userId,
        revoked_at: null,
        expires_at: { gt: new Date() },
      },
    })

    if (!tokenRecord) {
      return NextResponse.json(
        { error: { code: 'InvalidToken', message: 'Refresh token đã bị thu hồi hoặc không tồn tại' } },
        { status: 401 }
      )
    }

    // Check user is active
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        chapter_members: {
          take: 1,
          include: { chapter: { select: { id: true, name: true } } },
        },
      },
    })

    if (!user || user.status !== 'ACTIVE') {
      return NextResponse.json(
        { error: { code: 'AccountInactive', message: 'Tài khoản không hoạt động hoặc đã bị vô hiệu hóa' } },
        { status: 403 }
      )
    }

    // Issue fresh access token
    const chapterId = user.chapter_members?.[0]?.chapter?.id || undefined
    const accessSecret = new TextEncoder().encode(JWT_ACCESS_SECRET)

    const accessToken = await new SignJWT({ sub: user.id, role: user.role, chapterId })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('15m')
      .setIssuedAt()
      .sign(accessSecret)

    const response = NextResponse.json({
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        status: user.status,
        chapterId: chapterId || null,
        chapterName: user.chapter_members?.[0]?.chapter?.name || null,
      },
    }, { status: 200 })

    response.cookies.set('accessToken', accessToken, {
      path: '/',
      sameSite: 'lax',
      maxAge: 15 * 60,
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

    return response
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: 'ServerError', message: err.message || 'Lỗi xử lý refresh token' } },
      { status: 500 }
    )
  }
}
