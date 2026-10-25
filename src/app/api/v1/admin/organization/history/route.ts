import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isOrganizationId } from '@/lib/organization-admin-rules'

/** Historical intervals are separate from the current roster, never reactivated. */
export async function GET(request: NextRequest) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  if (auth.context!.role !== 'ADMIN') return NextResponse.json({ error: { code: 'AccessDenied' } }, { status: 403 })
  const userId = new URL(request.url).searchParams.get('userId')
  if (!isOrganizationId(userId)) return NextResponse.json({ error: { code: 'ValidationError' } }, { status: 400 })
  const [user, intervals, memberships, positions] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, display_name: true } }),
    prisma.chapterAffiliationInterval.findMany({ where: { user_id: userId }, orderBy: { starts_at: 'desc' } }),
    prisma.organizationMembership.findMany({ where: { user_id: userId }, include: { unit: { select: { name: true, type: true } } }, orderBy: { starts_at: 'desc' } }),
    prisma.positionAssignment.findMany({ where: { user_id: userId }, include: { unit: { select: { name: true } }, position: { select: { name: true } } }, orderBy: { starts_at: 'desc' } }),
  ])
  if (!user) return NextResponse.json({ error: { code: 'NotFound' } }, { status: 404 })
  const chapters = await prisma.chapter.findMany({ where: { id: { in: Array.from(new Set(intervals.map(row => row.chapter_id))) } }, select: { id: true, name: true } })
  const now = new Date()
  return NextResponse.json({
    user,
    chapters: intervals.map(row => ({ ...row, name: chapters.find(chapter => chapter.id === row.chapter_id)?.name || row.chapter_id, label: row.ends_at && row.ends_at <= now ? 'Đã rời Chapter' : 'Chapter hiện tại' })),
    memberships, positions,
  }, { headers: { 'Cache-Control': 'no-store' } })
}
