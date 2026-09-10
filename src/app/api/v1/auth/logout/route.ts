import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import crypto from 'crypto'

/**
 * POST /api/v1/auth/logout
 * Revoke refresh token and clear all auth cookies unconditionally.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const refreshToken = body?.refreshToken || request.cookies.get('refreshToken')?.value

  if (refreshToken) {
    try {
      const hash = crypto.createHash('sha256').update(refreshToken + (process.env.TOKEN_HASH_PEPPER || '')).digest('hex')
      await prisma.refreshToken.updateMany({
        where: { token_hash: hash, revoked_at: null },
        data: { revoked_at: new Date() },
      })
    } catch {}
  }

  const response = NextResponse.json({ success: true }, { status: 200 })
  response.cookies.set('accessToken', '', { path: '/', maxAge: 0, sameSite: 'lax', httpOnly: true })
  response.cookies.set('refreshToken', '', { path: '/', maxAge: 0, sameSite: 'lax', httpOnly: true })
  response.cookies.set('userRole', '', { path: '/', maxAge: 0, sameSite: 'lax', httpOnly: true })
  return response
}
