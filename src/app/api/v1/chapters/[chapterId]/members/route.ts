import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { canAccessChapterPermission } from '@/lib/authorization'
import { listChapterMembers } from '@/lib/chapter-members'

export async function GET(request: NextRequest, { params }: { params: { chapterId: string } }) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const chapterId = params.chapterId
  if (!chapterId) return NextResponse.json({ error: { code: 'ValidationError', message: 'Thiếu chapterId' } }, { status: 400 })

  // Legacy BĐHU or an active scoped position with VIEW_MEMBER_PROGRESS.
  if (!await canAccessChapterPermission(auth.context!, chapterId, 'VIEW_MEMBER_PROGRESS')) {
    return NextResponse.json({ error: { code: 'AccessDenied', message: 'Không có quyền' } }, { status: 403 })
  }

  const url = new URL(request.url)
  const statusParam = url.searchParams.get('status')
  if (statusParam && !['ACTIVE', 'INACTIVE', 'LOCKED'].includes(statusParam)) {
    return NextResponse.json({ error: { code: 'ValidationError', message: 'status filter không hợp lệ' } }, { status: 400 })
  }
  const search = (url.searchParams.get('search') || '').trim().slice(0, 255)
  const parsedPage = Number.parseInt(url.searchParams.get('page') || '1', 10)
  const parsedLimit = Number.parseInt(url.searchParams.get('limit') || '20', 10)
  const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1
  const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 100) : 20
  const skip = (page - 1) * limit

  // Admin can see CHAPTER_LEADER members too; BĐHU only MEMBERS
  const roleFilter = (auth as any).context!.role === 'ADMIN' ? undefined : 'MEMBER'
  const allMembers = await listChapterMembers(chapterId, {
    ...(roleFilter ? { roles: [roleFilter as 'MEMBER' | 'CHAPTER_LEADER'] } : {}),
    ...(statusParam ? { status: statusParam as 'ACTIVE' | 'INACTIVE' | 'LOCKED' } : {}),
    search,
  })
  const totalItems = allMembers.length
  const items = allMembers.slice(skip, skip + limit)

  return NextResponse.json({
    items: items.map((member) => ({
      userId: member.userId,
      email: member.email,
      status: member.status,
      role: member.role,
      joinedAt: member.joinedAt,
    })),
    totalItems,
    totalPages: Math.ceil(totalItems / limit),
  })
}
