import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { getUserStarBalance } from '@/lib/stars'
import { prisma } from '@/lib/prisma'
import { enrichStarHistoryEntries, readStarHistoryPage } from '@/lib/star-history'

export async function GET(request: NextRequest) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  const userId = auth.context!.userId

  const balance = await getUserStarBalance(userId, auth.context!.role)
  // The video classroom only needs the live total for its header. Avoid the
  // full paginated history and title-enrichment query on that hot path.
  if (request.nextUrl.searchParams.get('balanceOnly') === '1') {
    return NextResponse.json({ balance }, { headers: { 'Cache-Control': 'no-store' } })
  }
  const { items, page, limit, totalPages, totalItems } = await readStarHistoryPage(
    prisma,
    userId,
    request.nextUrl.searchParams.get('page'),
    request.nextUrl.searchParams.get('limit'),
  )

  // Enrich with lesson, course and assessment titles
  const enrichedItems = await enrichStarHistoryEntries(prisma, items)

  return NextResponse.json({
    balance,
    items: enrichedItems,
    page,
    limit,
    totalItems,
    totalPages,
  }, { headers: { 'Cache-Control': 'no-store' } })
}
