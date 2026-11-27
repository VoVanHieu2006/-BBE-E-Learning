import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getAdminUserStarHistory } from '@/lib/star-history'

const noStore = { 'Cache-Control': 'no-store' }

/** Admin xem lịch sử Star chi tiết của bất kỳ tài khoản nào (mọi vai trò, mọi trạng thái). */
export async function GET(request: NextRequest, { params }: { params: { userId: string } }) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401, headers: noStore })
  if (auth.context!.role !== 'ADMIN') {
    return NextResponse.json({ error: { code: 'AccessDenied', message: 'Chỉ Admin mới có quyền xem lịch sử Star của người dùng.' } }, { status: 403, headers: noStore })
  }

  const result = await getAdminUserStarHistory(prisma, params.userId, request.nextUrl.searchParams)
  if (result.ok === false) return NextResponse.json({ error: result.error }, { status: result.status, headers: noStore })
  return NextResponse.json(result.body, { headers: noStore })
}
