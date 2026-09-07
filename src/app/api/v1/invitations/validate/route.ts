import { NextRequest, NextResponse } from 'next/server'
import { validateInvitationToken } from '@/lib/invitations'

/**
 * GET /api/v1/invitations/validate?token=...
 * Public endpoint — no authentication required.
 * Validates an invitation token for the accept-invitation page.
 */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token')
  if (!token) {
    return NextResponse.json(
      { error: { code: 'ValidationError', message: 'Thiếu token' } },
      { status: 400 }
    )
  }

  const result = await validateInvitationToken(token)

  if (!result.ok) {
    const statusMap: Record<string, number> = {
      InvitationNotFound: 404,
      TokenAlreadyUsed: 409,
      TokenExpired: 410,
      InvalidState: 409,
    }
    return NextResponse.json(
      { valid: false, error: { code: (result as any).code, message: (result as any).message } },
      { status: statusMap[(result as any).code] || 400 }
    )
  }

  return NextResponse.json({
    valid: true,
    email: result.email,
    role: result.role,
    chapterName: result.chapterName,
    expiresAt: result.expiresAt.toISOString(),
  }, { status: 200 })
}
