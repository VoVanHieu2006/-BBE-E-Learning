import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { issuePasswordResetLink, buildPasswordResetUrl } from '@/lib/password-reset-link'
import { isOrganizationId } from '@/lib/organization-admin-rules'

const NO_STORE = { 'Cache-Control': 'no-store' }
const STATUS_BY_CODE: Record<string, number> = {
  UserNotFound: 404,
  InvalidState: 409,
  RateLimited: 429,
}

/**
 * POST /api/v1/users/[userId]/password-reset/link
 * Chỉ ADMIN. Tạo link đặt lại mật khẩu mới (vô hiệu token cũ, 15 phút, dùng một lần) khi email không gửi được.
 * Link chỉ nằm trong phản hồi này (không lưu, không log); client sao chép vào clipboard mà không hiển thị.
 */
export async function POST(request: NextRequest, { params }: { params: { userId: string } }) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401, headers: NO_STORE })
  if (auth.context?.role !== 'ADMIN') {
    return NextResponse.json({ error: { code: 'AccessDenied', message: 'Chỉ Admin được lấy link đặt lại mật khẩu.' } }, { status: 403, headers: NO_STORE })
  }
  if (!isOrganizationId(params.userId)) {
    return NextResponse.json({ error: { code: 'ValidationError', message: 'Thiếu hoặc sai userId' } }, { status: 400, headers: NO_STORE })
  }

  const result = await issuePasswordResetLink(params.userId, auth.context.userId)
  if (result.ok === false) {
    return NextResponse.json(
      { error: { code: result.code, message: result.message } },
      { status: STATUS_BY_CODE[result.code] || 400, headers: NO_STORE },
    )
  }

  return NextResponse.json(
    { userId: result.userId, expiresAt: result.expiresAt.toISOString(), link: buildPasswordResetUrl(result.token) },
    { status: 200, headers: NO_STORE },
  )
}
