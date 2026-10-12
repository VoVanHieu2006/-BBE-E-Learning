import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { getUserStarBalance } from '@/lib/stars'
import { prisma } from '@/lib/prisma'
import { normalizeStarHistoryPagination } from '@/lib/star-history-rules'

export async function GET(request: NextRequest) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  const userId = auth.context!.userId
  const where = { user_id: userId }
  const [balance, recent, totalItems] = await Promise.all([
    getUserStarBalance(userId),
    prisma.starLedger.findMany({ where, orderBy: [{ awarded_at: 'desc' }, { id: 'desc' }], take: 10, select: { amount: true, reason: true, awarded_at: true, source_type: true } }),
    prisma.starLedger.count({ where }),
  ])
  const { page, limit, totalPages } = normalizeStarHistoryPagination(
    request.nextUrl.searchParams.get('page'),
    request.nextUrl.searchParams.get('limit'),
    totalItems,
  )
  const items = await prisma.starLedger.findMany({
    where,
    orderBy: [{ awarded_at: 'desc' }, { id: 'desc' }],
    skip: (page - 1) * limit,
    take: limit,
    select: { id: true, amount: true, reason: true, awarded_at: true, source_type: true },
  })
  return NextResponse.json({ balance, recent, items, page, limit, totalItems, totalPages })
}
