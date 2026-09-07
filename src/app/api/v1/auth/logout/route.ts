import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import crypto from 'crypto'

/**
 * POST /api/v1/auth/logout
 * Revoke refresh token.
 */
export async function POST(request: NextRequest) {
  const auth = await authenticate(request)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const { refreshToken } = body

  if (!refreshToken) {
    return NextResponse.json({ error: { code: 'ValidationError', message: 'refreshToken là bắt buộc' } }, { status: 400 })
  }

  // Hash and revoke
  const hash = crypto.createHash('sha256').update(refreshToken + (process.env.TOKEN_HASH_PEPPER || '')).digest('hex')
  const updated = await prisma.refreshToken.updateMany({
    where: { token_hash: hash, user_id: (auth as any).context!.userId, revoked_at: null },
    data: { revoked_at: new Date() },
  })

  return NextResponse.json({ success: true, revoked: updated.count > 0 }, { status: 200 })
}
