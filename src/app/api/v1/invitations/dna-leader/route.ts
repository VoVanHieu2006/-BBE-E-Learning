import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { sendDnaLeaderInvitation } from '@/lib/invitations'
import { invalidateInvitationsServerCache } from '@/lib/server-cache'
import { OrganizationConflict } from '@/lib/chapter-lead'

export async function POST(request: NextRequest) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  if (auth.context?.role !== 'ADMIN') return NextResponse.json({ error: { code: 'AccessDenied' } }, { status: 403 })
  const body = await request.json().catch(() => ({}))
  const email = String(body.email || '').trim().toLowerCase()
  if (!email) return NextResponse.json({ error: { code: 'ValidationError', message: 'Email là bắt buộc.' } }, { status: 400 })
  try {
  const result = await sendDnaLeaderInvitation(email, auth.context.userId)
  if (result.ok === false) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: 409 })
  invalidateInvitationsServerCache()
  return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof OrganizationConflict) return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: 409 })
    throw error
  }
}
